/**
 * Referential-integrity diagnostic — the loud-failure the no-FK bet removed
 * (DEC-020; DEC-131 for the current posture), relocated to our schedule.
 *
 * The existing graph carries almost no referential enforcement, ratified as-built
 * by DEC-131 with no retrofit: the DB will silently accept a seat whose `shiftId`
 * points at nothing. That's only safe if *something* periodically asserts the spine
 * is intact — this is that something. It walks every child aggregate and confirms
 * each reference resolves to a live parent. Run it in the contract suite (proving
 * both adapters agree) and from `/admin/integrity` (#501) against the real database.
 *
 * It can't be retired by adding foreign keys later, either: three spine references
 * live inside jsonb arrays (`vessel.manning[].roleTypeId`, `crew.ratings[]`,
 * `shift.eventIds[]`) and `magic_tokens.subject_id` is polymorphic. This is
 * permanent infrastructure.
 *
 * Scope: the structural spine, NOT the append-only reliability log (DEC-008) — a
 * dangling crew ref in an immutable log is benign and the log is high-volume, so
 * scanning it on a healthcheck would violate "cheap". Admin magic-link subjects
 * have no entity to point at, so only crew-subject tokens are checked.
 *
 * O(rows): fine at BrewBoat scale and as a scheduled integrity job; not a
 * per-request liveness probe at large volume.
 */

import type { Repository } from "../ports/repository.js";

/** One dangling reference: `entity[id].ref` pointed at a `missingId` that's gone. */
export interface IntegrityViolation {
  entity: string;
  id: string;
  ref: string;
  missingId: string;
}

export interface IntegrityReport {
  ok: boolean;
  violations: IntegrityViolation[];
  /** Rows scanned per aggregate — a cheap "the check actually ran" signal. */
  scanned: Record<string, number>;
}

export async function checkIntegrity(repo: Repository): Promise<IntegrityReport> {
  const [
    roleTypes,
    vessels,
    crew,
    events,
    reservations,
    shifts,
    seats,
    asks,
    credentials,
    ptoWindows,
    magicTokens,
    outboxEntries,
    locations,
    noticeOutbox,
    ringOutbox,
    auditEvents,
    timePunches,
  ] = await Promise.all([
    repo.listAllRoleTypes(),
    repo.listVessels(),
    repo.listCrewMembers(),
    repo.listEvents(),
    repo.listAllReservations(),
    repo.listShifts(),
    repo.listAllSeats(),
    repo.listAllAsks(),
    repo.listAllCredentials(),
    repo.listAllPtoWindows(),
    repo.listAllMagicTokens(),
    repo.listOutboxEntries(),
    repo.listLocations(),
    repo.listNoticeOutboxEntries(),
    repo.listRingOutboxEntries(),
    repo.listAuditEvents(),
    repo.listAllTimePunches(),
  ]);

  const locationIds = new Set(locations.map((l) => l.id as string));
  const roleIds = new Set(roleTypes.map((r) => r.id as string));
  const vesselIds = new Set(vessels.map((v) => v.id as string));
  const crewIds = new Set(crew.map((c) => c.id as string));
  const eventIds = new Set(events.map((e) => e.id as string));
  const shiftIds = new Set(shifts.map((s) => s.id as string));
  const seatIds = new Set(seats.map((s) => s.id as string));

  const v: IntegrityViolation[] = [];
  const miss = (
    set: Set<string>,
    entity: string,
    id: string,
    ref: string,
    value: string,
  ): void => {
    if (!set.has(value)) v.push({ entity, id, ref, missingId: value });
  };

  for (const vessel of vessels) {
    for (const m of vessel.manning) {
      miss(roleIds, "vessel", vessel.id, "manning.roleTypeId", m.roleTypeId);
    }
    // Optional: a vessel with no home location is legitimate, a vessel pointing at a
    // location that was deleted is not.
    if (vessel.homeLocationId !== undefined) {
      miss(locationIds, "vessel", vessel.id, "homeLocationId", vessel.homeLocationId);
    }
  }
  for (const c of crew) {
    for (const r of c.ratings) miss(roleIds, "crew", c.id, "ratings", r);
  }
  for (const e of events) miss(vesselIds, "event", e.id, "vesselId", e.vesselId);
  for (const r of reservations) {
    // Null while pending (§2.8.2) — nothing to resolve. What this report says about a
    // pending row, and whether a null on a non-pending row is a miss, is 14.3's call.
    if (r.eventId !== null) miss(eventIds, "reservation", r.id, "eventId", r.eventId);
  }
  for (const s of shifts) {
    miss(vesselIds, "shift", s.id, "vesselId", s.vesselId);
    for (const e of s.eventIds) miss(eventIds, "shift", s.id, "eventIds", e);
  }
  for (const s of seats) {
    miss(shiftIds, "seat", s.id, "shiftId", s.shiftId);
    miss(roleIds, "seat", s.id, "role", s.role);
    if (s.assignedCrewMemberId !== undefined) {
      miss(crewIds, "seat", s.id, "assignedCrewMemberId", s.assignedCrewMemberId);
    }
  }
  for (const a of asks) {
    miss(seatIds, "ask", a.id, "seatId", a.seatId);
    miss(crewIds, "ask", a.id, "crewMemberId", a.crewMemberId);
  }
  for (const c of credentials) {
    miss(crewIds, "credential", c.id, "crewMemberId", c.crewMemberId);
  }
  for (const p of ptoWindows) {
    miss(crewIds, "ptoWindow", p.id, "crewMemberId", p.crewMemberId);
  }
  // Time punches (SPEC §2.9). `crewMemberId` is FK'd in Postgres, but the diagnostic
  // also runs against the in-memory adapter, which holds no constraints (DEC-131) —
  // so it's checked here too. `shiftId` is the one nothing else watches: deliberately
  // un-FK'd, because it's an auto-matched annotation and reforming a shift must never
  // take a punch with it. A dangling tag is benign (the hours stand, the tag stops
  // resolving) — which is why it's reported rather than prevented. A NULL tag is the
  // normal zero-or-many-matches case, so it's guarded here (`miss` reports any value
  // its set lacks; it has no null branch — see the `homeLocationId` call above).
  for (const p of timePunches) {
    miss(crewIds, "timePunch", p.id, "crewMemberId", p.crewMemberId);
    if (p.shiftId !== null) {
      miss(shiftIds, "timePunch", p.id, "shiftId", p.shiftId);
    }
  }
  for (const t of magicTokens) {
    if (t.subjectKind === "crew") {
      miss(crewIds, "magicToken", t.id, "subjectId", t.subjectId);
    }
  }
  // Outbox entries (DEC-030): channel-adapter state, but it points into the
  // spine (ask/seat/crew) — a dangling ref means the relay card can't render.
  const askIds = new Set(asks.map((a) => a.id as string));
  for (const o of outboxEntries) {
    miss(askIds, "outboxEntry", o.id, "askId", o.askId);
    miss(seatIds, "outboxEntry", o.id, "seatId", o.seatId);
    miss(crewIds, "outboxEntry", o.id, "crewMemberId", o.crewMemberId);
  }

  // The two relay worklists that arrived after this diagnostic was written (DEC-084 notices,
  // DEC-073 doorbell rings). Same argument as `outbox_entries` above — adapter state, but it
  // points into the spine, and a dangling ref means a relay card that can't render.
  for (const n of noticeOutbox) {
    miss(crewIds, "noticeOutboxEntry", n.id, "crewMemberId", n.crewMemberId);
  }
  for (const r of ringOutbox) {
    miss(crewIds, "ringOutboxEntry", r.id, "crewMemberId", r.crewMemberId);
  }
  // Crew audit log (DEC-118) — the operator-facing record of who changed what. A row naming a
  // crew member who no longer exists renders as a blank actor (`audit-trail.ts`).
  //
  // `actorId` is polymorphic and only SOMETIMES a crew id: per `AuditActor` in domain/audit.ts
  // it is "the admin's crew id for `admin`, a source tag (e.g. \"xola\") for `importer`, and
  // undefined for `engine`/`crew`-self". So `admin` is the one kind whose actorId is checkable —
  // admins are crew (DEC-092; `admins.id` IS a crew id), an importer's is a source tag, and the
  // other two carry nothing. The first version of this gated on `crew`, which is precisely the
  // kind that never has an id: the branch was dead and its test asserted the inversion as
  // intended. Same shape as `magic_tokens.subject_id`, and the same trap.
  for (const a of auditEvents) {
    miss(crewIds, "auditEvent", a.id, "crewMemberId", a.crewMemberId);
    if (a.actorKind === "admin" && a.actorId !== undefined) {
      miss(crewIds, "auditEvent", a.id, "actorId", a.actorId);
    }
  }

  return {
    ok: v.length === 0,
    violations: v,
    scanned: {
      roleTypes: roleTypes.length,
      vessels: vessels.length,
      crew: crew.length,
      events: events.length,
      reservations: reservations.length,
      shifts: shifts.length,
      seats: seats.length,
      asks: asks.length,
      credentials: credentials.length,
      ptoWindows: ptoWindows.length,
      magicTokens: magicTokens.length,
      outboxEntries: outboxEntries.length,
      locations: locations.length,
      noticeOutboxEntries: noticeOutbox.length,
      ringOutboxEntries: ringOutbox.length,
      auditEvents: auditEvents.length,
      timePunches: timePunches.length,
    },
  };
}
