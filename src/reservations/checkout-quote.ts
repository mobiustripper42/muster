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
  /** Charged now, tip excluded: the deposit share + full tax + full fee, or the whole total. */
  dueNowBeforeTipCents: number;
  depositMode: boolean;
  /** The fare left to collect later (deposit mode only; 0 in full mode). */
  balanceLaterCents: number;
  /** Each pre-trip tip tier the offering sells, with its amount on THIS fare (DEC-124). */
  tiers: { bps: number; tipCents: number }[];
  /** The tier preselected: the offering's default when it is one of its tiers, else the first. */
  defaultBps: number;
  /**
   * Cancellation insurance's price (16.8), undiscounted — what ticking the box adds. Every figure
   * above leaves it out, the way they leave out the tip: it is untaxed, outside the fee and tip
   * bases and outside the deposit split, so the screen adds it back on top (`totalsWithTip`).
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
}

export function checkoutQuote(input: Omit<BookingInvoiceInput, "gratuityBps" | "hasFlex">): CheckoutQuote {
  const tiersBps = gratuityTiersFor(input.offering);
  // Tip-free: with a 0 tier, the invoice's due-now and total are exactly the figures the screen
  // adds the chosen tip to. The tip is outside the deposit split and untaxed (DEC-124), so adding
  // it back on the client is the same sum `priceBooking` makes — the test holds it to that.
  const invoice = priceBooking({ ...input, gratuityBps: 0 });
  const fareCents = invoice.fareCents + invoice.extrasCents;
  const pretipTotal = invoice.totalCents;
  const depositMode = input.config.depositMode === "deposit";
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
    depositMode,
    balanceLaterCents: depositMode ? pretipTotal - invoice.amountDueNowCents : 0,
    tiers: tiersBps.map((bps) => ({
      bps,
      tipCents: priceBooking({ ...input, gratuityBps: bps }).gratuityCents,
    })),
    defaultBps: tiersBps.includes(preferred) ? preferred : tiersBps[0]!,
    flexCents: FLEX_INSURANCE_CENTS,
  };
}
