/**
 * The operator's discount (16.5, DEC-194, SPEC §2.8.4a).
 *
 * Dollars off fare plus extras, capped at fare plus extras. Tax, the service fee and the tip are
 * recomputed on what is left, at the rates the invoice freezes — only the base moves. A discount
 * that leaves less than {@link COMP_FLOOR_CENTS} to pay is raised to the whole base: a comp, $0 due
 * and $0 tip.
 *
 * Pure, and free of anything server-only, so the operator's booking form imports it to re-total
 * live as the box is typed in — the figure on screen and the figure frozen are one computation.
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
  /** What the operator typed, in cents. Validated by the caller; clamped here to 0…base. */
  requestedCents: number;
  taxRateBps: number;
  serviceFeeBps: number;
  gratuityBps: number;
}

export interface Discounted {
  /** What actually comes off — the request, capped, or the whole base on a comp. */
  discountCents: number;
  /** Fare plus extras minus the discount: what tax, fee and tip were computed on. */
  baseCents: number;
  taxCents: number;
  serviceFeeCents: number;
  gratuityCents: number;
  /** base + tax + fee + tip. */
  totalCents: number;
  /** A discount that leaves $0 to pay. Confirmed without a payment (§2.8.6). */
  comped: boolean;
}

export function applyDiscount(input: DiscountInput): Discounted {
  const { fareAndExtrasCents: fare, taxRateBps, serviceFeeBps, gratuityBps } = input;
  const priced = (discountCents: number): Discounted => {
    const baseCents = fare - discountCents;
    const taxCents = taxCentsFor(baseCents, taxRateBps);
    const serviceFeeCents = feeCentsFor(baseCents, serviceFeeBps);
    const gratuityCents = gratuityCentsFor(baseCents, gratuityBps);
    const totalCents = baseCents + taxCents + serviceFeeCents + gratuityCents;
    return {
      discountCents,
      baseCents,
      taxCents,
      serviceFeeCents,
      gratuityCents,
      totalCents,
      comped: discountCents > 0 && totalCents === 0,
    };
  };
  const requested = Math.min(Math.max(0, Math.trunc(input.requestedCents)), fare);
  const result = priced(requested);
  // A sliver left to pay is not worth a payment link: make it a comp, said on the box first.
  if (requested > 0 && result.totalCents > 0 && result.totalCents < COMP_FLOOR_CENTS) return priced(fare);
  return result;
}

/**
 * The fare tax was charged on, off a frozen invoice: fare + extras − discount. Every reader that
 * composes a fare from an invoice goes through here, so a discount cannot be missed by one.
 */
export function chargedFareCents(inv: Pick<BookingInvoice, "fareCents" | "extrasCents" | "discountCents">): number {
  return inv.fareCents + inv.extrasCents - (inv.discountCents ?? 0);
}

/**
 * The same for a BOOKED row, whose balance is derived from its Event (§2.8.10): `Event.price` is
 * the undiscounted fare, so the discount comes off the row's own frozen invoice. Without it a
 * discounted booking paid in full reads as owing the discount plus its tax — and the pane offers
 * a balance link to collect it.
 */
export function bookedFareCents(eventPrice: number, r: Pick<Reservation, "extrasCents" | "invoice">): number {
  return eventPrice + (r.extrasCents ?? 0) - (r.invoice?.discountCents ?? 0);
}
