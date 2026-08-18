/**
 * Booking write (DEC-109/125) — the correctness hinge for Muster-native reservations. Composes
 * 11.1's pure `canBook` pre-check with the authoritative atomic claim (`saveBookingIfSlotFree`)
 * so two simultaneous checkouts of the same whole-boat slot can't both win.
 *
 * The 11.3 half of this module — `writeBooking`, claiming a pre-existing `Event` by row-locking
 * its id — was retired at #693. It never received #691's hull-overlap guard or hull-day advisory
 * lock, so it still reverted to the behaviour where two overlapping trips on one hull both
 * succeed; nothing minted sessions for it, which made it an unguarded fallback rather than a
 * removed path.
 *
 * **Provider-agnostic.** Idempotency is a caller-supplied key → a deterministic
 * reservation id; a retried call short-circuits to `already` and the CAS's
 * `ON CONFLICT (id)` prevents any double-write. Nothing here imports Stripe — the
 * deferred `checkout.session.completed` webhook (11.2) is a thin translator that builds
 * a `SlotBookingRequest` and passes `checkout.session.id` as the `idempotencyKey`.
 */
import { createHash } from "node:crypto";
import type { Event, Reservation } from "../domain/entities.js";
import {
  asId,
  type EventId,
  type OfferingId,
  type ReservationId,
  type VesselId,
} from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { eventIdForSlot } from "./availability.js";
import { resolveCustomerId } from "../customers/resolve.js";

/**
 * Deterministic reservation id from the idempotency key — same key ⇒ same id, so a
 * retried booking targets the same row (short-circuit + `ON CONFLICT (id)`).
 */
export function reservationIdFor(idempotencyKey: string): ReservationId {
  const h = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  return asId<"ReservationId">(`resv-${h}`);
}

/**
 * Write a Muster-native reservation under the whole-boat claim. `now` is injected
 * (house style) for a deterministic `updatedAt`.
 */

// ── Slot-first booking (12.1a, DEC-109/125) ──────────────────────────────────
// The virtual-model write: the customer picked offering+time+guestCount, a hold assigned a
// boat, and the webhook now materializes the Event at its slot identity + claims the mutex
// atomically (`saveBookingIfSlotFree`). It superseded the seeded-`Event` `writeBooking`, which
// this module no longer carries — #693 retired it rather than waiting for 12.8, because it was
// an unguarded fallback on the money path and nothing minted sessions for it.

export interface SlotBookingRequest {
  offeringId: OfferingId;
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  /** Display base resolved at checkout-start (DEC-125), frozen onto the materialized Event
   *  so a later schedule/price edit never alters what this customer paid (DEC-125). */
  priceCents: number;
  /** Extra-guest surcharge portion of the fare, in cents (`composeFare`), FROZEN onto the
   *  reservation (#474) so the deposit-mode balance deriver collects the extras too. Absent
   *  ⇒ 0 (guests within the included count, or a pre-composition caller). */
  extrasCents?: number;
  customerName: string;
  email?: string;
  phone?: string;
  waiverConsentAt?: string;
  waiverVersion?: string;
  /** Stripe session id — keys the deterministic reservation id (idempotent redelivery). */
  idempotencyKey: string;
}

export type SlotBookingResult =
  | { outcome: "booked"; reservation: Reservation; eventId: EventId }
  | { outcome: "already"; reservation: Reservation }
  | { outcome: "lost" };

/**
 * Materialize + claim a virtual slot under the pessimistic backstop. `now` injected for a
 * deterministic `updatedAt`. On a win, releases the checkout-hold (the booking now holds the
 * slot authoritatively). On loss, disambiguates idempotent retry (`already`) from a genuine
 * residual-race loss (`lost` — the 12.1b refund seam).
 */
export async function writeSlotBooking(
  repo: Repository,
  req: SlotBookingRequest,
  now: () => string,
): Promise<SlotBookingResult> {
  const id = reservationIdFor(req.idempotencyKey);
  const prior = await repo.getReservation(id);
  if (prior) return { outcome: "already", reservation: prior };

  const eventId = eventIdForSlot(req.vesselId, req.date, req.time);
  const [vessel, offering] = await Promise.all([
    repo.getVessel(req.vesselId),
    repo.getOffering(req.offeringId),
  ]);
  const candidateEvent: Event = {
    id: eventId,
    vesselId: req.vesselId,
    date: req.date,
    time: req.time,
    // The whole-boat COI cap is the party ceiling (DEC-108/109). Fall back to the guest
    // count only if the vessel row is somehow missing (config error, not a race).
    capacity: vessel?.coiMaxPax ?? req.guestCount,
    status: "scheduled",
    source: "muster",
    price: req.priceCents,
    // Trip length FROZEN off the offering at materialization (#570), the same reason
    // `price` is frozen one line up: a later edit to the offering must not change how
    // long a trip that already ran was. Downstream this sets the shift's end, so it
    // decides when the completion sweep pays out reliability. Absent on the offering ⇒
    // omitted, and `eventDurationMinutes` falls back to the flat DEC-041 constant.
    ...(offering?.tripLengthMinutes !== undefined
      ? { durationMinutes: offering.tripLengthMinutes }
      : {}),
  };
  // Same get-or-create as the seeded path (12.12b, DEC-132) — this is the LIVE booking path.
  const customerId = await resolveCustomerId(repo, req, now);

  const reservation: Reservation = {
    id,
    eventId,
    source: "muster",
    customerName: req.customerName,
    partySize: req.guestCount,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(req.extrasCents !== undefined ? { extrasCents: req.extrasCents } : {}),
    ...(req.email !== undefined ? { email: req.email } : {}),
    ...(req.phone !== undefined ? { phone: req.phone } : {}),
    ...(req.waiverConsentAt !== undefined ? { waiverConsentAt: req.waiverConsentAt } : {}),
    ...(req.waiverVersion !== undefined ? { waiverVersion: req.waiverVersion } : {}),
    status: "booked",
    updatedAt: now(),
  };

  const res = await repo.saveBookingIfSlotFree(candidateEvent, reservation);
  if (res.result === "won") {
    // The booking now holds the slot authoritatively — release the transient hold (by slot,
    // since its id was a per-attempt mint we don't carry through the webhook).
    await repo.removeCheckoutHoldForSlot(req.vesselId, req.date, req.time);
    return {
      outcome: "booked",
      reservation: { ...reservation, eventId: res.eventId },
      eventId: res.eventId,
    };
  }
  const after = await repo.getReservation(id);
  return after ? { outcome: "already", reservation: after } : { outcome: "lost" };
}
