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
import { chargeNowCents, feeCentsFor, taxCentsFor, type PaymentConfig } from "./payment-config.js";
import { composeFare, effectiveIncludedGuests, gratuityCentsFor } from "./pricing.js";

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
  const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
  // Service fee (DEC-134): `serviceFeeBps` of the FARE only — independent of tax and tip,
  // charged IN FULL with the now-charge (like tax), frozen here, netted out of the balance.
  const serviceFeeCents = feeCentsFor(fare.fareCents, config.serviceFeeBps);
  // Gratuity (DEC-124): a % of the tip-free fare, added to the charge IN FULL and UNTAXED —
  // never through `chargeNowCents` (no deposit-split) or `taxCentsFor` (no tax). Crew money.
  const gratuityCents = gratuityCentsFor(fare.fareCents, gratuityBps);
  // `totalCents` is the whole quote, not the amount charged now: in deposit mode the charge is
  // `chargeNowCents` and the remainder is collected later against this same invoice.
  return {
    fareCents: priceCents,
    extrasCents: fare.extrasCents,
    taxCents,
    taxRateBps: config.taxRateBps,
    serviceFeeCents,
    serviceFeeBps: config.serviceFeeBps,
    gratuityCents,
    gratuityBps,
    totalCents: fare.fareCents + taxCents + serviceFeeCents + gratuityCents,
    // What we are about to ask Stripe for, frozen HERE with everything else rather than
    // recomputed at the call site (15.4). It is the one money number the row cannot derive
    // from its own components: the deposit split lives in `config`, which is live and which an
    // operator can move while a card is being typed. Tip is added outside `chargeNowCents` —
    // no deposit-split and no tax on crew money (DEC-124).
    amountDueNowCents: chargeNowCents(fare.fareCents, taxCents, serviceFeeCents, config) + gratuityCents,
  };
}
