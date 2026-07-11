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
  Admin,
  Ask,
  AuthSubjectKind,
  CalendarFeed,
  Credential,
  CrewMember,
  CrewStatus,
  Event,
  LoginCode,
  MagicToken,
  OutboxEntry,
  RingOutboxEntry,
  NoticeOutboxEntry,
  SmsConsent,
  GuestContact,
  PtoWindow,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Subject,
  Vessel,
} from "../domain/entities.js";
import type {
  AskId,
  CredentialId,
  CrewMemberId,
  EventId,
  MagicTokenId,
  OutboxEntryId,
  RingOutboxEntryId,
  NoticeOutboxEntryId,
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
  /**
   * Break-glass contact fix (DEC-094): a TARGETED update of only the passed
   * columns, so a concurrent engine/cockpit write to reliability/status/ratings
   * isn't clobbered by a whole-row read-modify-write (crew_members is written
   * live, unlike the admins table). A key present updates it (`email: null`
   * clears); an omitted key is left untouched. Returns the updated record, or
   * null if no crew member has that id.
   */
  updateCrewContact(
    id: CrewMemberId,
    fields: { name?: string; phone?: string; email?: string | null },
  ): Promise<CrewMember | null>;
  /** Flip active↔inactive (enable/disable) — a targeted status UPDATE, same
   *  lost-update safety as {@link updateCrewContact}. Null if id is unknown. */
  setCrewStatus(id: CrewMemberId, status: CrewStatus): Promise<CrewMember | null>;
  /** Onboard a crew member + their gating credential ATOMICALLY (DEC-094/044).
   *  A half-write (member saved, credential lost) would strand an active crew
   *  record with no MMC — eligible for nothing, and blocked from re-adding by
   *  the id-unique guard. Both land, or neither does. */
  addCrewMemberWithCredential(member: CrewMember, credential: Credential): Promise<void>;

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
  /** Delete one PTO window — the add/remove surfaces (#332). Mirrors
   *  {@link removeCredential}: idempotent, no-op if the id is already gone. */
  removePtoWindow(id: PtoWindowId): Promise<void>;

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
  /**
   * Remove a shift row (DEC-083 merge — tear down the `…-b` side when two split
   * shifts are merged back into one; clearing the cut alone would orphan it). The
   * caller owns referential cleanup: no-FK schema (DEC-DATA-1), so remove the
   * shift's seats first (merge does). No-op if absent.
   */
  removeShift(id: ShiftId): Promise<void>;

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

  // ── Admins (auth identity + per-person revoke — DEC-092, revises DEC-020) ──
  /** Persist an admin (upsert by id). */
  saveAdmin(admin: Admin): Promise<void>;
  /** By id (= a crew id). `readSubject`'s revoke gate reads this, then `active`. */
  getAdmin(id: string): Promise<Admin | null>;
  /** By short mint handle — `db:mint --admin=<handle>` resolves handle→id here. */
  getAdminByHandle(handle: string): Promise<Admin | null>;
  /** Every admin — seeding/diagnostics; the set is small (~3). */
  listAdmins(): Promise<Admin[]>;

  // ── Login codes (crew self-serve sign-in — DEC-081) ────────────────────────
  // A SIBLING to magic tokens, keyed by subject (one live code per subject) so a
  // non-unique 6-digit code can be looked up by WHO and attempt-capped. Only the
  // code's hash is stored.
  /** Persist a code (upsert by `(subjectKind, subjectId)`) — re-request replaces. */
  saveLoginCode(code: LoginCode): Promise<void>;
  /** The subject's current code, or null — verify's first read. */
  getLoginCode(
    subjectKind: AuthSubjectKind,
    subjectId: string,
  ): Promise<LoginCode | null>;
  /**
   * Single-use consume as a compare-and-swap (the MagicToken precedent): set
   * `consumedAt` **only if** still unconsumed; `true` iff this call consumed it.
   * Two concurrent submits of the same code → exactly one `true`.
   */
  consumeLoginCodeIfUnused(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    consumedAt: string,
  ): Promise<boolean>;
  /**
   * Atomically claim one guess against the brute-force cap (10.3, #297). Increments
   * `attempts` **only if** the code is live (unconsumed) and still under
   * `maxAttempts`, returning its `codeHash`/`expiresAt` + the new `attempts`; `null`
   * if there's no such code (gone, consumed, or already at the cap). Check-and-
   * increment is ONE row-locked statement, so K concurrent guesses can't all read
   * the same pre-increment count and blow past the cap — the ceiling is the whole
   * security model (DEC-081), so it must be race-safe, not check-then-bump.
   */
  claimLoginAttempt(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    maxAttempts: number,
  ): Promise<{ codeHash: string; expiresAt: string; attempts: number } | null>;

  // ── Calendar feeds (crew iCal subscription — #355, DEC-098) ────────────────
  // The first PERSISTENT bearer credential. Stores only sha256(token); looked up by
  // hash of the presented token (the MagicToken shape), but persistent + one per
  // crew (`crewMemberId` PK). No re-display — recovery is regenerate (replace).
  /** Mint/replace the crew member's feed (upsert by `crewMemberId`) — rotate = replace. */
  saveCalendarFeed(feed: CalendarFeed): Promise<void>;
  /** The feed whose token hashes to `tokenHash`, or null — the public route's lookup. */
  getCalendarFeedByTokenHash(tokenHash: string): Promise<CalendarFeed | null>;
  /** The crew member's current feed, or null — the UI's "you have a live feed since
   *  `createdAt`" check. Carries no token (hash-only), just existence + timestamps. */
  getCalendarFeedForCrew(crewMemberId: CrewMemberId): Promise<CalendarFeed | null>;
  /** Revoke (hard delete) the crew member's feed. No-op if none. */
  deleteCalendarFeed(crewMemberId: CrewMemberId): Promise<void>;
  /** Best-effort "last synced" stamp — set `lastPolledAt` on a successful fetch.
   *  Keyed by hash (what the route holds); no-op if the feed is gone. */
  touchCalendarFeedPoll(tokenHash: string, polledAt: string): Promise<void>;

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

  // ── Ring outbox entries (doorbell-relay channel adapter state — DEC-073) ───
  // Sibling to the ask outbox, its OWN slot (not a union): the doorbell-ring relay's
  // worklist. Same adapter-side guardrail — only the `OutboxNotificationChannel`
  // writes it, only the ring-outbox view reads it; the domain never does.
  /** Persist a ring entry (upsert by id) — enqueue per ring-cycle, mark-sent. */
  saveRingOutboxEntry(entry: RingOutboxEntry): Promise<void>;
  getRingOutboxEntry(id: RingOutboxEntryId): Promise<RingOutboxEntry | null>;
  /** Every ring entry — the outbox page's "New messages" section + a reset scan. */
  listRingOutboxEntries(): Promise<RingOutboxEntry[]>;
  /** Remove a ring entry (dev-seed reset / housekeeping). No-op if absent. */
  removeRingOutboxEntry(id: RingOutboxEntryId): Promise<void>;

  // ── Notice outbox entries (assignment-change relay adapter state — DEC-084) ─
  // The THIRD operator-relay sibling (asks / rings / notices), its OWN slot: the
  // "you're on/off a shift" relay worklist. Same guardrail — only `OutboxNoticeChannel`
  // writes it, only the notice-outbox view reads it; the domain never does. Terminal-
  // on-sent (a sent notice stays as the record), so no read-cancellation query.
  /** Persist a notice entry (upsert by id) — enqueue, mark-sent. */
  saveNoticeOutboxEntry(entry: NoticeOutboxEntry): Promise<void>;
  getNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<NoticeOutboxEntry | null>;
  /** Every notice entry — the outbox page's "Assignment changes" section + a reset scan. */
  listNoticeOutboxEntries(): Promise<NoticeOutboxEntry[]>;
  /** Remove a notice entry (dev-seed reset / housekeeping). No-op if absent. */
  removeNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<void>;

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  /** Append a reliability event. The log is never mutated, only grown. */
  logReliabilityEvent(event: ReliabilityEvent): Promise<void>;
  /** Read one crew member's events, in insertion order. */
  reliabilityEventsFor(crewMemberId: CrewMemberId): Promise<ReliabilityEvent[]>;

  // ── SMS consent log (Twilio 10DLC opt-in — append-only audit) ──────────────
  // Written best-effort from the crew-login action when a crew member checks the
  // opt-in box (adapter/edge-side; the domain never reads it). Append-only like the
  // reliability log — a standing "they agreed to vX at HH:MM" record, never mutated.
  /** Append an SMS-consent record. */
  recordSmsConsent(consent: SmsConsent): Promise<void>;
  /** One crew member's consent records, insertion order — the audit read. */
  listSmsConsentsForCrew(crewMemberId: CrewMemberId): Promise<SmsConsent[]>;

  // ── Guest contacts (manifest "we texted them" — #345 Part B) ───────────────
  // Written best-effort from the /api/guest-contact route when someone taps a
  // guest's Text button (edge-side; the domain never reads it). Upsert-latest by
  // reservation: one row per booking = who last texted the guest, and when.
  /** Record (upsert-latest) that a guest was texted. */
  recordGuestContact(contact: GuestContact): Promise<void>;
  /** Every guest contact on one shift — the manifest's per-guest ✓ read. */
  listGuestContactsForShift(shiftId: ShiftId): Promise<GuestContact[]>;

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

  // ── Self-claim confirm-gate flag (crew self-serve — DEC-075) ───────────────
  // The seam DEC-075 reserves: when true, a self-claim lands in the (unbuilt)
  // Held/Claimed tier pending operator confirm instead of auto-locking to
  // Confirmed. Typed here — like the engine-pause flag — so the domain never
  // touches the stringly `app_settings` KV (DEC-013).
  /** True if self-claims need operator confirmation. Absent ⇒ false ⇒ auto-lock
   * (mirroring DEC-054's engine_paused absent-⇒-running): a missing row is the
   * MVP default, never a pause toward the reserved tier. */
  selfClaimRequiresConfirmation(): Promise<boolean>;
  /** Set the confirm-gate flag. `at` = ISO-8601 UTC change time (audit). */
  setSelfClaimRequiresConfirmation(value: boolean, at: string): Promise<void>;

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
  /**
   * Every thread that has ≥1 message, id-sorted — the doorbell sweep's domain
   * (6.6b, DEC-070). **Not** time-bounded: §7.4 priority can be flipped on an
   * *old* message, so a `createdAt` window would miss it; a quiet thread instead
   * costs the decider one cheap `all_read` pass. A thread with no message never
   * had a ring to fire, so it's excluded.
   */
  listThreadsWithMessages(): Promise<Thread[]>;
  /**
   * A crew member's DM threads — the participant→thread index (#117, DEC-071).
   * The inverse of `listParticipantsForThread`: which DMs is this person in. The
   * crew thread list needs it (DMs are the one kind with no derivable membership —
   * DEC-051 — so they can't be computed from the schedule like cohort/shift), and
   * it's deliberately NOT a scan of `listThreadsWithMessages` (the doorbell's
   * all-subject sweep, DEC-070) filtered to my rows. Id-sorted for parity; empty
   * when the crew member is in no DMs. 6.8's operator "all conversations" view is a
   * separate query — this stays crew-participant-scoped (DMs have only crew rows).
   */
  listDmThreadsForCrew(crewMemberId: CrewMemberId): Promise<Thread[]>;

  // ── Doorbell read / notify state (6.6a, #116, DEC-069) ─────────────────────
  // Per-(subject,thread) last-read / last-rang — the decider's INJECTED readState
  // and notifyState (DEC-068). Thread-scoped + `subjectKey`-keyed, symmetric with
  // `PresencePort.lastActiveFor`: a never-recorded subject is OMITTED from the map
  // (the decider reads absent → null → fail toward ringing). The edge intersects
  // each map with `deriveMembers` and re-keys to the decider's `memberThreadKey`
  // (6.6b) — so the port stays below the decider, never importing its key helper.
  // Substrate now; the call-sites land later — `recordRead` is the crew-app read
  // path (6.7), `recordNotification` is the doorbell tick on a ring (6.6b).
  /** A thread's last-read marks, keyed by `subjectKey` (`${kind}:${id}`). */
  readStateForThread(threadId: ThreadId): Promise<Map<string, string>>;
  /** A thread's last-rang marks, keyed by `subjectKey`. */
  notifyStateForThread(threadId: ThreadId): Promise<Map<string, string>>;
  /** Upsert a subject's last-read for a thread (latest-wins). */
  recordRead(threadId: ThreadId, subject: Subject, at: string): Promise<void>;
  /** Upsert a subject's last-rang for a thread (latest-wins). */
  recordNotification(threadId: ThreadId, subject: Subject, at: string): Promise<void>;
}
