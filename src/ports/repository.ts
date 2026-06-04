/**
 * The repository port (DEC-013).
 *
 * The domain core talks to persistence only through this interface. M0–M3 run
 * against a throwaway in-memory adapter; the durable adapter (SQLite, then the
 * M4 web DB) is swapped in behind this port without touching the core.
 *
 * Deliberately thin: per-aggregate save/get/list plus an append-only reliability
 * log. No querying DSL, no transactions, no unit-of-work — those arrive (if ever)
 * with a real database, not speculatively here.
 */

import type {
  Ask,
  Credential,
  CrewMember,
  Event,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import type {
  AskId,
  CredentialId,
  CrewMemberId,
  EventId,
  ReservationId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  VesselId,
} from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/reliability.js";

export interface Repository {
  // ── Role types (tenant config — DEC-ROLE-1) ───────────────────────────────
  saveRoleType(roleType: RoleType): Promise<void>;
  getRoleType(id: RoleTypeId): Promise<RoleType | null>;
  /** All role types a tenant has defined — the set seat derivation resolves against. */
  listRoleTypes(tenantId: TenantId): Promise<RoleType[]>;

  // ── Vessels ──────────────────────────────────────────────────────────────
  saveVessel(vessel: Vessel): Promise<void>;
  getVessel(id: VesselId): Promise<Vessel | null>;
  listVessels(): Promise<Vessel[]>;

  // ── Crew ───────────────────────────────────────────────────────────────────
  saveCrewMember(crew: CrewMember): Promise<void>;
  getCrewMember(id: CrewMemberId): Promise<CrewMember | null>;
  listCrewMembers(): Promise<CrewMember[]>;

  // ── Credentials (1:n per crew member — SPEC §2.1) ──────────────────────────
  saveCredential(credential: Credential): Promise<void>;
  getCredential(id: CredentialId): Promise<Credential | null>;
  /** All credential rows for one crew member — the set the oracle date-checks. */
  listCredentialsForCrew(crewMemberId: CrewMemberId): Promise<Credential[]>;
  /** Remove a credential row (SPEC §2.1 action). */
  removeCredential(id: CredentialId): Promise<void>;

  // ── Events ─────────────────────────────────────────────────────────────────
  saveEvent(event: Event): Promise<void>;
  getEvent(id: EventId): Promise<Event | null>;
  listEvents(): Promise<Event[]>;

  // ── Reservations ───────────────────────────────────────────────────────────
  saveReservation(reservation: Reservation): Promise<void>;
  getReservation(id: ReservationId): Promise<Reservation | null>;
  listReservationsForEvent(eventId: EventId): Promise<Reservation[]>;

  // ── Shifts ─────────────────────────────────────────────────────────────────
  saveShift(shift: Shift): Promise<void>;
  getShift(id: ShiftId): Promise<Shift | null>;
  listShifts(): Promise<Shift[]>;

  // ── Seats ──────────────────────────────────────────────────────────────────
  saveSeat(seat: Seat): Promise<void>;
  getSeat(id: SeatId): Promise<Seat | null>;
  listSeatsForShift(shiftId: ShiftId): Promise<Seat[]>;

  // ── Asks ───────────────────────────────────────────────────────────────────
  saveAsk(ask: Ask): Promise<void>;
  getAsk(id: AskId): Promise<Ask | null>;
  listAsksForSeat(seatId: SeatId): Promise<Ask[]>;

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  /** Append a reliability event. The log is never mutated, only grown. */
  logReliabilityEvent(event: ReliabilityEvent): Promise<void>;
  /** Read one crew member's events, in insertion order. */
  reliabilityEventsFor(crewMemberId: CrewMemberId): Promise<ReliabilityEvent[]>;
}
