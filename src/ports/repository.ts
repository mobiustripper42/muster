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
import type { Message, Participant, Thread } from "../messaging/entities.js";
import type { ThreadId } from "../domain/ids.js";

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
  /**
   * Remove a seat row. Used by the builder to prune a surplus **required** seat
   * when a vessel's manning shrinks (SPEC §2.3 reconciliation) — only ever an
   * `Open` orphan; an occupied surplus seat is surfaced for a human, never
   * silently deleted. The caller owns referential cleanup: the schema is no-FK
   * (DEC-DATA-1), so removing a seat that asks/reliability events reference would
   * orphan them — the prune path removes only `Open` seats, which have no asks.
   */
  removeSeat(id: SeatId): Promise<void>;

  // ── Asks ───────────────────────────────────────────────────────────────────
  saveAsk(ask: Ask): Promise<void>;
  getAsk(id: AskId): Promise<Ask | null>;
  listAsksForSeat(seatId: SeatId): Promise<Ask[]>;
  /** Every ask — the integrity diagnostic's orphan scan. */
  listAllAsks(): Promise<Ask[]>;
  /**
   * Remove an ask row (#94). Dev-seed reset primitive: a fixture re-run deletes
   * its prior asks rather than closing them (a closed-with-no-response ask is a
   * real "silent" round, so re-runs would otherwise stack fake history). Real
   * operation never deletes an ask — they're true reliability history. The caller
   * owns referential cleanup (no-FK schema, DEC-DATA-1): an outbox entry
   * referencing the ask must be removed too. No-op if the id is already gone.
   */
  removeAsk(id: AskId): Promise<void>;

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
  /**
   * Delete one token by id — the reaper's remove (#44/3.1b). A single-use,
   * short-lived link past `expiresAt` is dead weight with no children, so it's a
   * hard delete, not a soft mark. No-op if the id is already gone.
   */
  removeMagicToken(id: MagicTokenId): Promise<void>;

  // ── Outbox entries (web-link channel adapter state — DEC-030) ──────────────
  // Adapter-side, like MagicToken: persisted through the port so the operator's
  // outbox survives a restart, but NEVER read by the domain (`src/asks`,
  // `src/builder`, `src/oracle` are forbidden readers — DEC-030 guardrail).
  /** Persist an entry (upsert by id) — enqueue, mark-sent, toggle back. */
  saveOutboxEntry(entry: OutboxEntry): Promise<void>;
  getOutboxEntry(id: OutboxEntryId): Promise<OutboxEntry | null>;
  /** Every entry — the outbox page's worklist + the integrity orphan scan. */
  listOutboxEntries(): Promise<OutboxEntry[]>;
  /**
   * Remove an outbox entry (#94). Adapter-side delete, paired with removeAsk for
   * the dev-seed reset: an entry references an ask, so a fixture re-run drops the
   * entry alongside its ask to keep the relay worklist clean. No-op if absent.
   */
  removeOutboxEntry(id: OutboxEntryId): Promise<void>;

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  /** Append a reliability event. The log is never mutated, only grown. */
  logReliabilityEvent(event: ReliabilityEvent): Promise<void>;
  /** Read one crew member's events, in insertion order. */
  reliabilityEventsFor(crewMemberId: CrewMemberId): Promise<ReliabilityEvent[]>;

  // ── Engine pause flag (operator control — #124, DEC-054) ───────────────────
  // A single mutable ops setting, NOT a domain aggregate: the autonomous engine
  // tick's arm/disarm switch, flipped from /admin without a redeploy. Typed here
  // on purpose — the adapter hides the `app_settings` key/value mapping so the
  // domain/edge never touches stringly-typed KV (DEC-013).
  /** True if the operator has paused the autonomous engine tick. Absent ⇒ false
   * (running): an autonomous "no babysitting" engine must never infer pause from
   * a missing row (DEC-054). */
  isEnginePaused(): Promise<boolean>;
  /** Set the engine paused/running. `at` = ISO-8601 UTC change time (audit). */
  setEnginePaused(paused: boolean, at: string): Promise<void>;

  // ── Import-run audit (operator import observability — #128, DEC-056) ───────
  // Adapter-side, like the outbox (DEC-030): persisted through the port so a run's
  // detail survives, but NEVER read by the domain — the importer returns the
  // envelope; the edge assembles + saves the run.
  /** Persist one import run + its identity rows (atomically). */
  saveImportRun(run: ImportRun, items: ImportRunItem[]): Promise<void>;
  /** Read one run + its items by id — the single-run detail view. Null if absent. */
  getImportRun(
    id: ImportRunId,
  ): Promise<{ run: ImportRun; items: ImportRunItem[] } | null>;
  /**
   * The most recent runs, newest first, capped at `limit` — the import history
   * list (#128 Part B). Returns runs only (not their items); the detail view
   * fetches items on drill-in. Takes an explicit `limit` because, unlike the
   * bounded aggregates, the audit log grows with every hourly cron — the one
   * place the port's no-DSL thinness yields to a cap.
   */
  listImportRuns(limit: number): Promise<ImportRun[]>;

  // ── Messaging (threads / participants / messages — #111, DEC-051) ──────────
  // The in-app group-chat substrate. Membership is DERIVED at read for the three
  // standing kinds (cohort/shift/all-staff, via deriveMembers over shifts/seats/
  // roster) and PERSISTED only for DMs (DEC-051) — so the sole membership rows
  // are `Participant`s, written for DM threads alone. A snapshotted cohort goes
  // stale the moment the schedule moves (the Xola-trap calendar, DEC-009 spirit).
  /**
   * Persist a thread (upsert by id). The standing kinds use a deterministic id
   * (`standingThreadId`), so `getThread(id) ?? saveThread(...)` is an idempotent
   * find-or-create — one thread per (kind, scope), never a duplicate day-thread.
   */
  saveThread(thread: Thread): Promise<void>;
  getThread(id: ThreadId): Promise<Thread | null>;
  /** Persist a DM participant (upsert by id). DM-only by design (DEC-051) — the
   *  derived kinds compute membership and write nothing here. */
  saveParticipant(participant: Participant): Promise<void>;
  /** A (DM) thread's persisted participants — the input `deriveMembers` reads for
   *  `kind: "dm"`. Empty for the derived kinds (they persist no rows). */
  listParticipantsForThread(threadId: ThreadId): Promise<Participant[]>;
  /** Persist a message (upsert by id). */
  saveMessage(message: Message): Promise<void>;
  /** One thread's messages, oldest-first — chronological by `createdAt`, id as the
   *  deterministic tie-break (parity across adapters). */
  listMessagesForThread(threadId: ThreadId): Promise<Message[]>;
}
