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
import type { Reservation } from "../domain/entities.js";
import { asId, type EventId, type ReservationId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { canBook } from "./availability.js";

export interface BookingRequest {
  eventId: EventId;
  customerName: string;
  partySize: number;
  email?: string;
  phone?: string;
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
