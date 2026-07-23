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
  ]);

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
  }
  for (const c of crew) {
    for (const r of c.ratings) miss(roleIds, "crew", c.id, "ratings", r);
  }
  for (const e of events) miss(vesselIds, "event", e.id, "vesselId", e.vesselId);
  for (const r of reservations) {
    miss(eventIds, "reservation", r.id, "eventId", r.eventId);
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
    },
  };
}
