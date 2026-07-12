/**
 * Postgres repository adapter (DEC-020, DEC-DATA-1).
 *
 * The durable `Repository` implementation the app runs on. Plain SQL over
 * node-postgres — no ORM, so the DDL (db/migrations) stays the source of truth
 * and portable to any hosted Postgres. The in-memory adapter remains the fast
 * test double for the domain; this one is exercised by the shared contract suite
 * (repository-contract.ts) which both adapters must pass identically.
 *
 * Mapping notes mirror the DDL: date/time domain fields are `text` (ISO strings,
 * round-tripped verbatim — no coercion divergence from the in-memory double);
 * array/nested fields are `jsonb` (node-pg serializes JS objects/arrays for write
 * and parses them on read). Optional domain fields are omitted (not set to
 * `undefined`) on read — `exactOptionalPropertyTypes`.
 */
import pg from "pg";
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
  Payment,
  MagicToken,
  NoticeOutboxEntry,
  SmsConsent,
  GuestContact,
  OutboxEntry,
  PtoWindow,
  RingOutboxEntry,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Subject,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { subjectKey } from "../domain/subject.js";
import type {
  AskId,
  CredentialId,
  CrewMemberId,
  EventId,
  MagicTokenId,
  NoticeOutboxEntryId,
  OutboxEntryId,
  PaymentId,
  PtoWindowId,
  RingOutboxEntryId,
  ReservationId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  VesselId,
} from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { SeatState } from "../domain/states.js";
import type { ImportRunId } from "../domain/ids.js";
import type {
  ImportRun,
  ImportRunItem,
  ImportRunItemKind,
  ImportRunSource,
  ImportRunSummary,
} from "../import/import-audit.js";
import type {
  Message,
  MessageSenderKind,
  Participant,
  Thread,
  ThreadKind,
} from "../messaging/entities.js";
import type { ThreadId } from "../domain/ids.js";
import {
  PAYMENT_CONFIG_DEFAULTS,
  type PaymentConfig,
} from "../reservations/payment-config.js";
import type { Repository } from "../ports/repository.js";

/** Add `key: value` only when value is non-null — keeps optional fields absent. */
function opt<K extends string, V>(
  key: K,
  value: V | null,
): Partial<Record<K, V>> {
  return value === null || value === undefined
    ? {}
    : ({ [key]: value } as Record<K, V>);
}

// ── Row → domain mappers ────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRoleType = (r: any): RoleType => ({
  id: asId<"RoleTypeId">(r.id),
  tenantId: asId<"TenantId">(r.tenant_id),
  name: r.name,
});

const toAdmin = (r: any): Admin => ({
  id: r.id,
  handle: r.handle,
  name: r.name,
  active: r.active,
  createdAt: r.created_at,
  deactivatedAt: r.deactivated_at ?? null,
});

const toVessel = (r: any): Vessel => ({
  id: asId<"VesselId">(r.id),
  name: r.name,
  coiMaxPax: r.coi_max_pax,
  manning: (r.manning as { roleTypeId: string; count: number }[]).map((m) => ({
    roleTypeId: asId<"RoleTypeId">(m.roleTypeId),
    count: m.count,
  })),
});

const toCrew = (r: any): CrewMember => ({
  id: asId<"CrewMemberId">(r.id),
  name: r.name,
  phone: r.phone,
  ratings: (r.ratings as string[]).map((x) => asId<"RoleTypeId">(x)),
  status: r.status,
  reliabilityScore: r.reliability_score,
  ...opt("email", r.email),
  ...opt("manualBoost", r.manual_boost),
  ...opt("manualFloor", r.manual_floor),
  ...opt("protocolOverride", r.protocol_override),
});

const toCredential = (r: any): Credential => ({
  id: asId<"CredentialId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  type: r.type,
  expiry: r.expiry,
  ...opt("identifier", r.identifier),
});

const toPto = (r: any): PtoWindow => ({
  id: asId<"PtoWindowId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  start: r.start_date,
  end: r.end_date,
});

const toEvent = (r: any): Event => ({
  id: asId<"EventId">(r.id),
  vesselId: asId<"VesselId">(r.vessel_id),
  date: r.date,
  time: r.time,
  capacity: r.capacity,
  status: r.status,
  source: r.source,
  ...opt("dock", r.dock),
  ...opt("price", r.price),
});

const toReservation = (r: any): Reservation => ({
  id: asId<"ReservationId">(r.id),
  eventId: asId<"EventId">(r.event_id),
  source: r.source,
  customerName: r.customer_name,
  partySize: r.party_size,
  status: r.status,
  ...opt("email", r.email),
  ...opt("phone", r.phone),
  ...opt("updatedAt", r.updated_at),
});

const toMusterOwnedVesselDay = (r: any): MusterOwnedVesselDay => ({
  vesselId: asId<"VesselId">(r.vessel_id),
  date: r.date,
  markedAt: r.marked_at,
});

const toPayment = (r: any): Payment => ({
  id: asId<"PaymentId">(r.id),
  reservationId: asId<"ReservationId">(r.reservation_id),
  method: r.method,
  kind: r.kind,
  amountCents: r.amount_cents,
  taxCents: r.tax_cents,
  currency: r.currency,
  status: r.status,
  createdAt: r.created_at,
  ...opt("stripeCheckoutSessionId", r.stripe_checkout_session_id),
  ...opt("stripePaymentIntentId", r.stripe_payment_intent_id),
  ...opt("refundedCents", r.refunded_cents),
});

const toShift = (r: any): Shift => ({
  id: asId<"ShiftId">(r.id),
  vesselId: asId<"VesselId">(r.vessel_id),
  date: r.date,
  state: r.state,
  eventIds: (r.event_ids as string[]).map((x) => asId<"EventId">(x)),
  ...opt("splitCutTime", r.split_cut_time),
});

const toSeat = (r: any): Seat => ({
  id: asId<"SeatId">(r.id),
  shiftId: asId<"ShiftId">(r.shift_id),
  role: asId<"RoleTypeId">(r.role),
  kind: r.kind,
  state: r.state,
  ...opt("assignedCrewMemberId", r.assigned_crew_member_id),
  ...opt("acquiredVia", r.acquired_via),
  ...opt("override", r.override),
});

const toAsk = (r: any): Ask => ({
  id: asId<"AskId">(r.id),
  seatId: asId<"SeatId">(r.seat_id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  channel: r.channel,
  sentAt: r.sent_at,
  ...opt("respondedAt", r.responded_at),
  ...opt("response", r.response),
  ...opt("type", r.type),
  ...opt("decisionBy", r.decision_by),
});

const toMagicToken = (r: any): MagicToken => ({
  id: asId<"MagicTokenId">(r.id),
  tokenHash: r.token_hash,
  subjectKind: r.subject_kind,
  subjectId: r.subject_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  ...opt("consumedAt", r.consumed_at),
});

const toLoginCode = (r: any): LoginCode => ({
  subjectKind: r.subject_kind,
  subjectId: r.subject_id,
  codeHash: r.code_hash,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  attempts: r.attempts,
  ...opt("consumedAt", r.consumed_at),
});

const toCalendarFeed = (r: any): CalendarFeed => ({
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  tokenHash: r.token_hash,
  createdAt: r.created_at,
  ...opt("lastPolledAt", r.last_polled_at),
});

const toOutboxEntry = (r: any): OutboxEntry => ({
  id: asId<"OutboxEntryId">(r.id),
  askId: asId<"AskId">(r.ask_id),
  seatId: asId<"SeatId">(r.seat_id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  body: r.body,
  link: r.link,
  status: r.status,
  createdAt: r.created_at,
  ...opt("sentAt", r.sent_at),
});

const toRingOutboxEntry = (r: any): RingOutboxEntry => ({
  id: asId<"RingOutboxEntryId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  threadId: asId<"ThreadId">(r.thread_id),
  body: r.body,
  link: r.link,
  status: r.status,
  createdAt: r.created_at,
  ...opt("sentAt", r.sent_at),
});

const toNoticeOutboxEntry = (r: any): NoticeOutboxEntry => ({
  id: asId<"NoticeOutboxEntryId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  action: r.action,
  body: r.body,
  link: r.link,
  status: r.status,
  createdAt: r.created_at,
  ...opt("sentAt", r.sent_at),
});

const toReliability = (r: any): ReliabilityEvent => ({
  id: asId<"ReliabilityEventId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  type: r.type,
  timestamp: r.timestamp,
  metadata: r.metadata,
});

const toSmsConsent = (r: any): SmsConsent => ({
  id: asId<"SmsConsentId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  email: r.email,
  phone: r.phone ?? null,
  disclosureVersion: r.disclosure_version,
  disclosureText: r.disclosure_text,
  consentedAt: r.consented_at,
});

const toGuestContact = (r: any): GuestContact => ({
  reservationId: asId<"ReservationId">(r.reservation_id),
  shiftId: asId<"ShiftId">(r.shift_id),
  contactedBy: r.contacted_by,
  contactedByName: r.contacted_by_name,
  contactedAt: r.contacted_at,
});

const toImportRun = (r: any): ImportRun => ({
  id: asId<"ImportRunId">(r.id),
  source: r.source as ImportRunSource,
  ranAt: r.ran_at,
  window: { start: r.window_start, end: r.window_end },
  // Default the jsonb summary's list fields that post-date some persisted runs, so
  // `.length`/`.map()` on a historical run never throws: `splitDaysChanged` (DEC-083,
  // #206 review) and `bookedNoBoat` (#338). Normalize here — the one read seam — so
  // no per-caller guard is needed (the type can stay required).
  summary: {
    ...r.summary,
    splitDaysChanged: r.summary.splitDaysChanged ?? [],
    bookedNoBoat: r.summary.bookedNoBoat ?? [],
  } as ImportRunSummary, // jsonb → object (node-pg parses)
});

const toImportRunItem = (r: any): ImportRunItem => ({
  id: asId<"ImportRunItemId">(r.id),
  runId: asId<"ImportRunId">(r.run_id),
  kind: r.kind as ImportRunItemKind,
  refId: r.ref_id,
  label: r.label, // text NULL → null (label is `string | null`, not optional)
});

const toThread = (r: any): Thread => ({
  id: asId<"ThreadId">(r.id),
  tenantId: asId<"TenantId">(r.tenant_id),
  kind: r.kind as ThreadKind,
  scopeRef: r.scope_ref, // text NULL → null (scopeRef is `string | null`, not optional)
  createdAt: r.created_at,
});

const toParticipant = (r: any): Participant => ({
  id: asId<"ParticipantId">(r.id),
  threadId: asId<"ThreadId">(r.thread_id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
});

const toMessage = (r: any): Message => ({
  id: asId<"MessageId">(r.id),
  threadId: asId<"ThreadId">(r.thread_id),
  senderId: r.sender_id,
  senderKind: r.sender_kind as MessageSenderKind,
  body: r.body,
  createdAt: r.created_at,
  priority: r.priority, // native boolean (0010) — pg returns a JS boolean
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PostgresRepository implements Repository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /** Convenience: build a pool from a connection string (caller owns `close`). */
  static fromConnectionString(connectionString: string): PostgresRepository {
    return new PostgresRepository(new pg.Pool({ connectionString }));
  }

  /** Release the pool. The app holds one repository for its lifetime. */
  async close(): Promise<void> {
    await this.#pool.end();
  }

  // ── Role types ─────────────────────────────────────────────────────────────
  async saveRoleType(r: RoleType): Promise<void> {
    await this.#pool.query(
      `insert into role_types(id, tenant_id, name) values ($1,$2,$3)
       on conflict (id) do update set tenant_id=excluded.tenant_id, name=excluded.name`,
      [r.id, r.tenantId, r.name],
    );
  }
  async getRoleType(id: RoleTypeId): Promise<RoleType | null> {
    const { rows } = await this.#pool.query(
      "select * from role_types where id=$1",
      [id],
    );
    return rows[0] ? toRoleType(rows[0]) : null;
  }
  async listRoleTypes(tenantId: TenantId): Promise<RoleType[]> {
    const { rows } = await this.#pool.query(
      "select * from role_types where tenant_id=$1",
      [tenantId],
    );
    return rows.map(toRoleType);
  }
  async listAllRoleTypes(): Promise<RoleType[]> {
    const { rows } = await this.#pool.query("select * from role_types");
    return rows.map(toRoleType);
  }

  // ── Vessels ────────────────────────────────────────────────────────────────
  async saveVessel(v: Vessel): Promise<void> {
    await this.#pool.query(
      `insert into vessels(id, name, coi_max_pax, manning) values ($1,$2,$3,$4)
       on conflict (id) do update set name=excluded.name, coi_max_pax=excluded.coi_max_pax, manning=excluded.manning`,
      [v.id, v.name, v.coiMaxPax, JSON.stringify(v.manning)],
    );
  }
  async getVessel(id: VesselId): Promise<Vessel | null> {
    const { rows } = await this.#pool.query(
      "select * from vessels where id=$1",
      [id],
    );
    return rows[0] ? toVessel(rows[0]) : null;
  }
  async listVessels(): Promise<Vessel[]> {
    const { rows } = await this.#pool.query("select * from vessels");
    return rows.map(toVessel);
  }

  // ── Crew ───────────────────────────────────────────────────────────────────
  async saveCrewMember(c: CrewMember): Promise<void> {
    await this.#pool.query(
      `insert into crew_members
         (id, name, phone, email, ratings, status, manual_boost, manual_floor, protocol_override, reliability_score)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set
         name=excluded.name, phone=excluded.phone, email=excluded.email, ratings=excluded.ratings,
         status=excluded.status, manual_boost=excluded.manual_boost, manual_floor=excluded.manual_floor,
         protocol_override=excluded.protocol_override, reliability_score=excluded.reliability_score`,
      [
        c.id,
        c.name,
        c.phone,
        c.email ?? null,
        JSON.stringify(c.ratings),
        c.status,
        c.manualBoost ?? null,
        c.manualFloor ?? null,
        c.protocolOverride ?? null,
        c.reliabilityScore,
      ],
    );
  }
  async getCrewMember(id: CrewMemberId): Promise<CrewMember | null> {
    const { rows } = await this.#pool.query(
      "select * from crew_members where id=$1",
      [id],
    );
    return rows[0] ? toCrew(rows[0]) : null;
  }
  async updateCrewContact(
    id: CrewMemberId,
    fields: { name?: string; phone?: string; email?: string | null },
  ): Promise<CrewMember | null> {
    // Only SET the columns actually passed — a single UPDATE that leaves
    // reliability_score/status/ratings/etc. untouched (DEC-094 lost-update fix).
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) sets.push(`name=$${vals.push(fields.name)}`);
    if (fields.phone !== undefined) sets.push(`phone=$${vals.push(fields.phone)}`);
    if (fields.email !== undefined) sets.push(`email=$${vals.push(fields.email)}`); // null clears
    if (sets.length === 0) return this.getCrewMember(id);
    const { rows } = await this.#pool.query(
      `update crew_members set ${sets.join(", ")} where id=$${vals.push(id)} returning *`,
      vals,
    );
    return rows[0] ? toCrew(rows[0]) : null;
  }
  async setCrewStatus(id: CrewMemberId, status: CrewStatus): Promise<CrewMember | null> {
    const { rows } = await this.#pool.query(
      "update crew_members set status=$1 where id=$2 returning *",
      [status, id],
    );
    return rows[0] ? toCrew(rows[0]) : null;
  }
  async addCrewMemberWithCredential(m: CrewMember, cred: Credential): Promise<void> {
    // One unit — a new hire is useless without their gating credential, so a
    // mid-write failure must leave NEITHER (mirrors saveImportRun).
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into crew_members
           (id, name, phone, email, ratings, status, manual_boost, manual_floor, protocol_override, reliability_score)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          m.id,
          m.name,
          m.phone,
          m.email ?? null,
          JSON.stringify(m.ratings),
          m.status,
          m.manualBoost ?? null,
          m.manualFloor ?? null,
          m.protocolOverride ?? null,
          m.reliabilityScore,
        ],
      );
      await client.query(
        `insert into credentials(id, crew_member_id, type, identifier, expiry) values ($1,$2,$3,$4,$5)`,
        [cred.id, cred.crewMemberId, cred.type, cred.identifier ?? null, cred.expiry],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async listCrewMembers(): Promise<CrewMember[]> {
    const { rows } = await this.#pool.query("select * from crew_members");
    return rows.map(toCrew);
  }

  // ── Credentials ────────────────────────────────────────────────────────────
  async saveCredential(c: Credential): Promise<void> {
    await this.#pool.query(
      `insert into credentials(id, crew_member_id, type, identifier, expiry) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set crew_member_id=excluded.crew_member_id, type=excluded.type,
         identifier=excluded.identifier, expiry=excluded.expiry`,
      [c.id, c.crewMemberId, c.type, c.identifier ?? null, c.expiry],
    );
  }
  async getCredential(id: CredentialId): Promise<Credential | null> {
    const { rows } = await this.#pool.query(
      "select * from credentials where id=$1",
      [id],
    );
    return rows[0] ? toCredential(rows[0]) : null;
  }
  async listCredentialsForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<Credential[]> {
    const { rows } = await this.#pool.query(
      "select * from credentials where crew_member_id=$1",
      [crewMemberId],
    );
    return rows.map(toCredential);
  }
  async listAllCredentials(): Promise<Credential[]> {
    const { rows } = await this.#pool.query("select * from credentials");
    return rows.map(toCredential);
  }
  async removeCredential(id: CredentialId): Promise<void> {
    await this.#pool.query("delete from credentials where id=$1", [id]);
  }

  // ── PTO windows ────────────────────────────────────────────────────────────
  async savePtoWindow(w: PtoWindow): Promise<void> {
    await this.#pool.query(
      `insert into pto_windows(id, crew_member_id, start_date, end_date) values ($1,$2,$3,$4)
       on conflict (id) do update set crew_member_id=excluded.crew_member_id,
         start_date=excluded.start_date, end_date=excluded.end_date`,
      [w.id, w.crewMemberId, w.start, w.end],
    );
  }
  async listPtoWindowsForCrew(crewMemberId: CrewMemberId): Promise<PtoWindow[]> {
    const { rows } = await this.#pool.query(
      "select * from pto_windows where crew_member_id=$1",
      [crewMemberId],
    );
    return rows.map(toPto);
  }
  async listAllPtoWindows(): Promise<PtoWindow[]> {
    const { rows } = await this.#pool.query("select * from pto_windows");
    return rows.map(toPto);
  }
  async removePtoWindow(id: PtoWindowId): Promise<void> {
    await this.#pool.query("delete from pto_windows where id=$1", [id]);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  async saveEvent(e: Event): Promise<void> {
    await this.#pool.query(
      `insert into events(id, vessel_id, date, time, capacity, status, dock, source, price) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set vessel_id=excluded.vessel_id, date=excluded.date,
         time=excluded.time, capacity=excluded.capacity, status=excluded.status, dock=excluded.dock,
         source=excluded.source, price=excluded.price`,
      [e.id, e.vesselId, e.date, e.time, e.capacity, e.status, e.dock ?? null, e.source, e.price ?? null],
    );
  }
  async getEvent(id: EventId): Promise<Event | null> {
    const { rows } = await this.#pool.query("select * from events where id=$1", [
      id,
    ]);
    return rows[0] ? toEvent(rows[0]) : null;
  }
  async listEvents(): Promise<Event[]> {
    const { rows } = await this.#pool.query("select * from events");
    return rows.map(toEvent);
  }

  // ── Coexistence partition — Muster-owned vessel-days (DEC-106) ───────────────
  async listMusterOwnedVesselDays(): Promise<MusterOwnedVesselDay[]> {
    const { rows } = await this.#pool.query(
      "select * from muster_owned_vessel_days",
    );
    return rows.map(toMusterOwnedVesselDay);
  }
  async markVesselDayMusterOwned(
    vesselId: VesselId,
    date: string,
    markedAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `insert into muster_owned_vessel_days(vessel_id, date, marked_at) values ($1,$2,$3)
       on conflict (vessel_id, date) do update set marked_at=excluded.marked_at`,
      [vesselId, date, markedAt],
    );
  }

  // ── Payments (DEC-107) ──────────────────────────────────────────────────────
  async getPaymentConfig(): Promise<PaymentConfig> {
    const { rows } = await this.#pool.query(
      "select key, value from app_settings where key like 'payment.%'",
    );
    const kv = new Map<string, string>(rows.map((r) => [r.key, r.value]));
    const num = (k: string, d: number): number => {
      const n = kv.has(k) ? Number(kv.get(k)) : NaN;
      return Number.isFinite(n) ? n : d; // absent / unparseable ⇒ default (DEC-054)
    };
    const mode = kv.get("payment.deposit_mode");
    return {
      depositMode:
        mode === "full" || mode === "deposit"
          ? mode
          : PAYMENT_CONFIG_DEFAULTS.depositMode,
      depositPercent: num("payment.deposit_percent", PAYMENT_CONFIG_DEFAULTS.depositPercent),
      taxRateBps: num("payment.tax_rate_bps", PAYMENT_CONFIG_DEFAULTS.taxRateBps),
      balanceDueDaysBeforeEvent: num(
        "payment.balance_due_days",
        PAYMENT_CONFIG_DEFAULTS.balanceDueDaysBeforeEvent,
      ),
    };
  }
  async setPaymentConfig(patch: Partial<PaymentConfig>, at: string): Promise<void> {
    const entries: [string, string][] = [];
    if (patch.depositMode !== undefined) entries.push(["payment.deposit_mode", patch.depositMode]);
    if (patch.depositPercent !== undefined) entries.push(["payment.deposit_percent", String(patch.depositPercent)]);
    if (patch.taxRateBps !== undefined) entries.push(["payment.tax_rate_bps", String(patch.taxRateBps)]);
    if (patch.balanceDueDaysBeforeEvent !== undefined) entries.push(["payment.balance_due_days", String(patch.balanceDueDaysBeforeEvent)]);
    for (const [key, value] of entries) {
      await this.#pool.query(
        `insert into app_settings(key, value, updated_at) values ($1,$2,$3)
         on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at`,
        [key, value, at],
      );
    }
  }
  async savePayment(p: Payment): Promise<void> {
    await this.#pool.query(
      `insert into payments(id, reservation_id, method, kind, amount_cents, tax_cents, currency,
         stripe_checkout_session_id, stripe_payment_intent_id, status, refunded_cents, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set reservation_id=excluded.reservation_id, method=excluded.method,
         kind=excluded.kind, amount_cents=excluded.amount_cents, tax_cents=excluded.tax_cents,
         currency=excluded.currency, stripe_checkout_session_id=excluded.stripe_checkout_session_id,
         stripe_payment_intent_id=excluded.stripe_payment_intent_id, status=excluded.status,
         refunded_cents=excluded.refunded_cents, created_at=excluded.created_at`,
      [
        p.id,
        p.reservationId,
        p.method,
        p.kind,
        p.amountCents,
        p.taxCents,
        p.currency,
        p.stripeCheckoutSessionId ?? null,
        p.stripePaymentIntentId ?? null,
        p.status,
        p.refundedCents ?? null,
        p.createdAt,
      ],
    );
  }
  async getPayment(id: PaymentId): Promise<Payment | null> {
    const { rows } = await this.#pool.query("select * from payments where id=$1", [id]);
    return rows[0] ? toPayment(rows[0]) : null;
  }
  async listPaymentsForReservation(reservationId: ReservationId): Promise<Payment[]> {
    const { rows } = await this.#pool.query(
      "select * from payments where reservation_id=$1 order by created_at",
      [reservationId],
    );
    return rows.map(toPayment);
  }

  // ── Reservations ───────────────────────────────────────────────────────────
  async saveReservation(r: Reservation): Promise<void> {
    await this.#pool.query(
      `insert into reservations(id, event_id, customer_name, party_size, email, phone, status, updated_at, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set event_id=excluded.event_id, customer_name=excluded.customer_name,
         party_size=excluded.party_size, email=excluded.email, phone=excluded.phone, status=excluded.status,
         updated_at=excluded.updated_at, source=excluded.source`,
      [
        r.id,
        r.eventId,
        r.customerName,
        r.partySize,
        r.email ?? null,
        r.phone ?? null,
        r.status,
        r.updatedAt ?? null,
        r.source,
      ],
    );
  }
  async getReservation(id: ReservationId): Promise<Reservation | null> {
    const { rows } = await this.#pool.query(
      "select * from reservations where id=$1",
      [id],
    );
    return rows[0] ? toReservation(rows[0]) : null;
  }
  async listReservationsForEvent(eventId: EventId): Promise<Reservation[]> {
    const { rows } = await this.#pool.query(
      "select * from reservations where event_id=$1",
      [eventId],
    );
    return rows.map(toReservation);
  }
  async listAllReservations(): Promise<Reservation[]> {
    const { rows } = await this.#pool.query("select * from reservations");
    return rows.map(toReservation);
  }
  async saveReservationIfUnclaimed(r: Reservation): Promise<boolean> {
    // Atomic whole-boat claim (DEC-109). The mutex is a `select … for update` on the
    // pre-existing EVENT row — NOT a unique constraint (n:1 on reservations→event
    // stays intact per DEC-DATA-1). A plain `insert … where not exists` would oversell
    // under READ COMMITTED (two concurrent inserts each snapshot before the other's
    // uncommitted row); the row lock serializes claims on this boat, so the loser's
    // guarded insert re-evaluates against the winner's committed row and writes zero.
    // `id <> $1` + `on conflict (id) do nothing` make a retry of the SAME reservation
    // idempotent (its own row never blocks it, never duplicates).
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const ev = await client.query("select 1 from events where id=$1 for update", [
        r.eventId,
      ]);
      if (ev.rowCount === 0) {
        await client.query("rollback");
        return false; // no such event — unbookable
      }
      await client.query(
        `insert into reservations
           (id, event_id, customer_name, party_size, email, phone, status, updated_at, source)
         select $1,$2,$3,$4,$5,$6,$7,$8,$9
         where not exists (
           select 1 from reservations
           where event_id=$2 and source='muster' and status='booked' and id <> $1
         )
         on conflict (id) do nothing`,
        [
          r.id,
          r.eventId,
          r.customerName,
          r.partySize,
          r.email ?? null,
          r.phone ?? null,
          r.status,
          r.updatedAt ?? null,
          r.source,
        ],
      );
      const won = await client.query(
        "select 1 from reservations where id=$1",
        [r.id],
      );
      await client.query("commit");
      return won.rowCount === 1;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Shifts ─────────────────────────────────────────────────────────────────
  async saveShift(s: Shift): Promise<void> {
    await this.#pool.query(
      `insert into shifts(id, vessel_id, date, state, event_ids, split_cut_time) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set vessel_id=excluded.vessel_id, date=excluded.date,
         state=excluded.state, event_ids=excluded.event_ids,
         split_cut_time=excluded.split_cut_time`,
      [s.id, s.vesselId, s.date, s.state, JSON.stringify(s.eventIds), s.splitCutTime ?? null],
    );
  }
  async getShift(id: ShiftId): Promise<Shift | null> {
    const { rows } = await this.#pool.query("select * from shifts where id=$1", [
      id,
    ]);
    return rows[0] ? toShift(rows[0]) : null;
  }
  async listShifts(): Promise<Shift[]> {
    const { rows } = await this.#pool.query("select * from shifts");
    return rows.map(toShift);
  }
  async removeShift(id: ShiftId): Promise<void> {
    await this.#pool.query("delete from shifts where id=$1", [id]);
  }

  // ── Seats ──────────────────────────────────────────────────────────────────
  async saveSeat(s: Seat): Promise<void> {
    await this.#pool.query(
      `insert into seats(id, shift_id, role, kind, state, assigned_crew_member_id, acquired_via, override) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set shift_id=excluded.shift_id, role=excluded.role, kind=excluded.kind,
         state=excluded.state, assigned_crew_member_id=excluded.assigned_crew_member_id, acquired_via=excluded.acquired_via,
         override=excluded.override`,
      [s.id, s.shiftId, s.role, s.kind, s.state, s.assignedCrewMemberId ?? null, s.acquiredVia ?? null, s.override ?? null],
    );
  }
  async getSeat(id: SeatId): Promise<Seat | null> {
    const { rows } = await this.#pool.query("select * from seats where id=$1", [
      id,
    ]);
    return rows[0] ? toSeat(rows[0]) : null;
  }
  async listSeatsForShift(shiftId: ShiftId): Promise<Seat[]> {
    const { rows } = await this.#pool.query(
      "select * from seats where shift_id=$1",
      [shiftId],
    );
    return rows.map(toSeat);
  }
  async listAllSeats(): Promise<Seat[]> {
    const { rows } = await this.#pool.query("select * from seats");
    return rows.map(toSeat);
  }
  async saveSeatIfState(seat: Seat, expectedState: SeatState): Promise<boolean> {
    // Atomic compare-and-swap (REQ-CLAIM-1, DEC-020): the `and state=$expected`
    // predicate is evaluated under the row lock the UPDATE takes, so of two
    // concurrent claims only the first to commit matches — the second sees the
    // already-changed state and updates zero rows.
    const { rowCount } = await this.#pool.query(
      `update seats set role=$2, kind=$3, state=$4, assigned_crew_member_id=$5, acquired_via=$7
       where id=$1 and state=$6`,
      [
        seat.id,
        seat.role,
        seat.kind,
        seat.state,
        seat.assignedCrewMemberId ?? null,
        expectedState,
        seat.acquiredVia ?? null,
      ],
    );
    return rowCount === 1;
  }
  async removeSeat(id: SeatId): Promise<void> {
    await this.#pool.query("delete from seats where id=$1", [id]);
  }

  // ── Asks ───────────────────────────────────────────────────────────────────
  async saveAsk(a: Ask): Promise<void> {
    await this.#pool.query(
      `insert into asks(id, seat_id, crew_member_id, channel, sent_at, responded_at, response, type, decision_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set seat_id=excluded.seat_id, crew_member_id=excluded.crew_member_id,
         channel=excluded.channel, sent_at=excluded.sent_at, responded_at=excluded.responded_at,
         response=excluded.response, type=excluded.type, decision_by=excluded.decision_by`,
      [
        a.id,
        a.seatId,
        a.crewMemberId,
        a.channel,
        a.sentAt,
        a.respondedAt ?? null,
        a.response ?? null,
        a.type ?? null,
        a.decisionBy ?? null,
      ],
    );
  }
  async getAsk(id: AskId): Promise<Ask | null> {
    const { rows } = await this.#pool.query("select * from asks where id=$1", [
      id,
    ]);
    return rows[0] ? toAsk(rows[0]) : null;
  }
  async listAsksForSeat(seatId: SeatId): Promise<Ask[]> {
    const { rows } = await this.#pool.query(
      "select * from asks where seat_id=$1",
      [seatId],
    );
    return rows.map(toAsk);
  }
  async listAllAsks(): Promise<Ask[]> {
    const { rows } = await this.#pool.query("select * from asks");
    return rows.map(toAsk);
  }
  async removeAsk(id: AskId): Promise<void> {
    await this.#pool.query("delete from asks where id=$1", [id]);
  }

  // ── Magic-link tokens (self-rolled auth — DEC-010, DEC-020) ────────────────
  async saveMagicToken(t: MagicToken): Promise<void> {
    await this.#pool.query(
      `insert into magic_tokens(id, token_hash, subject_kind, subject_id, created_at, expires_at, consumed_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set token_hash=excluded.token_hash, subject_kind=excluded.subject_kind,
         subject_id=excluded.subject_id, created_at=excluded.created_at, expires_at=excluded.expires_at,
         consumed_at=excluded.consumed_at`,
      [
        t.id,
        t.tokenHash,
        t.subjectKind,
        t.subjectId,
        t.createdAt,
        t.expiresAt,
        t.consumedAt ?? null,
      ],
    );
  }
  async getMagicTokenByHash(tokenHash: string): Promise<MagicToken | null> {
    const { rows } = await this.#pool.query(
      "select * from magic_tokens where token_hash=$1",
      [tokenHash],
    );
    return rows[0] ? toMagicToken(rows[0]) : null;
  }
  async consumeMagicTokenIfUnused(
    tokenHash: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-use CAS: the `and consumed_at is null` predicate runs under the row
    // lock the UPDATE takes, so of two concurrent taps only the first commits a
    // non-zero update — the second sees a consumed row and updates nothing.
    const { rowCount } = await this.#pool.query(
      `update magic_tokens set consumed_at=$2 where token_hash=$1 and consumed_at is null`,
      [tokenHash, consumedAt],
    );
    return rowCount === 1;
  }
  async listAllMagicTokens(): Promise<MagicToken[]> {
    const { rows } = await this.#pool.query("select * from magic_tokens");
    return rows.map(toMagicToken);
  }
  async removeMagicToken(id: MagicTokenId): Promise<void> {
    await this.#pool.query("delete from magic_tokens where id=$1", [id]);
  }

  // ── Admins (auth identity + per-person revoke — DEC-092) ───────────────────
  async saveAdmin(a: Admin): Promise<void> {
    await this.#pool.query(
      `insert into admins(id, handle, name, active, created_at, deactivated_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set
         handle=excluded.handle, name=excluded.name, active=excluded.active,
         created_at=excluded.created_at, deactivated_at=excluded.deactivated_at`,
      [a.id, a.handle, a.name, a.active, a.createdAt, a.deactivatedAt],
    );
  }
  async getAdmin(id: string): Promise<Admin | null> {
    const { rows } = await this.#pool.query(
      "select * from admins where id=$1",
      [id],
    );
    return rows[0] ? toAdmin(rows[0]) : null;
  }
  async getAdminByHandle(handle: string): Promise<Admin | null> {
    const { rows } = await this.#pool.query(
      "select * from admins where handle=$1",
      [handle],
    );
    return rows[0] ? toAdmin(rows[0]) : null;
  }
  async listAdmins(): Promise<Admin[]> {
    const { rows } = await this.#pool.query("select * from admins order by handle");
    return rows.map(toAdmin);
  }

  // ── Login codes (crew self-serve sign-in — DEC-081) ────────────────────────
  async saveLoginCode(c: LoginCode): Promise<void> {
    await this.#pool.query(
      `insert into login_codes(subject_kind, subject_id, code_hash, created_at, expires_at, attempts, consumed_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (subject_kind, subject_id) do update set
         code_hash=excluded.code_hash, created_at=excluded.created_at,
         expires_at=excluded.expires_at, attempts=excluded.attempts,
         consumed_at=excluded.consumed_at`,
      [
        c.subjectKind,
        c.subjectId,
        c.codeHash,
        c.createdAt,
        c.expiresAt,
        c.attempts,
        c.consumedAt ?? null,
      ],
    );
  }
  async getLoginCode(
    subjectKind: AuthSubjectKind,
    subjectId: string,
  ): Promise<LoginCode | null> {
    const { rows } = await this.#pool.query(
      "select * from login_codes where subject_kind=$1 and subject_id=$2",
      [subjectKind, subjectId],
    );
    return rows[0] ? toLoginCode(rows[0]) : null;
  }
  async consumeLoginCodeIfUnused(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-use CAS, the magic-token precedent: the `and consumed_at is null`
    // predicate under the row lock means only the first of two concurrent
    // submits commits a non-zero update.
    const { rowCount } = await this.#pool.query(
      `update login_codes set consumed_at=$3
       where subject_kind=$1 and subject_id=$2 and consumed_at is null`,
      [subjectKind, subjectId, consumedAt],
    );
    return rowCount === 1;
  }
  async claimLoginAttempt(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    maxAttempts: number,
  ): Promise<{ codeHash: string; expiresAt: string; attempts: number } | null> {
    // Guarded increment: the `attempts < $3` predicate under the row lock means
    // K concurrent claims serialize and only the first `maxAttempts` succeed — the
    // rest return no row. Race-safe brute-force ceiling (#297).
    const { rows } = await this.#pool.query(
      `update login_codes set attempts = attempts + 1
        where subject_kind=$1 and subject_id=$2 and consumed_at is null
          and attempts < $3
        returning code_hash, expires_at, attempts`,
      [subjectKind, subjectId, maxAttempts],
    );
    return rows[0]
      ? {
          codeHash: rows[0].code_hash,
          expiresAt: rows[0].expires_at,
          attempts: rows[0].attempts,
        }
      : null;
  }

  // ── Calendar feeds (crew iCal subscription — #355, DEC-098) ────────────────
  async saveCalendarFeed(feed: CalendarFeed): Promise<void> {
    await this.#pool.query(
      `insert into calendar_feeds(crew_member_id, token_hash, created_at, last_polled_at)
       values ($1,$2,$3,$4)
       on conflict (crew_member_id) do update set
         token_hash=excluded.token_hash, created_at=excluded.created_at,
         last_polled_at=excluded.last_polled_at`,
      [feed.crewMemberId, feed.tokenHash, feed.createdAt, feed.lastPolledAt ?? null],
    );
  }
  async getCalendarFeedByTokenHash(tokenHash: string): Promise<CalendarFeed | null> {
    const { rows } = await this.#pool.query(
      "select * from calendar_feeds where token_hash=$1",
      [tokenHash],
    );
    return rows[0] ? toCalendarFeed(rows[0]) : null;
  }
  async getCalendarFeedForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<CalendarFeed | null> {
    const { rows } = await this.#pool.query(
      "select * from calendar_feeds where crew_member_id=$1",
      [crewMemberId],
    );
    return rows[0] ? toCalendarFeed(rows[0]) : null;
  }
  async deleteCalendarFeed(crewMemberId: CrewMemberId): Promise<void> {
    await this.#pool.query("delete from calendar_feeds where crew_member_id=$1", [
      crewMemberId,
    ]);
  }
  async touchCalendarFeedPoll(tokenHash: string, polledAt: string): Promise<void> {
    await this.#pool.query(
      "update calendar_feeds set last_polled_at=$2 where token_hash=$1",
      [tokenHash, polledAt],
    );
  }

  // ── Outbox entries (web-link channel adapter state — DEC-030) ──────────────
  async saveOutboxEntry(e: OutboxEntry): Promise<void> {
    await this.#pool.query(
      `insert into outbox_entries(id, ask_id, seat_id, crew_member_id, body, link, status, created_at, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set ask_id=excluded.ask_id, seat_id=excluded.seat_id,
         crew_member_id=excluded.crew_member_id, body=excluded.body, link=excluded.link,
         status=excluded.status, created_at=excluded.created_at, sent_at=excluded.sent_at`,
      [
        e.id,
        e.askId,
        e.seatId,
        e.crewMemberId,
        e.body,
        e.link,
        e.status,
        e.createdAt,
        e.sentAt ?? null,
      ],
    );
  }
  async getOutboxEntry(id: OutboxEntryId): Promise<OutboxEntry | null> {
    const { rows } = await this.#pool.query(
      "select * from outbox_entries where id=$1",
      [id],
    );
    return rows[0] ? toOutboxEntry(rows[0]) : null;
  }
  async listOutboxEntries(): Promise<OutboxEntry[]> {
    const { rows } = await this.#pool.query("select * from outbox_entries");
    return rows.map(toOutboxEntry);
  }
  async removeOutboxEntry(id: OutboxEntryId): Promise<void> {
    await this.#pool.query("delete from outbox_entries where id=$1", [id]);
  }

  // ── Ring outbox entries (doorbell-relay channel adapter state — DEC-073) ────
  async saveRingOutboxEntry(e: RingOutboxEntry): Promise<void> {
    await this.#pool.query(
      `insert into ring_outbox(id, crew_member_id, thread_id, body, link, status, created_at, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set crew_member_id=excluded.crew_member_id,
         thread_id=excluded.thread_id, body=excluded.body, link=excluded.link,
         status=excluded.status, created_at=excluded.created_at, sent_at=excluded.sent_at`,
      [e.id, e.crewMemberId, e.threadId, e.body, e.link, e.status, e.createdAt, e.sentAt ?? null],
    );
  }
  async getRingOutboxEntry(id: RingOutboxEntryId): Promise<RingOutboxEntry | null> {
    const { rows } = await this.#pool.query("select * from ring_outbox where id=$1", [id]);
    return rows[0] ? toRingOutboxEntry(rows[0]) : null;
  }
  async listRingOutboxEntries(): Promise<RingOutboxEntry[]> {
    const { rows } = await this.#pool.query("select * from ring_outbox");
    return rows.map(toRingOutboxEntry);
  }
  async removeRingOutboxEntry(id: RingOutboxEntryId): Promise<void> {
    await this.#pool.query("delete from ring_outbox where id=$1", [id]);
  }

  // ── Notice outbox entries (assignment-change relay adapter state — DEC-084) ─
  async saveNoticeOutboxEntry(e: NoticeOutboxEntry): Promise<void> {
    await this.#pool.query(
      `insert into notice_outbox(id, crew_member_id, action, body, link, status, created_at, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set crew_member_id=excluded.crew_member_id,
         action=excluded.action, body=excluded.body, link=excluded.link,
         status=excluded.status, created_at=excluded.created_at, sent_at=excluded.sent_at`,
      [e.id, e.crewMemberId, e.action, e.body, e.link, e.status, e.createdAt, e.sentAt ?? null],
    );
  }
  async getNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<NoticeOutboxEntry | null> {
    const { rows } = await this.#pool.query("select * from notice_outbox where id=$1", [id]);
    return rows[0] ? toNoticeOutboxEntry(rows[0]) : null;
  }
  async listNoticeOutboxEntries(): Promise<NoticeOutboxEntry[]> {
    const { rows } = await this.#pool.query("select * from notice_outbox");
    return rows.map(toNoticeOutboxEntry);
  }
  async removeNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<void> {
    await this.#pool.query("delete from notice_outbox where id=$1", [id]);
  }

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  async logReliabilityEvent(e: ReliabilityEvent): Promise<void> {
    await this.#pool.query(
      `insert into reliability_events(id, crew_member_id, type, timestamp, metadata)
       values ($1,$2,$3,$4,$5)`,
      [e.id, e.crewMemberId, e.type, e.timestamp, JSON.stringify(e.metadata)],
    );
  }
  async reliabilityEventsFor(
    crewMemberId: CrewMemberId,
  ): Promise<ReliabilityEvent[]> {
    const { rows } = await this.#pool.query(
      "select * from reliability_events where crew_member_id=$1 order by seq",
      [crewMemberId],
    );
    return rows.map(toReliability);
  }

  async recordSmsConsent(c: SmsConsent): Promise<void> {
    await this.#pool.query(
      `insert into sms_consent(id, crew_member_id, email, phone, disclosure_version, disclosure_text, consented_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        c.id,
        c.crewMemberId,
        c.email,
        c.phone,
        c.disclosureVersion,
        c.disclosureText,
        c.consentedAt,
      ],
    );
  }
  async listSmsConsentsForCrew(crewMemberId: CrewMemberId): Promise<SmsConsent[]> {
    const { rows } = await this.#pool.query(
      "select * from sms_consent where crew_member_id=$1 order by seq",
      [crewMemberId],
    );
    return rows.map(toSmsConsent);
  }

  // ── Guest contacts (#345 Part B — upsert-latest by reservation) ────────────
  async recordGuestContact(c: GuestContact): Promise<void> {
    await this.#pool.query(
      `insert into guest_contacts(reservation_id, shift_id, contacted_by, contacted_by_name, contacted_at)
       values ($1,$2,$3,$4,$5)
       on conflict (reservation_id) do update set
         shift_id=excluded.shift_id, contacted_by=excluded.contacted_by,
         contacted_by_name=excluded.contacted_by_name, contacted_at=excluded.contacted_at`,
      [c.reservationId, c.shiftId, c.contactedBy, c.contactedByName, c.contactedAt],
    );
  }
  async listGuestContactsForShift(shiftId: ShiftId): Promise<GuestContact[]> {
    const { rows } = await this.#pool.query(
      "select * from guest_contacts where shift_id=$1",
      [shiftId],
    );
    return rows.map(toGuestContact);
  }

  // ── Engine pause flag (operator control — #124, DEC-054) ───────────────────
  async isEnginePaused(): Promise<boolean> {
    const { rows } = await this.#pool.query(
      "select value from app_settings where key='engine_paused'",
    );
    // Absent ⇒ running (DEC-054): no row means no one has touched the switch,
    // which for an autonomous engine must mean ON. Only an explicit "true" pauses.
    return rows[0]?.value === "true";
  }
  async setEnginePaused(paused: boolean, at: string): Promise<void> {
    await this.#pool.query(
      `insert into app_settings(key, value, updated_at) values ('engine_paused', $1, $2)
       on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at`,
      [paused ? "true" : "false", at],
    );
  }

  // ── Self-claim confirm-gate flag (DEC-075) ─────────────────────────────────
  async selfClaimRequiresConfirmation(): Promise<boolean> {
    const { rows } = await this.#pool.query(
      "select value from app_settings where key='self_claim_requires_confirmation'",
    );
    // Absent ⇒ auto-lock (DEC-075): no row means no one has set the gate, the MVP
    // default. Only an explicit "true" routes a self-claim toward the reserved tier.
    return rows[0]?.value === "true";
  }
  async setSelfClaimRequiresConfirmation(
    value: boolean,
    at: string,
  ): Promise<void> {
    await this.#pool.query(
      `insert into app_settings(key, value, updated_at) values ('self_claim_requires_confirmation', $1, $2)
       on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at`,
      [value ? "true" : "false", at],
    );
  }

  // ── Import-run audit (#128, DEC-056) ───────────────────────────────────────
  async saveImportRun(run: ImportRun, items: ImportRunItem[]): Promise<void> {
    // One run + its identity rows are a unit — write them in a transaction so a
    // mid-write failure never leaves a run with half its items (or vice versa).
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into import_runs(id, source, ran_at, window_start, window_end, summary)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set source=excluded.source, ran_at=excluded.ran_at,
           window_start=excluded.window_start, window_end=excluded.window_end, summary=excluded.summary`,
        [
          run.id,
          run.source,
          run.ranAt,
          run.window.start,
          run.window.end,
          JSON.stringify(run.summary),
        ],
      );
      for (const it of items) {
        await client.query(
          `insert into import_run_items(id, run_id, kind, ref_id, label) values ($1,$2,$3,$4,$5)
           on conflict (id) do update set run_id=excluded.run_id, kind=excluded.kind,
             ref_id=excluded.ref_id, label=excluded.label`,
          [it.id, it.runId, it.kind, it.refId, it.label ?? null],
        );
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async getImportRun(
    id: ImportRunId,
  ): Promise<{ run: ImportRun; items: ImportRunItem[] } | null> {
    const runQ = await this.#pool.query(
      "select * from import_runs where id=$1",
      [id],
    );
    if (!runQ.rows[0]) return null;
    // Zero-padded item ids (`<run>-item-NNNN`) make lexical `order by id` match the
    // in-memory adapter's insertion order — the parity the contract suite checks.
    const itemsQ = await this.#pool.query(
      "select * from import_run_items where run_id=$1 order by id",
      [id],
    );
    return {
      run: toImportRun(runQ.rows[0]),
      items: itemsQ.rows.map(toImportRunItem),
    };
  }
  async listImportRuns(limit: number): Promise<ImportRun[]> {
    // id desc breaks ran_at ties deterministically — matches the in-memory
    // adapter's secondary sort so the contract's parity check is real.
    const { rows } = await this.#pool.query(
      "select * from import_runs order by ran_at desc, id desc limit $1",
      [limit],
    );
    return rows.map(toImportRun);
  }

  // ── Messaging (threads / participants / messages — #111, DEC-051) ──────────
  async saveThread(t: Thread): Promise<void> {
    await this.#pool.query(
      `insert into threads(id, tenant_id, kind, scope_ref, created_at) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set tenant_id=excluded.tenant_id, kind=excluded.kind,
         scope_ref=excluded.scope_ref, created_at=excluded.created_at`,
      [t.id, t.tenantId, t.kind, t.scopeRef, t.createdAt],
    );
  }
  async getThread(id: ThreadId): Promise<Thread | null> {
    const { rows } = await this.#pool.query(
      "select * from threads where id=$1",
      [id],
    );
    return rows[0] ? toThread(rows[0]) : null;
  }
  async saveParticipant(p: Participant): Promise<void> {
    await this.#pool.query(
      `insert into thread_participants(id, thread_id, crew_member_id) values ($1,$2,$3)
       on conflict (id) do update set thread_id=excluded.thread_id, crew_member_id=excluded.crew_member_id`,
      [p.id, p.threadId, p.crewMemberId],
    );
  }
  async listParticipantsForThread(threadId: ThreadId): Promise<Participant[]> {
    const { rows } = await this.#pool.query(
      "select * from thread_participants where thread_id=$1",
      [threadId],
    );
    return rows.map(toParticipant);
  }
  async saveMessage(m: Message): Promise<void> {
    await this.#pool.query(
      `insert into messages(id, thread_id, sender_id, sender_kind, body, created_at, priority) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set thread_id=excluded.thread_id, sender_id=excluded.sender_id,
         sender_kind=excluded.sender_kind, body=excluded.body, created_at=excluded.created_at,
         priority=excluded.priority`,
      [m.id, m.threadId, m.senderId, m.senderKind, m.body, m.createdAt, m.priority],
    );
  }
  async listMessagesForThread(threadId: ThreadId): Promise<Message[]> {
    // created_at asc, id asc — chronological with a deterministic tie-break that
    // matches the in-memory adapter's secondary sort (the parity the contract checks).
    const { rows } = await this.#pool.query(
      "select * from messages where thread_id=$1 order by created_at, id",
      [threadId],
    );
    return rows.map(toMessage);
  }
  async listThreadsWithMessages(): Promise<Thread[]> {
    // id-sorted for parity with the in-memory adapter; `exists` avoids dragging
    // message rows. Not time-bounded (DEC-070).
    const { rows } = await this.#pool.query(
      "select t.* from threads t where exists (select 1 from messages m where m.thread_id = t.id) order by t.id",
    );
    return rows.map(toThread);
  }
  async listDmThreadsForCrew(crewMemberId: CrewMemberId): Promise<Thread[]> {
    // The participant→thread index (#117, DEC-071). Join through the DM-only
    // participant rows; id-sorted for parity with the in-memory adapter. `kind`
    // is redundant with the join (only DMs persist participants) but pinned
    // explicitly so a future non-DM participant row could never leak in.
    const { rows } = await this.#pool.query(
      `select t.* from threads t
         join thread_participants p on p.thread_id = t.id
        where t.kind = 'dm' and p.crew_member_id = $1
        order by t.id`,
      [crewMemberId],
    );
    return rows.map(toThread);
  }

  // ── Doorbell read / notify state (6.6a, #116, DEC-069) ─────────────────────
  // Thread-scoped, subjectKey-keyed — symmetric with PostgresPresence.lastActiveFor.
  // Two single-writer tables (DEC-069); the `priority` source is the messages column.
  async readStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    const { rows } = await this.#pool.query<{
      subject_kind: string;
      subject_id: string;
      last_read_at: string;
    }>(
      "select subject_kind, subject_id, last_read_at from message_reads where thread_id=$1",
      [threadId],
    );
    const out = new Map<string, string>();
    for (const r of rows) {
      out.set(subjectKey({ kind: r.subject_kind as AuthSubjectKind, id: r.subject_id }), r.last_read_at);
    }
    return out;
  }
  async notifyStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    const { rows } = await this.#pool.query<{
      subject_kind: string;
      subject_id: string;
      last_notified_at: string;
    }>(
      "select subject_kind, subject_id, last_notified_at from doorbell_notifications where thread_id=$1",
      [threadId],
    );
    const out = new Map<string, string>();
    for (const r of rows) {
      out.set(subjectKey({ kind: r.subject_kind as AuthSubjectKind, id: r.subject_id }), r.last_notified_at);
    }
    return out;
  }
  async recordRead(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    await this.#pool.query(
      `insert into message_reads(thread_id, subject_kind, subject_id, last_read_at) values ($1,$2,$3,$4)
       on conflict (thread_id, subject_kind, subject_id) do update set last_read_at=excluded.last_read_at`,
      [threadId, subject.kind, subject.id, at],
    );
  }
  async recordNotification(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    await this.#pool.query(
      `insert into doorbell_notifications(thread_id, subject_kind, subject_id, last_notified_at) values ($1,$2,$3,$4)
       on conflict (thread_id, subject_kind, subject_id) do update set last_notified_at=excluded.last_notified_at`,
      [threadId, subject.kind, subject.id, at],
    );
  }
}
