/**
 * The booking invoice (SPEC §2.8.4a, DEC-164) — what one departure costs, for one party, on one
 * hull, frozen onto the row the moment the row is written.
 *
 * **One function, two callers (16.1).** §2.10.6: "the two surfaces compute the money from one
 * model. The same trip never quotes two totals." Public checkout (`create-departure-payment-intent.ts`)
 * and the operator's phone booking (`operator-booking.ts`) both price through here. It lived
 * inside checkout's row builder until the second surface needed it, and a copy would have been
 * the second place every future money rule had to land.
 *
 * Pure: everything it prices from is passed in, read once by the caller.
 */
import type { BookingInvoice, Event, Offering, Vessel } from "../domain/entities.js";
import type { VesselId } from "../domain/ids.js";
import { resolveBasePrice, slotIdentity } from "./availability.js";
import { applyDiscount } from "./discount.js";
import { chargeNowCents, type PaymentConfig } from "./payment-config.js";
import { composeFare, effectiveIncludedGuests } from "./pricing.js";

export interface BookingInvoiceInput {
  offering: Offering;
  /** The hull the row occupies — its included-guest count prices the extras. */
  vessel: Vessel;
  vesselId: VesselId;
  /** Every materialized Event, for an override price at this slot. */
  events: readonly Event[];
  config: PaymentConfig;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  /** Chosen gratuity tier in basis points (DEC-124). */
  gratuityBps: number;
  /** The operator's dollars off, in cents (16.5, DEC-194). Phone bookings only; absent or 0 is
   *  none. Clamped and floored by `applyDiscount`. */
  discountCents?: number;
}

export function priceBooking(input: BookingInvoiceInput): BookingInvoice {
  const { offering, vessel, vesselId, events, config, date, time, guestCount, gratuityBps } = input;
  // Price this slot exactly as displayed: an override Event's price wins, else the first-match
  // variation off the base (DEC-125). Offering is always priced (basePriceCents).
  const key = slotIdentity(vesselId, date, time);
  const slotEvent = events.find(
    (e) =>
      e.source === "muster" &&
      e.status === "scheduled" &&
      slotIdentity(e.vesselId, e.date, e.time) === key,
  );
  const priceCents = slotEvent?.price ?? resolveBasePrice(offering, date);

  // Compose the party fare (DEC-112 / DEC-125 build note, 12.2): base + extra-guests ×
  // extraGuestPrice.
  const fare = composeFare({
    baseCents: priceCents,
    guestCount,
    includedGuestCount: effectiveIncludedGuests(offering, vessel),
    extraGuestPriceCents: offering.extraGuestPriceCents,
  });
  // Tax, service fee (DEC-134: the fare only, never tax or tip) and gratuity (DEC-124: untaxed,
  // outside the deposit split) — all on the DISCOUNTED base (DEC-194), which is the composed fare
  // when there is no discount. One computation with the operator's form, which re-totals live.
  const d = applyDiscount({
    fareAndExtrasCents: fare.fareCents,
    requestedCents: input.discountCents ?? 0,
    taxRateBps: config.taxRateBps,
    serviceFeeBps: config.serviceFeeBps,
    gratuityBps,
  });
  // `totalCents` is the whole quote, not the amount charged now: in deposit mode the charge is
  // `chargeNowCents` and the remainder is collected later against this same invoice.
  return {
    // Fare and extras stay undiscounted so a receipt can say what came off (§2.8.4a).
    fareCents: priceCents,
    extrasCents: fare.extrasCents,
    // Only when there is one: an undiscounted invoice is byte-for-byte what it was before 16.5.
    ...(d.discountCents > 0 ? { discountCents: d.discountCents } : {}),
    taxCents: d.taxCents,
    taxRateBps: config.taxRateBps,
    serviceFeeCents: d.serviceFeeCents,
    serviceFeeBps: config.serviceFeeBps,
    gratuityCents: d.gratuityCents,
    gratuityBps,
    totalCents: d.totalCents,
    // What we are about to ask Stripe for, frozen HERE with everything else rather than
    // recomputed at the call site (15.4). It is the one money number the row cannot derive
    // from its own components: the deposit split lives in `config`, which is live and which an
    // operator can move while a card is being typed. Tip is added outside `chargeNowCents` —
    // no deposit-split and no tax on crew money (DEC-124).
    amountDueNowCents:
      chargeNowCents(d.baseCents, d.taxCents, d.serviceFeeCents, config) + d.gratuityCents,
  };
}
