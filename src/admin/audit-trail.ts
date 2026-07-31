/**
 * The crew audit trail — one operator-facing list of EVERY event that happens to
 * a crew member, newest first (#400, DEC-118). Filterable by crew and by kind.
 *
 * Two sources, one row each (no projection, no dedup — every event is its own
 * line, in time order):
 *  - `reliability_events` (DEC-008), the crew-keyed ones: asked / nudged / in /
 *    escalation-in / out / no-reply / acknowledged / claimed / completed / bailed /
 *    no-show / rescue. The two shift-level, system-actor events (`pool_widened`,
 *    `board_landed`) are NOT a crew's audit and are excluded.
 *  - `audit_events`, the operator/import/self actions: added / removed / changed.
 *
 * Derived, not stored (the ask-trail idiom): pure over the port, identical on
 * both adapters. No backfill for the `audit_events` half — capture began when
 * Slice A shipped; the reliability half goes back as far as that log.
 */

import type { AuditEvent } from "../domain/audit.js";
import type { ReliabilityEvent, ReliabilityEventType } from "../domain/reliability.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/** Every kind a crew event can be — the "kind" the operator filters on. */
export type AuditKind =
  | "asked"
  | "nudged"
  | "in"
  | "escalation_in"
  | "out"
  | "no_reply"
  | "added"
  | "removed"
  | "changed"
  | "acknowledged"
  | "claimed"
  | "completed"
  | "bailed"
  | "no_show"
  | "rescue";

/** Display label per kind — the pill text. */
export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  asked: "Asked",
  nudged: "Nudged",
  in: "Yes",
  escalation_in: "Escalation Yes",
  out: "No",
  no_reply: "No reply",
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  acknowledged: "Acknowledged",
  claimed: "Claimed",
  completed: "Completed",
  bailed: "Bailed",
  no_show: "No-show",
  rescue: "Rescue",
};

/** The order the Kind filter lists them (asks → placement → outcome). */
export const AUDIT_KINDS: readonly AuditKind[] = [
  "asked",
  "nudged",
  "in",
  "escalation_in",
  "out",
  "no_reply",
  "added",
  "removed",
  "changed",
  "acknowledged",
  "claimed",
  "completed",
  "bailed",
  "no_show",
  "rescue",
];

/** Crew-keyed reliability types → kind. Types absent here (pool_widened,
 *  board_landed) are shift-level and excluded from a crew's audit. */
const RELIABILITY_KIND: Partial<Record<ReliabilityEventType, AuditKind>> = {
  ask_sent: "asked",
  nudged: "nudged",
  ask_accepted: "in",
  escalation_accepted: "escalation_in",
  ask_declined: "out",
  ask_ignored: "no_reply",
  shift_acknowledged: "acknowledged",
  // #570: without this the +4 would move a score with no row explaining it —
  // `buildAuditTrail` drops any reliability type absent from this map.
  self_claim: "claimed",
  shift_completed: "completed",
  shift_bailed: "bailed",
  no_show: "no_show",
  at_risk_rescue: "rescue",
};

export interface AuditTrailRow {
  source: "audit" | "reliability";
  kind: AuditKind;
  crewMemberId: CrewMemberId;
  crewName: string;
  /** Who / how — an admin's name, "self", "Xola import", "engine". */
  actorLabel: string;
  timestamp: string;
  shiftId: ShiftId | null;
  date: string | null;
  vesselName: string | null;
  /** Extra colour: a removal reason, or "". */
  detail: string;
}

export interface AuditTrailFilter {
  crewMemberId?: CrewMemberId;
  kind?: AuditKind;
}

/** Who/how for a reliability event — mostly the crew themselves; the engine asks,
 *  a nudge/bail can be operator-driven (`manual`). */
function reliabilityActor(e: ReliabilityEvent): string {
  switch (e.type) {
    case "ask_sent":
      return "engine";
    case "nudged":
      return e.metadata.manual ? "admin" : "engine";
    case "shift_bailed":
      return e.metadata.manual ? "admin (reported)" : "self";
    case "no_show":
      return "—";
    default:
      return "self"; // accepted / declined / no-reply / ack / completed / rescue / escalation
  }
}

/** Who/how for an audit event. */
function auditActor(e: AuditEvent, crewName: Map<string, string>): string {
  switch (e.actorKind) {
    case "admin":
      return e.actorId ? crewName.get(e.actorId) ?? "An admin" : "An admin";
    case "importer":
      return e.actorId === "xola" ? "Xola import" : "Import";
    case "crew":
      return e.metadata.via === "self_claim" ? "self-claim" : "self";
    case "engine":
      return "engine";
    default:
      return "—";
  }
}

/**
 * Build the crew audit trail, newest first. Reads both logs, maps each crew event
 * to one row, resolves crew/shift labels once up front, applies the crew / kind
 * filter, sorts.
 */
export async function buildAuditTrail(
  repo: Repository,
  filter: AuditTrailFilter = {},
): Promise<AuditTrailRow[]> {
  const [reliability, audits, crew, vessels, shifts] = await Promise.all([
    repo.listAllReliabilityEvents(),
    repo.listAuditEvents(),
    repo.listCrewMembers(),
    repo.listVessels(),
    repo.listShifts(),
  ]);

  const crewName = new Map(crew.map((c) => [String(c.id), c.name]));
  const vesselName = new Map(vessels.map((v) => [String(v.id), v.name]));
  const shiftById = new Map(shifts.map((s) => [String(s.id), s]));

  const shiftCtx = (shiftId?: ShiftId) => {
    const shift = shiftId ? shiftById.get(String(shiftId)) : undefined;
    return {
      shiftId: shift?.id ?? shiftId ?? null,
      date: shift?.date ?? null,
      vesselName: shift ? vesselName.get(String(shift.vesselId)) ?? null : null,
    };
  };
  const nameOf = (id: CrewMemberId) => crewName.get(String(id)) ?? "(unknown crew)";

  const rows: AuditTrailRow[] = [];

  for (const e of reliability) {
    const kind = RELIABILITY_KIND[e.type];
    if (!kind) continue; // shift-level (pool_widened / board_landed) — not a crew's audit
    rows.push({
      source: "reliability",
      kind,
      crewMemberId: e.crewMemberId,
      crewName: nameOf(e.crewMemberId),
      actorLabel: reliabilityActor(e),
      timestamp: e.timestamp,
      ...shiftCtx(e.metadata.shiftId),
      detail: "",
    });
  }

  for (const e of audits) {
    const kind: AuditKind =
      e.type === "crew_added" ? "added" : e.type === "crew_removed" ? "removed" : "changed";
    rows.push({
      source: "audit",
      kind,
      crewMemberId: e.crewMemberId,
      crewName: nameOf(e.crewMemberId),
      actorLabel: auditActor(e, crewName),
      timestamp: e.timestamp,
      ...shiftCtx(e.metadata.shiftId),
      detail: e.metadata.reason ?? "",
    });
  }

  return rows
    .filter(
      (r) =>
        (!filter.crewMemberId || r.crewMemberId === filter.crewMemberId) &&
        (!filter.kind || r.kind === filter.kind),
    )
    .sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) || a.crewName.localeCompare(b.crewName),
    );
}
