/**
 * The operator's discount (16.5, DEC-194, SPEC §2.8.4a) — and `chargeTotals`, the one place the
 * tax and the service fee are summed from their bases (16.8, DEC-196).
 *
 * Dollars off fare plus extras, then off cancellation insurance (16.8) — capped at fare plus
 * extras plus insurance. Tax, the service fee and the tip are recomputed on what is left, at the
 * rates the invoice freezes — only the bases move. A partial discount never reaches the insurance;
 * only the part past the whole fare does, which is what lets insurance be comped. A discount that
 * leaves less than {@link COMP_FLOOR_CENTS} to pay is raised to everything: a comp, $0 due and $0 tip.
 *
 * Pure, and free of anything server-only, so the checkout and the operator's booking form import it
 * to re-total live — the figure on screen and the figure frozen are one computation.
 */
import type { BookingInvoice, Reservation } from "../domain/entities.js";
import { feeCentsFor, taxCentsFor } from "./payment-config.js";
import { gratuityCentsFor } from "./pricing.js";

/** Under this much due, a discount becomes a comp — collecting a dollar or two is not worth
 *  anyone's time (operator, DEC-194). Stripe's own floor is $0.50. A constant, not a setting. */
export const COMP_FLOOR_CENTS = 200;

export interface DiscountInput {
  /** Fare plus extras, undiscounted — the base tax, fee and tip are a percentage of. */
  fareAndExtrasCents: number;
  /** What the operator typed, in cents. Validated by the caller; clamped here to 0…base+flex. */
  requestedCents: number;
  taxRateBps: number;
  serviceFeeBps: number;
  gratuityBps: number;
  /** Cancellation insurance bought, undiscounted (16.8): 0 or `FLEX_INSURANCE_CENTS`. */
  flexCents?: number;
}

export interface Discounted {
  /** What actually comes off — the request, capped, or everything on a comp. Fare first, then
   *  insurance. */
  discountCents: number;
  /** Fare plus extras minus the fare's share of the discount: what tax, fee and tip were
   *  computed on. */
  baseCents: number;
  taxCents: number;
  serviceFeeCents: number;
  gratuityCents: number;
  /** Insurance still charged once the discount has spilled past the fare onto it. */
  flexDueCents: number;
  /** base + tax + fee + tip + insurance due. */
  totalCents: number;
  /** A discount that leaves $0 to pay. Confirmed without a payment (§2.8.6). */
  comped: boolean;
}

/**
 * Tax, service fee and total from the charged lines (operator, 2026-10-09, DEC-196, §2.8.4a):
 *
 *   - **Taxed** is what reaches the operator's bank — fare + extras (after discount) + insurance.
 *     Not the tip (the crew's) and not the service fee (the provider's).
 *   - **The service fee** is on everything except tax — the same lines plus the tip.
 *   - **Total** is every line plus tax plus fee.
 *
 * The one place these are summed. `applyDiscount` freezes through it, and the checkout re-totals
 * through it as the tip and the insurance box change, so the two cannot round apart.
 */
export function chargeTotals(lines: {
  /** Fare + extras after the fare's share of the discount. */
  baseCents: number;
  /** Insurance after any discount that reached it. */
  flexDueCents: number;
  gratuityCents: number;
  taxRateBps: number;
  serviceFeeBps: number;
}): { taxCents: number; serviceFeeCents: number; totalCents: number } {
  const ours = lines.baseCents + lines.flexDueCents;
  const taxCents = taxCentsFor(ours, lines.taxRateBps);
  const serviceFeeCents = feeCentsFor(ours + lines.gratuityCents, lines.serviceFeeBps);
  return { taxCents, serviceFeeCents, totalCents: ours + lines.gratuityCents + taxCents + serviceFeeCents };
}

export function applyDiscount(input: DiscountInput): Discounted {
  const { fareAndExtrasCents: fare, taxRateBps, serviceFeeBps, gratuityBps } = input;
  const flex = input.flexCents ?? 0;
  const priced = (discountCents: number): Discounted => {
    const baseCents = fare - Math.min(discountCents, fare);
    const flexDueCents = flex - (discountCents - (fare - baseCents));
    // The tip is on the discounted fare only — never on insurance.
    const gratuityCents = gratuityCentsFor(baseCents, gratuityBps);
    const { taxCents, serviceFeeCents, totalCents } = chargeTotals({
      baseCents,
      flexDueCents,
      gratuityCents,
      taxRateBps,
      serviceFeeBps,
    });
    return {
      discountCents,
      baseCents,
      taxCents,
      serviceFeeCents,
      gratuityCents,
      flexDueCents,
      totalCents,
      comped: discountCents > 0 && totalCents === 0,
    };
  };
  const requested = Math.min(Math.max(0, Math.trunc(input.requestedCents)), fare + flex);
  const result = priced(requested);
  // A sliver left to pay is not worth a payment link: make it a comp, said on the box first.
  if (requested > 0 && result.totalCents > 0 && result.totalCents < COMP_FLOOR_CENTS) return priced(fare + flex);
  return result;
}

type DiscountFields = Pick<BookingInvoice, "fareCents" | "extrasCents" | "discountCents" | "flexCents">;

/** The part of a frozen discount that went past the fare onto the insurance (16.8). */
function flexDiscountCents(inv: DiscountFields): number {
  return Math.max(0, (inv.discountCents ?? 0) - (inv.fareCents + inv.extrasCents));
}

/** The part of a frozen discount that came off fare + extras — all of it, unless it went past the
 *  whole fare onto insurance (16.8). What a Discount line beside the Fare shows. */
export function fareDiscountCents(inv: DiscountFields): number {
  return (inv.discountCents ?? 0) - flexDiscountCents(inv);
}

/**
 * The fare charged, off a frozen invoice: fare + extras − the fare's share of the discount. Every
 * reader that composes a fare from an invoice goes through here, so a discount cannot be missed by
 * one — and insurance, which is taxed alongside it but is not fare, cannot leak in.
 */
export function chargedFareCents(inv: DiscountFields): number {
  return inv.fareCents + inv.extrasCents - fareDiscountCents(inv);
}

/**
 * The same for a BOOKED row, whose balance is derived from its Event (§2.8.10): `Event.price` is
 * the undiscounted fare, so the discount comes off the row's own frozen invoice. Without it a
 * discounted booking paid in full reads as owing the discount plus its tax — and the pane offers
 * a balance link to collect it.
 */
export function bookedFareCents(eventPrice: number, r: Pick<Reservation, "extrasCents" | "invoice">): number {
  return eventPrice + (r.extrasCents ?? 0) - (r.invoice ? fareDiscountCents(r.invoice) : 0);
}

/** What the customer was charged for insurance (16.8): its price less any discount that reached
 *  it. 0 with no insurance, and 0 on a comp — which still HAS insurance (`hasFlex`). */
export function flexChargedCents(inv: DiscountFields): number {
  return (inv.flexCents ?? 0) - flexDiscountCents(inv);
}

/**
 * The insurance's share of a first payment that is not fare and not the fare's tax: the insurance
 * charged plus the tax on it (16.8). `balanceOwedCents` counts fare + tax-on-fare as what is owed,
 * so this is carved out beside the tip and the fee — carving out only the $30 would leave the tax
 * on it counted as fare paid, and a deposit balance short by exactly that tax.
 *
 * The tax share is the invoice's tax less the tax on the fare alone, so it absorbs the rounding
 * and `balanceOwedCents`' own `taxCentsFor(fare)` lands on the same cent.
 */
export function flexCarveOutCents(inv: DiscountFields & Pick<BookingInvoice, "taxCents" | "taxRateBps">): number {
  const charged = flexChargedCents(inv);
  if (charged <= 0) return 0;
  return charged + inv.taxCents - taxCentsFor(chargedFareCents(inv), inv.taxRateBps);
}
