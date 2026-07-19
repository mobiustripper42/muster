/**
 * Booking write (Phase 11.3, DEC-109) — the correctness hinge for Muster-native
 * reservations. Composes 11.1's pure `canBook` pre-check with the authoritative atomic
 * claim (`saveReservationIfUnclaimed`) so two simultaneous checkouts of the same
 * whole-boat event can't both win.
 *
 * **Provider-agnostic.** Idempotency is a caller-supplied key → a deterministic
 * reservation id; a retried call short-circuits to `already` and the CAS's
 * `ON CONFLICT (id)` prevents any double-write. Nothing here imports Stripe — the
 * deferred `checkout.session.completed` webhook (11.2) is a thin translator that builds
 * a `BookingRequest` and passes `checkout.session.id` as the `idempotencyKey`.
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
import { canBook, eventIdForSlot } from "./availability.js";

export interface BookingRequest {
  eventId: EventId;
  customerName: string;
  partySize: number;
  email?: string;
  phone?: string;
  /** Liability-waiver consent (11.5, DEC-110) — carried from the checkout metadata
   *  (gated required at checkout-start, so a booked reservation always has both). */
  waiverConsentAt?: string;
  waiverVersion?: string;
  /**
   * Provider-agnostic idempotency key. Two requests with the same key resolve to the
   * same reservation, so a retry is a no-op. The Stripe webhook (11.2) passes
   * `checkout.session.id`.
   */
  idempotencyKey: string;
}

export type BookingResult =
  /** This call won the boat and wrote the reservation. */
  | { outcome: "booked"; reservation: Reservation }
  /** An identical prior/concurrent call already wrote this reservation — idempotent. */
  | { outcome: "already"; reservation: Reservation }
  /** A DIFFERENT party holds the boat — the refund-and-notify seam (paid-but-lost). */
  | { outcome: "lost" }
  /** The request can't be booked at all. */
  | {
      outcome: "unbookable";
      reason: "event_missing" | "not_sellable" | "invalid_party" | "already_claimed";
    };

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
export async function writeBooking(
  repo: Repository,
  req: BookingRequest,
  now: () => string,
): Promise<BookingResult> {
  const id = reservationIdFor(req.idempotencyKey);

  // Idempotent retry: a prior identical call already wrote this reservation → never re-claim.
  const prior = await repo.getReservation(id);
  if (prior) return { outcome: "already", reservation: prior };

  const event = await repo.getEvent(req.eventId);
  if (!event) return { outcome: "unbookable", reason: "event_missing" };
  if (event.source !== "muster" || event.status !== "scheduled") {
    return { outcome: "unbookable", reason: "not_sellable" };
  }
  if (!Number.isInteger(req.partySize) || req.partySize < 1 || req.partySize > event.capacity) {
    return { outcome: "unbookable", reason: "invalid_party" };
  }

  // Fast pre-check (11.1) — cheap reject before the transactional claim. Sellable +
  // party already hold here, so this reduces to the mutex read; the CAS is authoritative.
  if (!canBook(event, await repo.listReservationsForEvent(req.eventId), req.partySize)) {
    return { outcome: "unbookable", reason: "already_claimed" };
  }

  const reservation: Reservation = {
    id,
    eventId: req.eventId,
    source: "muster",
    customerName: req.customerName,
    partySize: req.partySize,
    ...(req.email !== undefined ? { email: req.email } : {}),
    ...(req.phone !== undefined ? { phone: req.phone } : {}),
    ...(req.waiverConsentAt !== undefined ? { waiverConsentAt: req.waiverConsentAt } : {}),
    ...(req.waiverVersion !== undefined ? { waiverVersion: req.waiverVersion } : {}),
    status: "booked",
    updatedAt: now(),
  };

  if (await repo.saveReservationIfUnclaimed(reservation)) {
    return { outcome: "booked", reservation };
  }
  // Lost the CAS — either a rival won the boat, or a concurrent identical retry wrote
  // first. Disambiguate: our id present ⇒ idempotent `already`; else a rival ⇒ `lost`.
  const after = await repo.getReservation(id);
  return after ? { outcome: "already", reservation: after } : { outcome: "lost" };
}

// ── Slot-first booking (12.1a, DEC-109/125) ──────────────────────────────────
// The virtual-model write: the customer picked offering+time+guestCount, a hold assigned a
// boat, and the webhook now materializes the Event at its slot identity + claims the mutex
// atomically (`saveBookingIfSlotFree`). Supersedes the seeded-`Event` `writeBooking` above;
// the old path stays until 12.8 retires the seeded model.

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
  const vessel = await repo.getVessel(req.vesselId);
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
  };
  const reservation: Reservation = {
    id,
    eventId,
    source: "muster",
    customerName: req.customerName,
    partySize: req.guestCount,
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
