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
  Credential,
  CrewMember,
  Event,
  MagicToken,
  OutboxEntry,
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
  MagicTokenId,
  OutboxEntryId,
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
import type { ImportRun, ImportRunItem } from "../import/import-audit.js";
import type { ImportRunId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryRepository implements Repository {
  readonly #roleTypes = new Map<RoleTypeId, RoleType>();
  readonly #vessels = new Map<VesselId, Vessel>();
  readonly #crew = new Map<CrewMemberId, CrewMember>();
  readonly #credentials = new Map<CredentialId, Credential>();
  readonly #ptoWindows = new Map<PtoWindowId, PtoWindow>();
  readonly #events = new Map<EventId, Event>();
  readonly #reservations = new Map<ReservationId, Reservation>();
  readonly #shifts = new Map<ShiftId, Shift>();
  readonly #seats = new Map<SeatId, Seat>();
  readonly #asks = new Map<AskId, Ask>();
  readonly #magicTokens = new Map<MagicTokenId, MagicToken>();
  readonly #outbox = new Map<OutboxEntryId, OutboxEntry>();
  readonly #reliability: ReliabilityEvent[] = [];
  // Engine pause flag (#124, DEC-054). Default false = running, mirroring the
  // KV's "absent row ⇒ running" semantics. `#enginePausedAt` mirrors the DB's
  // audit column (no read path through the port — parity, not a feature).
  #enginePaused = false;
  #enginePausedAt: string | null = null;
  readonly #importRuns = new Map<
    ImportRunId,
    { run: ImportRun; items: ImportRunItem[] }
  >();

  // ── Role types (tenant config — DEC-ROLE-1) ───────────────────────────────
  async saveRoleType(roleType: RoleType): Promise<void> {
    this.#roleTypes.set(roleType.id, clone(roleType));
  }
  async getRoleType(id: RoleTypeId): Promise<RoleType | null> {
    const r = this.#roleTypes.get(id);
    return r ? clone(r) : null;
  }
  async listRoleTypes(tenantId: TenantId): Promise<RoleType[]> {
    return [...this.#roleTypes.values()]
      .filter((r) => r.tenantId === tenantId)
      .map(clone);
  }
  async listAllRoleTypes(): Promise<RoleType[]> {
    return [...this.#roleTypes.values()].map(clone);
  }

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

  // ── Credentials (1:n per crew member — SPEC §2.1) ──────────────────────────
  async saveCredential(credential: Credential): Promise<void> {
    this.#credentials.set(credential.id, clone(credential));
  }
  async getCredential(id: CredentialId): Promise<Credential | null> {
    const c = this.#credentials.get(id);
    return c ? clone(c) : null;
  }
  async listCredentialsForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<Credential[]> {
    return [...this.#credentials.values()]
      .filter((c) => c.crewMemberId === crewMemberId)
      .map(clone);
  }
  async listAllCredentials(): Promise<Credential[]> {
    return [...this.#credentials.values()].map(clone);
  }
  async removeCredential(id: CredentialId): Promise<void> {
    this.#credentials.delete(id);
  }

  // ── PTO windows (suppression-only — DEC-009) ───────────────────────────────
  async savePtoWindow(window: PtoWindow): Promise<void> {
    this.#ptoWindows.set(window.id, clone(window));
  }
  async listPtoWindowsForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<PtoWindow[]> {
    return [...this.#ptoWindows.values()]
      .filter((w) => w.crewMemberId === crewMemberId)
      .map(clone);
  }
  async listAllPtoWindows(): Promise<PtoWindow[]> {
    return [...this.#ptoWindows.values()].map(clone);
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
  async listAllReservations(): Promise<Reservation[]> {
    return [...this.#reservations.values()].map(clone);
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
  async saveSeatIfState(seat: Seat, expectedState: SeatState): Promise<boolean> {
    // Single-threaded JS makes this trivially atomic here; the contract it
    // upholds is what matters — the Postgres adapter enforces the same CAS under
    // real concurrency (REQ-CLAIM-1, DEC-020).
    const current = this.#seats.get(seat.id);
    if (!current || current.state !== expectedState) return false;
    this.#seats.set(seat.id, clone(seat));
    return true;
  }
  async removeSeat(id: SeatId): Promise<void> {
    this.#seats.delete(id);
  }
  async listSeatsForShift(shiftId: ShiftId): Promise<Seat[]> {
    return [...this.#seats.values()]
      .filter((s) => s.shiftId === shiftId)
      .map(clone);
  }
  async listAllSeats(): Promise<Seat[]> {
    return [...this.#seats.values()].map(clone);
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
  async listAllAsks(): Promise<Ask[]> {
    return [...this.#asks.values()].map(clone);
  }
  async removeAsk(id: AskId): Promise<void> {
    this.#asks.delete(id);
  }

  // ── Magic-link tokens (self-rolled auth — DEC-010, DEC-020) ────────────────
  async saveMagicToken(token: MagicToken): Promise<void> {
    this.#magicTokens.set(token.id, clone(token));
  }
  async getMagicTokenByHash(tokenHash: string): Promise<MagicToken | null> {
    const t = [...this.#magicTokens.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    return t ? clone(t) : null;
  }
  async consumeMagicTokenIfUnused(
    tokenHash: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-threaded JS makes this atomic here; the contract it upholds is what
    // matters — Postgres enforces the same single-use CAS under real concurrency.
    const current = [...this.#magicTokens.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    if (!current || current.consumedAt !== undefined) return false;
    this.#magicTokens.set(current.id, clone({ ...current, consumedAt }));
    return true;
  }
  async listAllMagicTokens(): Promise<MagicToken[]> {
    return [...this.#magicTokens.values()].map(clone);
  }
  async removeMagicToken(id: MagicTokenId): Promise<void> {
    this.#magicTokens.delete(id);
  }

  // ── Outbox entries (web-link channel adapter state — DEC-030) ──────────────
  async saveOutboxEntry(entry: OutboxEntry): Promise<void> {
    this.#outbox.set(entry.id, clone(entry));
  }
  async getOutboxEntry(id: OutboxEntryId): Promise<OutboxEntry | null> {
    const e = this.#outbox.get(id);
    return e ? clone(e) : null;
  }
  async listOutboxEntries(): Promise<OutboxEntry[]> {
    return [...this.#outbox.values()].map(clone);
  }
  async removeOutboxEntry(id: OutboxEntryId): Promise<void> {
    this.#outbox.delete(id);
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

  // ── Engine pause flag (operator control — #124, DEC-054) ───────────────────
  async isEnginePaused(): Promise<boolean> {
    return this.#enginePaused;
  }
  async setEnginePaused(paused: boolean, at: string): Promise<void> {
    this.#enginePaused = paused;
    this.#enginePausedAt = at;
  }

  // ── Import-run audit (#128) ────────────────────────────────────────────────
  async saveImportRun(run: ImportRun, items: ImportRunItem[]): Promise<void> {
    this.#importRuns.set(run.id, clone({ run, items }));
  }
  async getImportRun(
    id: ImportRunId,
  ): Promise<{ run: ImportRun; items: ImportRunItem[] } | null> {
    const r = this.#importRuns.get(id);
    return r ? clone(r) : null;
  }
}
