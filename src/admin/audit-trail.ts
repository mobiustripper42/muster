/**
 * The crew audit trail — one operator-facing list of every crew **add / drop /
 * change**, newest first (#400 Slice B, DEC-118). "When · who it happened to ·
 * what happened · who did it," filterable by crew and by kind (added / removed /
 * changed).
 *
 * ONE list, two sources, no dual-write (DEC-118's union):
 *  - `audit_events` — the facts Slice A emits at the edge: operator override
 *    (add + any displacement drop), no-penalty vacate (drop), self-claim (add),
 *    import shift-change, and trainee staff/unstaff.
 *  - a PROJECTION over `reliability_events` for the add/drop transitions that
 *    were ALREADY persisted there and are NOT re-emitted to `audit_events` (one
 *    source per fact): a normal ask acceptance (`ask_accepted` → added) and a
 *    bail / no-show (`shift_bailed` / `no_show` → removed).
 *
 * Deliberately NOT included: `ask_declined` / `ask_ignored` / `nudged` and the
 * rest. They aren't an add/drop/change of a seat — they're ask-lifecycle context
 * and live on `/admin/asks`. Folding them in here would smuggle the asks list
 * back in; this stays a clean audit list of who-ended-up-on-or-off a boat.
 *
 * Derived, not stored (the ask-trail idiom): pure over the port, only existing
 * reads, identical on both adapters. No backfill — capture began when Slice A
 * shipped; the UI says so.
 */

import type { AuditEvent } from "../domain/audit.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/** What happened to a seat — the "kind" the operator filters on. */
export type AuditAction = "added" | "removed" | "changed";

export interface AuditTrailRow {
  /** Which store the row came from (audit fact vs reliability projection). */
  source: "audit" | "reliability";
  action: AuditAction;
  /** The subject — the crew member it happened TO. */
  crewMemberId: CrewMemberId;
  crewName: string;
  /** Who did it, already resolved to copy: an admin's name, "self-claim",
   *  "Xola import", "bailed", etc. — the "Who" column, not a filter axis. */
  actorLabel: string;
  /** ISO-8601 UTC — the sort key; the surface formats it. */
  timestamp: string;
  /** Shift context where the event carries it (audit + reliability metadata). */
  shiftId: ShiftId | null;
  date: string | null;
  vesselName: string | null;
  /** Extra colour: a removal reason ("misassignment" / "displaced"), or "".  */
  detail: string;
}

export interface AuditTrailFilter {
  crewMemberId?: CrewMemberId;
  /** The "kind" filter — added / removed / changed. */
  action?: AuditAction;
}

/** The reliability event types that ARE an add/drop transition (everything else
 *  is ask-lifecycle context, excluded on purpose). */
const RELIABILITY_ACTION: Partial<Record<ReliabilityEvent["type"], AuditAction>> = {
  ask_accepted: "added",
  shift_bailed: "removed",
  no_show: "removed",
};

/** Human label for an audit event's actor. */
function auditActorLabel(e: AuditEvent, crewName: Map<string, string>): string {
  switch (e.actorKind) {
    case "admin":
      return e.actorId ? crewName.get(e.actorId) ?? "An admin" : "An admin";
    case "importer":
      return e.actorId === "xola" ? "Xola import" : "Import";
    case "crew":
      return e.metadata.via === "self_claim" ? "self-claim" : "self";
    case "engine":
      return "Automatic";
    default:
      return "—";
  }
}

/** Label for a reliability-projected row (the crew's own responsiveness). */
function reliabilityActorLabel(e: ReliabilityEvent): string {
  if (e.type === "ask_accepted") return "answered ask";
  if (e.type === "no_show") return "no-show";
  // shift_bailed — an operator-reported bail is `manual`, a self-bail isn't.
  return e.metadata.manual ? "reported bail" : "bailed";
}

/**
 * Build the audit trail, newest first. Reads both logs, projects each into the
 * one row shape, resolves crew/shift labels once up front (the deriveAllShifts
 * idiom), then applies the crew / kind filter.
 */
export async function buildAuditTrail(
  repo: Repository,
  filter: AuditTrailFilter = {},
): Promise<AuditTrailRow[]> {
  const [audits, reliability, crew, vessels, shifts] = await Promise.all([
    repo.listAuditEvents(),
    repo.listAllReliabilityEvents(),
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

  const rows: AuditTrailRow[] = [];

  for (const e of audits) {
    const action: AuditAction =
      e.type === "crew_added" ? "added" : e.type === "crew_removed" ? "removed" : "changed";
    rows.push({
      source: "audit",
      action,
      crewMemberId: e.crewMemberId,
      crewName: crewName.get(String(e.crewMemberId)) ?? "(unknown crew)",
      actorLabel: auditActorLabel(e, crewName),
      timestamp: e.timestamp,
      ...shiftCtx(e.metadata.shiftId),
      detail: e.metadata.reason ?? "",
    });
  }

  for (const e of reliability) {
    const action = RELIABILITY_ACTION[e.type];
    if (!action) continue; // not an add/drop transition — ask context, excluded
    rows.push({
      source: "reliability",
      action,
      crewMemberId: e.crewMemberId,
      crewName: crewName.get(String(e.crewMemberId)) ?? "(unknown crew)",
      actorLabel: reliabilityActorLabel(e),
      timestamp: e.timestamp,
      ...shiftCtx(e.metadata.shiftId),
      detail: "",
    });
  }

  const filtered = rows.filter(
    (r) =>
      (!filter.crewMemberId || r.crewMemberId === filter.crewMemberId) &&
      (!filter.action || r.action === filter.action),
  );

  // Newest first — the operator scans "what just happened" from the top. Tie-break
  // on crew so equal-timestamp rows (an override's add+drop pair) order stably.
  return filtered.sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) ||
      a.crewName.localeCompare(b.crewName),
  );
}
