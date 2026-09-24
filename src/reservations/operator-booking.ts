/**
 * The operator books (16.1, SPEC §2.10.6) — someone rings up, and the operator takes the booking.
 *
 * **What it writes.** A `pending` reservation with `source: "admin"`, on the boat the operator
 * clicked, priced by the same model as public checkout (`booking-invoice.ts`). It holds the boat
 * at once and never lapses — no `reservedAt`, so there is no window to compute (DEC-163) — until
 * the customer pays the link (16.1a) or a person cancels it. No Event: that appears at confirm,
 * like any other sale (§2.8.2), which is also what keeps issue #945's defect from arming.
 *
 * **What it does not take.** No card (DEC-162). No waiver consent: that is the customer's to give,
 * not the operator's, so it is collected where the customer pays. No holder token: that is a
 * browser's proof of possession, and there is no browser here.
 *
 * **Which rules.** `OPERATOR_RULES` — the grid and the season pass; a block, the hull, capacity
 * and a departed trip refuse. See `claim.ts`.
 */
import type { Reservation } from "../domain/entities.js";
import type { OfferingId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { canonicalizePhone } from "../customers/identity.js";
import { priceBooking } from "./booking-invoice.js";
import { claimDepartureSlot, OPERATOR_RULES } from "./claim.js";
import { mintPendingReservationId } from "./create-departure-payment-intent.js";
import { candidateHoldMinutes, XOLA_TRIP_MINUTES } from "./hull-busy.js";
import { gratuityTiersFor } from "./pricing.js";

export interface OperatorBookingRequest {
  offeringId: OfferingId;
  /** The boat whose slot the operator clicked. */
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  /** One of the offering's tiers, asked on the phone the way checkout asks it (DEC-124). */
  gratuityBps: number;
  customerName: string;
  /** Required and canonicalized — the customer's identity key (DEC-132), and where the link goes. */
  phone: string;
  email?: string | undefined;
}

export type OperatorBookingResult =
  | { ok: true; reservation: Reservation }
  | {
      ok: false;
      reason:
        | "name_required"
        | "phone_invalid"
        | "gratuity_required"
        | "offering_missing"
        | "not_live"
        | "invalid_guest_count"
        | "off_schedule"
        | "departed"
        | "over_capacity"
        | "vessel_not_offered"
        /** An operator block covers the slot — unblock it on the calendar first. */
        | "blocked"
        /** Another trip or a live checkout holds the hull over this departure. */
        | "busy";
    };

export async function bookForCustomer(
  repo: Repository,
  req: OperatorBookingRequest,
  now: () => string,
): Promise<OperatorBookingResult> {
  const customerName = req.customerName.trim();
  if (!customerName) return { ok: false, reason: "name_required" };
  const phone = canonicalizePhone(req.phone);
  if (!phone.ok) return { ok: false, reason: "phone_invalid" };
  const email = req.email?.trim();

  // Read once; a null offering falls through to the claim's `offering_missing`.
  const offering = await repo.getOffering(req.offeringId);
  if (offering && !gratuityTiersFor(offering).includes(req.gratuityBps)) {
    return { ok: false, reason: "gratuity_required" };
  }
  const config = await repo.getPaymentConfig();
  const events = await repo.listEvents();
  const vesselById = new Map((await repo.listVessels()).map((v) => [String(v.id), v]));

  const claim = await claimDepartureSlot(
    repo,
    {
      offeringId: req.offeringId,
      date: req.date,
      time: req.time,
      guestCount: req.guestCount,
      vesselId: req.vesselId,
    },
    (vesselId, _prior, at): Reservation => {
      // The claim only calls this for a boat it read out of `listVessels`, and a missing offering
      // returned before it got here — so both are asserted rather than defaulted: a null must
      // throw, never price the trip at nothing.
      const vessel = vesselById.get(String(vesselId));
      if (!offering || !vessel) throw new Error(`cannot price ${String(vesselId)}: offering or vessel missing`);
      return {
        id: mintPendingReservationId(),
        eventId: null,
        source: "admin",
        status: "pending",
        customerName,
        partySize: req.guestCount,
        vesselId,
        date: req.date,
        time: req.time,
        offeringId: offering.id,
        // Frozen now, like any booking (DEC-161): an offering edit before the customer pays must
        // not change what the hull owes this one.
        holdMinutes: candidateHoldMinutes(offering),
        tripMinutes: offering.tripLengthMinutes ?? XOLA_TRIP_MINUTES,
        invoice: priceBooking({
          offering,
          vessel,
          vesselId,
          events,
          config,
          date: req.date,
          time: req.time,
          guestCount: req.guestCount,
          gratuityBps: req.gratuityBps,
        }),
        phone: phone.phone,
        ...(email ? { email } : {}),
        updatedAt: at,
      };
    },
    now,
    OPERATOR_RULES,
  );

  if ("unbookable" in claim) return { ok: false, reason: claim.unbookable };
  if ("soldOut" in claim) return { ok: false, reason: "busy" };
  return { ok: true, reservation: claim.claimed };
}
