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
import { asId } from "../domain/ids.js";
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
  ...opt("dock", r.dock),
});

const toReservation = (r: any): Reservation => ({
  id: asId<"ReservationId">(r.id),
  eventId: asId<"EventId">(r.event_id),
  customerName: r.customer_name,
  partySize: r.party_size,
  status: r.status,
  ...opt("email", r.email),
  ...opt("phone", r.phone),
});

const toShift = (r: any): Shift => ({
  id: asId<"ShiftId">(r.id),
  vesselId: asId<"VesselId">(r.vessel_id),
  date: r.date,
  state: r.state,
  eventIds: (r.event_ids as string[]).map((x) => asId<"EventId">(x)),
  ...opt("lockedAt", r.locked_at),
});

const toSeat = (r: any): Seat => ({
  id: asId<"SeatId">(r.id),
  shiftId: asId<"ShiftId">(r.shift_id),
  role: asId<"RoleTypeId">(r.role),
  kind: r.kind,
  state: r.state,
  ...opt("assignedCrewMemberId", r.assigned_crew_member_id),
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

const toReliability = (r: any): ReliabilityEvent => ({
  id: asId<"ReliabilityEventId">(r.id),
  crewMemberId: asId<"CrewMemberId">(r.crew_member_id),
  type: r.type,
  timestamp: r.timestamp,
  metadata: r.metadata,
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

  // ── Events ─────────────────────────────────────────────────────────────────
  async saveEvent(e: Event): Promise<void> {
    await this.#pool.query(
      `insert into events(id, vessel_id, date, time, capacity, status, dock) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set vessel_id=excluded.vessel_id, date=excluded.date,
         time=excluded.time, capacity=excluded.capacity, status=excluded.status, dock=excluded.dock`,
      [e.id, e.vesselId, e.date, e.time, e.capacity, e.status, e.dock ?? null],
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

  // ── Reservations ───────────────────────────────────────────────────────────
  async saveReservation(r: Reservation): Promise<void> {
    await this.#pool.query(
      `insert into reservations(id, event_id, customer_name, party_size, email, phone, status)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set event_id=excluded.event_id, customer_name=excluded.customer_name,
         party_size=excluded.party_size, email=excluded.email, phone=excluded.phone, status=excluded.status`,
      [
        r.id,
        r.eventId,
        r.customerName,
        r.partySize,
        r.email ?? null,
        r.phone ?? null,
        r.status,
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

  // ── Shifts ─────────────────────────────────────────────────────────────────
  async saveShift(s: Shift): Promise<void> {
    await this.#pool.query(
      `insert into shifts(id, vessel_id, date, state, locked_at, event_ids) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set vessel_id=excluded.vessel_id, date=excluded.date,
         state=excluded.state, locked_at=excluded.locked_at, event_ids=excluded.event_ids`,
      [s.id, s.vesselId, s.date, s.state, s.lockedAt ?? null, JSON.stringify(s.eventIds)],
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

  // ── Seats ──────────────────────────────────────────────────────────────────
  async saveSeat(s: Seat): Promise<void> {
    await this.#pool.query(
      `insert into seats(id, shift_id, role, kind, state, assigned_crew_member_id) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set shift_id=excluded.shift_id, role=excluded.role, kind=excluded.kind,
         state=excluded.state, assigned_crew_member_id=excluded.assigned_crew_member_id`,
      [s.id, s.shiftId, s.role, s.kind, s.state, s.assignedCrewMemberId ?? null],
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
      `update seats set role=$2, kind=$3, state=$4, assigned_crew_member_id=$5
       where id=$1 and state=$6`,
      [
        seat.id,
        seat.role,
        seat.kind,
        seat.state,
        seat.assignedCrewMemberId ?? null,
        expectedState,
      ],
    );
    return rowCount === 1;
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
}
