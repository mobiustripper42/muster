/**
 * In-memory repository adapter (DEC-013).
 *
 * Throwaway-thin: backs every aggregate with a Map and the reliability log with
 * an array. Stored values are cloned on the way in and out so a caller can't
 * mutate the store by holding a reference — the one invariant a real DB gives
 * for free that an in-memory store does not. Good enough to drive M0–M3 tests;
 * discarded when a durable adapter lands.
 */

import type {
  Ask,
  CrewMember,
  Event,
  Reservation,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import type {
  AskId,
  CrewMemberId,
  EventId,
  ReservationId,
  SeatId,
  ShiftId,
  VesselId,
} from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { Repository } from "../ports/repository.js";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryRepository implements Repository {
  readonly #vessels = new Map<VesselId, Vessel>();
  readonly #crew = new Map<CrewMemberId, CrewMember>();
  readonly #events = new Map<EventId, Event>();
  readonly #reservations = new Map<ReservationId, Reservation>();
  readonly #shifts = new Map<ShiftId, Shift>();
  readonly #seats = new Map<SeatId, Seat>();
  readonly #asks = new Map<AskId, Ask>();
  readonly #reliability: ReliabilityEvent[] = [];

  // ── Vessels ──────────────────────────────────────────────────────────────
  async saveVessel(vessel: Vessel): Promise<void> {
    this.#vessels.set(vessel.id, clone(vessel));
  }
  async getVessel(id: VesselId): Promise<Vessel | null> {
    const v = this.#vessels.get(id);
    return v ? clone(v) : null;
  }
  async listVessels(): Promise<Vessel[]> {
    return [...this.#vessels.values()].map(clone);
  }

  // ── Crew ───────────────────────────────────────────────────────────────────
  async saveCrewMember(crew: CrewMember): Promise<void> {
    this.#crew.set(crew.id, clone(crew));
  }
  async getCrewMember(id: CrewMemberId): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    return c ? clone(c) : null;
  }
  async listCrewMembers(): Promise<CrewMember[]> {
    return [...this.#crew.values()].map(clone);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  async saveEvent(event: Event): Promise<void> {
    this.#events.set(event.id, clone(event));
  }
  async getEvent(id: EventId): Promise<Event | null> {
    const e = this.#events.get(id);
    return e ? clone(e) : null;
  }
  async listEvents(): Promise<Event[]> {
    return [...this.#events.values()].map(clone);
  }

  // ── Reservations ───────────────────────────────────────────────────────────
  async saveReservation(reservation: Reservation): Promise<void> {
    this.#reservations.set(reservation.id, clone(reservation));
  }
  async getReservation(id: ReservationId): Promise<Reservation | null> {
    const r = this.#reservations.get(id);
    return r ? clone(r) : null;
  }
  async listReservationsForEvent(eventId: EventId): Promise<Reservation[]> {
    return [...this.#reservations.values()]
      .filter((r) => r.eventId === eventId)
      .map(clone);
  }

  // ── Shifts ─────────────────────────────────────────────────────────────────
  async saveShift(shift: Shift): Promise<void> {
    this.#shifts.set(shift.id, clone(shift));
  }
  async getShift(id: ShiftId): Promise<Shift | null> {
    const s = this.#shifts.get(id);
    return s ? clone(s) : null;
  }
  async listShifts(): Promise<Shift[]> {
    return [...this.#shifts.values()].map(clone);
  }

  // ── Seats ──────────────────────────────────────────────────────────────────
  async saveSeat(seat: Seat): Promise<void> {
    this.#seats.set(seat.id, clone(seat));
  }
  async getSeat(id: SeatId): Promise<Seat | null> {
    const s = this.#seats.get(id);
    return s ? clone(s) : null;
  }
  async listSeatsForShift(shiftId: ShiftId): Promise<Seat[]> {
    return [...this.#seats.values()]
      .filter((s) => s.shiftId === shiftId)
      .map(clone);
  }

  // ── Asks ───────────────────────────────────────────────────────────────────
  async saveAsk(ask: Ask): Promise<void> {
    this.#asks.set(ask.id, clone(ask));
  }
  async getAsk(id: AskId): Promise<Ask | null> {
    const a = this.#asks.get(id);
    return a ? clone(a) : null;
  }
  async listAsksForSeat(seatId: SeatId): Promise<Ask[]> {
    return [...this.#asks.values()]
      .filter((a) => a.seatId === seatId)
      .map(clone);
  }

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  async logReliabilityEvent(event: ReliabilityEvent): Promise<void> {
    this.#reliability.push(clone(event));
  }
  async reliabilityEventsFor(
    crewMemberId: CrewMemberId,
  ): Promise<ReliabilityEvent[]> {
    return this.#reliability
      .filter((e) => e.crewMemberId === crewMemberId)
      .map(clone);
  }
}
