/**
 * Customer-facing availability for Muster-native reservations (Phase 11.1; DEC-108/109
 * as amended for the whole-boat model). **Distinct from the crew-eligibility oracle**
 * (`src/oracle`) — that answers "who may crew this seat"; this answers "can a customer
 * book this boat".
 *
 * BrewBoat sells **whole-boat-private** charters, one reservationist per boat-event
 * (DEC-105, `docs/design/reservations-model.md`). So availability is a **mutex, not a
 * seat count**: an event is available iff it carries ZERO active (`booked`)
 * `source='muster'` reservations — remaining is a step function (`capacity` when
 * unclaimed, `0` when claimed), NEVER `COI max − Σ party sizes`. Party size is bounded
 * by the boat's COI cap (`Event.capacity`), checked in `canBook`.
 *
 * Only `source='muster'`, `scheduled` events are sellable through Muster — Xola events
 * keep their money in Xola (DEC-105) and never appear in this funnel. The schema stays
 * n:1 on reservations→event (multi-reservation-per-event is not precluded, DEC-109); the
 * whole-boat rule lives HERE in the predicate, not as a DB constraint.
 */
import type { Event, Reservation } from "../domain/entities.js";
import type { EventId, VesselId } from "../domain/ids.js";

export interface EventAvailability {
  eventId: EventId;
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock, e.g. "17:00". */
  time: string;
  /** Whole-boat COI cap — the party-size ceiling (DEC-108/109). */
  capacity: number;
  /** Per-event price in integer cents (DEC-112); absent if unpriced. */
  price?: number;
  /** Whole-boat mutex: true iff this Muster event has NO active reservation. */
  available: boolean;
}

/** Is `r` a live claim on a Muster boat-event? (booked + Muster-owned). */
function isActiveMusterClaim(r: Reservation): boolean {
  return r.source === "muster" && r.status === "booked";
}

/**
 * Availability for every sellable (Muster-owned, scheduled) event. Pure — feed it
 * `repo.listEvents()` + `repo.listAllReservations()`. The caller (the P11 harness / P12
 * page) filters to `available` for a browse-and-pick surface.
 */
export function deriveAvailability(
  events: readonly Event[],
  reservations: readonly Reservation[],
): EventAvailability[] {
  const claimed = new Set<string>();
  for (const r of reservations) {
    if (isActiveMusterClaim(r)) claimed.add(String(r.eventId));
  }
  return events
    .filter((e) => e.source === "muster" && e.status === "scheduled")
    .map((e) => ({
      eventId: e.id,
      vesselId: e.vesselId,
      date: e.date,
      time: e.time,
      capacity: e.capacity,
      ...(e.price !== undefined ? { price: e.price } : {}),
      available: !claimed.has(String(e.id)),
    }));
}

/**
 * The whole-boat claim predicate — the customer side of DEC-109. A party may book iff:
 * the event is a scheduled Muster event, the party fits the boat's COI cap
 * (`1 ≤ party ≤ capacity`), and the event is **unclaimed** by any active Muster
 * reservation. Pure + synchronous; 11.3's webhook wraps it in an atomic (CAS)
 * transaction so two simultaneous checkouts can't both win — the predicate itself never
 * mutates.
 */
export function canBook(
  event: Event,
  reservations: readonly Reservation[],
  partySize: number,
): boolean {
  if (event.source !== "muster" || event.status !== "scheduled") return false;
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > event.capacity) {
    return false;
  }
  return !reservations.some(
    (r) => String(r.eventId) === String(event.id) && isActiveMusterClaim(r),
  );
}
