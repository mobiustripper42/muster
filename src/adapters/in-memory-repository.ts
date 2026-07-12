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
  Admin,
  Ask,
  AuthSubjectKind,
  Credential,
  CrewMember,
  CrewStatus,
  Event,
  LoginCode,
  CalendarFeed,
  MusterOwnedVesselDay,
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
import { subjectKey } from "../domain/subject.js";
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
import type { MessageId, ParticipantId, ThreadId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

const clone = <T>(value: T): T => structuredClone(value);

/** Upsert `subjectKey → at` into a threadId→(subjectKey→ISO) store (latest-wins). */
const upsertThreadState = (
  store: Map<string, Map<string, string>>,
  threadId: ThreadId,
  subject: Subject,
  at: string,
): void => {
  const key = String(threadId);
  const inner = store.get(key) ?? new Map<string, string>();
  inner.set(subjectKey(subject), at);
  store.set(key, inner);
};

export class InMemoryRepository implements Repository {
  readonly #roleTypes = new Map<RoleTypeId, RoleType>();
  readonly #vessels = new Map<VesselId, Vessel>();
  readonly #crew = new Map<CrewMemberId, CrewMember>();
  readonly #credentials = new Map<CredentialId, Credential>();
  readonly #ptoWindows = new Map<PtoWindowId, PtoWindow>();
  readonly #events = new Map<EventId, Event>();
  readonly #reservations = new Map<ReservationId, Reservation>();
  /** Muster-owned vessel-days (DEC-106), keyed `${vesselId}|${date}`. */
  readonly #musterOwnedVesselDays = new Map<string, MusterOwnedVesselDay>();
  readonly #shifts = new Map<ShiftId, Shift>();
  readonly #seats = new Map<SeatId, Seat>();
  readonly #asks = new Map<AskId, Ask>();
  readonly #magicTokens = new Map<MagicTokenId, MagicToken>();
  readonly #admins = new Map<string, Admin>();
  readonly #loginCodes = new Map<string, LoginCode>();
  readonly #calendarFeeds = new Map<string, CalendarFeed>();
  readonly #outbox = new Map<OutboxEntryId, OutboxEntry>();
  readonly #ringOutbox = new Map<RingOutboxEntryId, RingOutboxEntry>();
  readonly #noticeOutbox = new Map<NoticeOutboxEntryId, NoticeOutboxEntry>();
  readonly #reliability: ReliabilityEvent[] = [];
  readonly #smsConsent: SmsConsent[] = [];
  // Guest contacts (#345 Part B) — keyed by reservationId, upsert-latest.
  readonly #guestContacts = new Map<string, GuestContact>();
  // Engine pause flag (#124, DEC-054). Default false = running, mirroring the
  // KV's "absent row ⇒ running" semantics. `#enginePausedAt` mirrors the DB's
  // audit column (no read path through the port — parity, not a feature).
  #enginePaused = false;
  #enginePausedAt: string | null = null;
  // Self-claim confirm-gate flag (DEC-075). Default false = auto-lock, mirroring
  // the KV's "absent row ⇒ false" semantics. `#selfClaimAt` mirrors the audit col.
  #selfClaimRequiresConfirmation = false;
  #selfClaimAt: string | null = null;
  readonly #importRuns = new Map<
    ImportRunId,
    { run: ImportRun; items: ImportRunItem[] }
  >();
  readonly #threads = new Map<ThreadId, Thread>();
  readonly #participants = new Map<ParticipantId, Participant>();
  readonly #messages = new Map<MessageId, Message>();
  // Doorbell read / notify state (6.6a, DEC-069): threadId → (subjectKey → ISO).
  // Two single-writer stores, mirroring the two Postgres tables.
  readonly #reads = new Map<string, Map<string, string>>();
  readonly #notifies = new Map<string, Map<string, string>>();

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
  async updateCrewContact(
    id: CrewMemberId,
    fields: { name?: string; phone?: string; email?: string | null },
  ): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    // Mutate only the passed fields — mirrors the targeted UPDATE (DEC-094): a
    // whole-entity overwrite would drop concurrent reliability/status changes.
    if (fields.name !== undefined) c.name = fields.name;
    if (fields.phone !== undefined) c.phone = fields.phone;
    if (fields.email !== undefined) {
      if (fields.email === null) delete c.email;
      else c.email = fields.email;
    }
    return clone(c);
  }
  async setCrewStatus(id: CrewMemberId, status: CrewStatus): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    c.status = status;
    return clone(c);
  }
  async addCrewMemberWithCredential(m: CrewMember, cred: Credential): Promise<void> {
    // In-memory can't partially fail, but keep the both-or-neither contract.
    this.#crew.set(m.id, clone(m));
    this.#credentials.set(cred.id, clone(cred));
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
  async removePtoWindow(id: PtoWindowId): Promise<void> {
    this.#ptoWindows.delete(id);
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

  // ── Coexistence partition — Muster-owned vessel-days (DEC-106) ───────────────
  async listMusterOwnedVesselDays(): Promise<MusterOwnedVesselDay[]> {
    return [...this.#musterOwnedVesselDays.values()].map(clone);
  }
  async markVesselDayMusterOwned(
    vesselId: VesselId,
    date: string,
    markedAt: string,
  ): Promise<void> {
    this.#musterOwnedVesselDays.set(
      `${String(vesselId)}|${date}`,
      clone({ vesselId, date, markedAt }),
    );
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
  async removeShift(id: ShiftId): Promise<void> {
    this.#shifts.delete(id);
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

  // ── Admins (auth identity + per-person revoke — DEC-092) ───────────────────
  async saveAdmin(admin: Admin): Promise<void> {
    this.#admins.set(admin.id, clone(admin));
  }
  async getAdmin(id: string): Promise<Admin | null> {
    const a = this.#admins.get(id);
    return a ? clone(a) : null;
  }
  async getAdminByHandle(handle: string): Promise<Admin | null> {
    const a = [...this.#admins.values()].find((x) => x.handle === handle);
    return a ? clone(a) : null;
  }
  async listAdmins(): Promise<Admin[]> {
    return [...this.#admins.values()].map(clone);
  }

  // ── Login codes (crew self-serve sign-in — DEC-081) ────────────────────────
  async saveLoginCode(c: LoginCode): Promise<void> {
    this.#loginCodes.set(`${c.subjectKind}:${c.subjectId}`, clone(c));
  }
  async getLoginCode(
    subjectKind: AuthSubjectKind,
    subjectId: string,
  ): Promise<LoginCode | null> {
    const c = this.#loginCodes.get(`${subjectKind}:${subjectId}`);
    return c ? clone(c) : null;
  }
  async consumeLoginCodeIfUnused(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-threaded JS makes this atomic; the contract — single-use CAS — is
    // what Postgres enforces under real concurrency.
    const key = `${subjectKind}:${subjectId}`;
    const current = this.#loginCodes.get(key);
    if (!current || current.consumedAt !== undefined) return false;
    this.#loginCodes.set(key, clone({ ...current, consumedAt }));
    return true;
  }
  async claimLoginAttempt(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    maxAttempts: number,
  ): Promise<{ codeHash: string; expiresAt: string; attempts: number } | null> {
    const key = `${subjectKind}:${subjectId}`;
    const current = this.#loginCodes.get(key);
    if (
      !current ||
      current.consumedAt !== undefined ||
      current.attempts >= maxAttempts
    ) {
      return null;
    }
    const attempts = current.attempts + 1;
    this.#loginCodes.set(key, clone({ ...current, attempts }));
    return { codeHash: current.codeHash, expiresAt: current.expiresAt, attempts };
  }

  // ── Calendar feeds (crew iCal subscription — #355, DEC-098) ────────────────
  async saveCalendarFeed(feed: CalendarFeed): Promise<void> {
    this.#calendarFeeds.set(String(feed.crewMemberId), clone(feed));
  }
  async getCalendarFeedByTokenHash(tokenHash: string): Promise<CalendarFeed | null> {
    const f = [...this.#calendarFeeds.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    return f ? clone(f) : null;
  }
  async getCalendarFeedForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<CalendarFeed | null> {
    const f = this.#calendarFeeds.get(String(crewMemberId));
    return f ? clone(f) : null;
  }
  async deleteCalendarFeed(crewMemberId: CrewMemberId): Promise<void> {
    this.#calendarFeeds.delete(String(crewMemberId));
  }
  async touchCalendarFeedPoll(
    tokenHash: string,
    polledAt: string,
  ): Promise<void> {
    const entry = [...this.#calendarFeeds.entries()].find(
      ([, x]) => x.tokenHash === tokenHash,
    );
    if (entry) this.#calendarFeeds.set(entry[0], clone({ ...entry[1], lastPolledAt: polledAt }));
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

  // ── Ring outbox entries (doorbell-relay channel adapter state — DEC-073) ────
  async saveRingOutboxEntry(entry: RingOutboxEntry): Promise<void> {
    this.#ringOutbox.set(entry.id, clone(entry));
  }
  async getRingOutboxEntry(id: RingOutboxEntryId): Promise<RingOutboxEntry | null> {
    const e = this.#ringOutbox.get(id);
    return e ? clone(e) : null;
  }
  async listRingOutboxEntries(): Promise<RingOutboxEntry[]> {
    return [...this.#ringOutbox.values()].map(clone);
  }
  async removeRingOutboxEntry(id: RingOutboxEntryId): Promise<void> {
    this.#ringOutbox.delete(id);
  }

  // ── Notice outbox entries (assignment-change relay adapter state — DEC-084) ─
  async saveNoticeOutboxEntry(entry: NoticeOutboxEntry): Promise<void> {
    this.#noticeOutbox.set(entry.id, clone(entry));
  }
  async getNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<NoticeOutboxEntry | null> {
    const e = this.#noticeOutbox.get(id);
    return e ? clone(e) : null;
  }
  async listNoticeOutboxEntries(): Promise<NoticeOutboxEntry[]> {
    return [...this.#noticeOutbox.values()].map(clone);
  }
  async removeNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<void> {
    this.#noticeOutbox.delete(id);
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

  async recordSmsConsent(consent: SmsConsent): Promise<void> {
    this.#smsConsent.push(clone(consent));
  }
  async listSmsConsentsForCrew(crewMemberId: CrewMemberId): Promise<SmsConsent[]> {
    return this.#smsConsent
      .filter((c) => c.crewMemberId === crewMemberId)
      .map(clone);
  }

  async recordGuestContact(contact: GuestContact): Promise<void> {
    this.#guestContacts.set(String(contact.reservationId), clone(contact));
  }
  async listGuestContactsForShift(shiftId: ShiftId): Promise<GuestContact[]> {
    return [...this.#guestContacts.values()]
      .filter((c) => c.shiftId === shiftId)
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

  // ── Self-claim confirm-gate flag (DEC-075) ─────────────────────────────────
  async selfClaimRequiresConfirmation(): Promise<boolean> {
    return this.#selfClaimRequiresConfirmation;
  }
  async setSelfClaimRequiresConfirmation(
    value: boolean,
    at: string,
  ): Promise<void> {
    this.#selfClaimRequiresConfirmation = value;
    this.#selfClaimAt = at;
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
  async listImportRuns(limit: number): Promise<ImportRun[]> {
    return [...this.#importRuns.values()]
      .map((e) => e.run)
      // newest first; id desc breaks ranAt ties deterministically so the order
      // matches the Postgres adapter's `order by ran_at desc, id desc` (parity).
      .sort(
        (a, b) =>
          b.ranAt.localeCompare(a.ranAt) ||
          String(b.id).localeCompare(String(a.id)),
      )
      .slice(0, limit)
      .map(clone);
  }

  // ── Messaging (threads / participants / messages — #111, DEC-051) ──────────
  async saveThread(thread: Thread): Promise<void> {
    this.#threads.set(thread.id, clone(thread));
  }
  async getThread(id: ThreadId): Promise<Thread | null> {
    const t = this.#threads.get(id);
    return t ? clone(t) : null;
  }
  async saveParticipant(participant: Participant): Promise<void> {
    this.#participants.set(participant.id, clone(participant));
  }
  async listParticipantsForThread(threadId: ThreadId): Promise<Participant[]> {
    return [...this.#participants.values()]
      .filter((p) => p.threadId === threadId)
      .map(clone);
  }
  async saveMessage(message: Message): Promise<void> {
    this.#messages.set(message.id, clone(message));
  }
  async listMessagesForThread(threadId: ThreadId): Promise<Message[]> {
    return [...this.#messages.values()]
      .filter((m) => m.threadId === threadId)
      // chronological; id break matches the pg adapter's `order by created_at, id`.
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map(clone);
  }
  async listThreadsWithMessages(): Promise<Thread[]> {
    const withMsg = new Set(
      [...this.#messages.values()].map((m) => String(m.threadId)),
    );
    return [...this.#threads.values()]
      .filter((t) => withMsg.has(String(t.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))) // parity: id-sorted
      .map(clone);
  }
  async listDmThreadsForCrew(crewMemberId: CrewMemberId): Promise<Thread[]> {
    const myThreadIds = new Set(
      [...this.#participants.values()]
        .filter((p) => String(p.crewMemberId) === String(crewMemberId))
        .map((p) => String(p.threadId)),
    );
    return [...this.#threads.values()]
      .filter((t) => t.kind === "dm" && myThreadIds.has(String(t.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))) // parity: id-sorted
      .map(clone);
  }

  // ── Doorbell read / notify state (6.6a, #116, DEC-069) ─────────────────────
  // Thread-scoped, subjectKey-keyed — byte-identical to PostgresRepository (the
  // contract pins it). A fresh Map per read so callers can't mutate the store.
  async readStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    return new Map(this.#reads.get(String(threadId)) ?? []);
  }
  async notifyStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    return new Map(this.#notifies.get(String(threadId)) ?? []);
  }
  async recordRead(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    upsertThreadState(this.#reads, threadId, subject, at);
  }
  async recordNotification(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    upsertThreadState(this.#notifies, threadId, subject, at);
  }
}
