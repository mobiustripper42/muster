/**
 * The checkout QUOTE (16.1d, issue #1092) — every money figure a checkout screen shows before the
 * customer picks a tip, and each tip tier's amount, computed from `priceBooking`.
 *
 * **Why it reads the invoice instead of composing the fare itself.** `/book/checkout` used to do
 * its own arithmetic (`guestPricing` → tax → fee → deposit split), while the row and the Stripe
 * charge were priced by `priceBooking`. The two agreed because they were written to, which is the
 * weakest form of agreement there is. §2.10.6: "the same trip never quotes two totals" — and with
 * the operator's phone booking now drawing the same screen, a second copy would have been a third.
 * `checkout-quote.test.ts` pins both halves: the old page's numbers, and the charge's.
 *
 * Pure. Plain data out, so a server page can hand it straight to a client island.
 */
import { vesselDateOf } from "../config/tenant.js";
import { balanceDates, insideBalanceWindow } from "./availability.js";
import { formatShortDay } from "./availability-screen.js";
import type { BookingInvoiceInput } from "./booking-invoice.js";
import { priceBooking } from "./booking-invoice.js";
import { effectiveIncludedGuests, GRATUITY_DEFAULT_BPS, gratuityKindsFor, gratuityTiersFor } from "./pricing.js";
import { FLEX_INSURANCE_CENTS } from "./refund-terms.js";

export interface CheckoutQuote {
  /** Base + extras, cents, undiscounted — what tax, fee and every tip tier are a percentage of
   *  once `discountCents` is taken off. */
  fareCents: number;
  /** The operator's dollars off (DEC-194). Always 0 on the public checkout; set by the phone
   *  booking's form and by the payment link's frozen invoice. */
  discountCents: number;
  /** The slot's base price: an override Event's, else the offering's for that date. */
  baseCents: number;
  extraGuests: number;
  extrasCents: number;
  extraGuestPriceCents: number;
  /** What the base covers: the offering's included count, else the boat's capacity. */
  includedGuests: number;
  taxCents: number;
  taxRateBps: number;
  serviceFeeCents: number;
  serviceFeeBps: number;
  /** The whole quote, tip and insurance excluded — what is due now when the customer pays in full.
   *  The deposit, when one is chosen, is `depositCents` (`totalsFor`). */
  dueNowBeforeTipCents: number;
  /** The deposit the customer may pay instead of the whole quote (issue #1250), or null when none
   *  is on offer: no clock was given, or the departure is inside the balance window. Not null does
   *  not yet mean offered — a quote at or below it is paid whole (`depositOffered`). */
  depositCents: number | null;
  /** The vessel-local day the balance would be charged, `"Mon, Oct 12"`; null with `depositCents`. */
  balanceDueOn: string | null;
  /** Each pre-trip tip tier the offering sells, with its amount on THIS fare (DEC-124). */
  tiers: { bps: number; tipCents: number }[];
  /** The tier preselected: the offering's default when it is one of its tiers, else the first. */
  defaultBps: number;
  /**
   * Cancellation insurance's price (16.8), undiscounted — what ticking the box adds. Every figure
   * above leaves it out, the way they leave out the tip: it is untaxed, outside the fee and tip
   * bases, so the screen adds it back on top (`totalsFor`).
   */
  flexCents: number;
}

/**
 * What a checkout screen shows once the tip and the insurance are chosen (16.8) — the summary's
 * tax, fee and insurance rows and both totals. The fee moves with the tip and the insurance, and
 * the tax with the insurance (DEC-196), so these are re-totalled through `chargeTotals` on the
 * checkout and the operator's form, and read straight off the frozen invoice on the payment link.
 */
export interface ScreenTotals {
  tipCents: number;
  /** The insurance row, at its price; 0 is no row. */
  flexCents: number;
  taxCents: number;
  serviceFeeCents: number;
  totalCents: number;
  dueNowCents: number;
  /** What is left after `dueNowCents`: the deposit's balance, or 0 when the whole quote is due. */
  balanceCents: number;
}

/**
 * @param asOf The clock the deposit is judged by. **Absent means no deposit** — `depositCents` and
 *   `balanceDueOn` are null and the screen shows the whole quote. The public checkout passes the
 *   page's clock; the operator's form passes nothing and stays as it was.
 */
export function checkoutQuote(
  input: Omit<BookingInvoiceInput, "gratuityBps" | "hasFlex" | "deposit">,
  asOf?: string,
): CheckoutQuote {
  const tiersBps = gratuityTiersFor(input.offering);
  // Tip-free: with a 0 tier, the invoice's due-now and total are exactly the figures the screen
  // adds the chosen tip to. The tip is outside the deposit split and untaxed (DEC-124), so adding
  // it back on the client is the same sum `priceBooking` makes — the test holds it to that.
  const invoice = priceBooking({ ...input, gratuityBps: 0 });
  const fareCents = invoice.fareCents + invoice.extrasCents;
  const withDeposit =
    asOf !== undefined && !insideBalanceWindow(input.date, input.time, asOf, input.config);
  const includedGuests = effectiveIncludedGuests(input.offering, input.vessel);
  const preferred =
    gratuityKindsFor(input.offering).find((k) => k.kind === "pre")?.defaultBps ?? GRATUITY_DEFAULT_BPS;

  return {
    fareCents,
    discountCents: 0,
    baseCents: invoice.fareCents,
    extraGuests: Math.max(0, input.guestCount - includedGuests),
    extrasCents: invoice.extrasCents,
    extraGuestPriceCents: input.offering.extraGuestPriceCents,
    includedGuests,
    taxCents: invoice.taxCents,
    taxRateBps: invoice.taxRateBps,
    serviceFeeCents: invoice.serviceFeeCents,
    serviceFeeBps: invoice.serviceFeeBps,
    dueNowBeforeTipCents: invoice.amountDueNowCents,
    depositCents: withDeposit ? input.config.depositCents : null,
    balanceDueOn: withDeposit
      ? formatShortDay(vesselDateOf(new Date(balanceDates(input.date, input.time, input.config).dueAt)))
      : null,
    tiers: tiersBps.map((bps) => ({
      bps,
      tipCents: priceBooking({ ...input, gratuityBps: bps }).gratuityCents,
    })),
    defaultBps: tiersBps.includes(preferred) ? preferred : tiersBps[0]!,
    flexCents: FLEX_INSURANCE_CENTS,
  };
}
