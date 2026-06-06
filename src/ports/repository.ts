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
  MagicToken,
  PtoWindow,
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
  PtoWindowId,
  ReservationId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  VesselId,
} from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { SeatState } from "../domain/states.js";

export interface Repository {
  // ── Role types (tenant config — DEC-ROLE-1) ───────────────────────────────
  saveRoleType(roleType: RoleType): Promise<void>;
  getRoleType(id: RoleTypeId): Promise<RoleType | null>;
  /** All role types a tenant has defined — the set seat derivation resolves against. */
  listRoleTypes(tenantId: TenantId): Promise<RoleType[]>;
  /** Every role type, all tenants — the integrity diagnostic's parent set. */
  listAllRoleTypes(): Promise<RoleType[]>;

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
  /** Every credential row — the integrity diagnostic's orphan scan. */
  listAllCredentials(): Promise<Credential[]>;
  /** Remove a credential row (SPEC §2.1 action). */
  removeCredential(id: CredentialId): Promise<void>;

  // ── PTO windows (1:n per crew member — SPEC §2.1, DEC-009) ─────────────────
  // Suppression-only by design (DEC-009): a window means "unavailable"; absence
  // means available. The oracle's "not on PTO" crew rule (§1.3) reads these.
  savePtoWindow(window: PtoWindow): Promise<void>;
  /** All PTO windows for one crew member — the set the oracle date-checks. */
  listPtoWindowsForCrew(crewMemberId: CrewMemberId): Promise<PtoWindow[]>;
  /** Every PTO window — the integrity diagnostic's orphan scan. */
  listAllPtoWindows(): Promise<PtoWindow[]>;

  // ── Events ─────────────────────────────────────────────────────────────────
  saveEvent(event: Event): Promise<void>;
  getEvent(id: EventId): Promise<Event | null>;
  listEvents(): Promise<Event[]>;

  // ── Reservations ───────────────────────────────────────────────────────────
  saveReservation(reservation: Reservation): Promise<void>;
  getReservation(id: ReservationId): Promise<Reservation | null>;
  listReservationsForEvent(eventId: EventId): Promise<Reservation[]>;
  /** Every reservation — the integrity diagnostic's orphan scan. */
  listAllReservations(): Promise<Reservation[]>;

  // ── Shifts ─────────────────────────────────────────────────────────────────
  saveShift(shift: Shift): Promise<void>;
  getShift(id: ShiftId): Promise<Shift | null>;
  listShifts(): Promise<Shift[]>;

  // ── Seats ──────────────────────────────────────────────────────────────────
  saveSeat(seat: Seat): Promise<void>;
  getSeat(id: SeatId): Promise<Seat | null>;
  listSeatsForShift(shiftId: ShiftId): Promise<Seat[]>;
  /** Every seat — the integrity diagnostic's orphan scan. */
  listAllSeats(): Promise<Seat[]>;
  /**
   * Compare-and-swap write — the atomic first-come claim (REQ-CLAIM-1, DEC-020 /
   * DEC-DATA-1). Persists `seat` **only if** the stored row is still in
   * `expectedState`; returns `true` if it applied, `false` if the state had
   * already moved (lost the race). The seat must already exist. The guarantee
   * lives here in the port — identical across adapters, never an RLS policy or
   * trigger — so the ask loop's read-then-write claim becomes a single atomic step
   * against real Postgres.
   */
  saveSeatIfState(seat: Seat, expectedState: SeatState): Promise<boolean>;

  // ── Asks ───────────────────────────────────────────────────────────────────
  saveAsk(ask: Ask): Promise<void>;
  getAsk(id: AskId): Promise<Ask | null>;
  listAsksForSeat(seatId: SeatId): Promise<Ask[]>;
  /** Every ask — the integrity diagnostic's orphan scan. */
  listAllAsks(): Promise<Ask[]>;

  // ── Magic-link tokens (self-rolled auth — DEC-010, DEC-020) ────────────────
  /** Persist a token (upsert by id). Only the secret's hash is stored. */
  saveMagicToken(token: MagicToken): Promise<void>;
  /** Look one up by `hashSecret(secret)` — verify's first read. */
  getMagicTokenByHash(tokenHash: string): Promise<MagicToken | null>;
  /**
   * Single-use consume as a compare-and-swap (REQ-CLAIM-1 sibling): set
   * `consumedAt` **only if** still unconsumed; returns `true` if this call
   * consumed it, `false` if it was already spent (or absent). Two concurrent
   * link taps → exactly one `true`. Never a trigger; the guarantee lives here.
   */
  consumeMagicTokenIfUnused(
    tokenHash: string,
    consumedAt: string,
  ): Promise<boolean>;
  /** Every token — the integrity diagnostic's orphan scan (crew subjects). */
  listAllMagicTokens(): Promise<MagicToken[]>;

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  /** Append a reliability event. The log is never mutated, only grown. */
  logReliabilityEvent(event: ReliabilityEvent): Promise<void>;
  /** Read one crew member's events, in insertion order. */
  reliabilityEventsFor(crewMemberId: CrewMemberId): Promise<ReliabilityEvent[]>;
}
