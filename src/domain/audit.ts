/**
 * The crew audit log (#400, DEC-118).
 *
 * An operator-facing, append-only trail of every crew **add / drop / change** —
 * with an **actor** dimension the reliability log has no room for. Deliberately
 * SEPARATE from `reliability_events` (scoring substrate, DEC-008): an admin
 * removal / operator force-place / self-claim is NOT the subject's behavior, and
 * this log NEVER feeds the scorer. `reliability_events` answers "whose behavior
 * is this"; `audit_events` answers "who did what to whom, and when."
 *
 * The `/admin/audit` view (Slice B) UNIONs these rows with a projection over
 * `reliability_events` (accepted→add, bailed→drop, decline/ignore/nudge context)
 * — one source per fact, no dual-write.
 */

import type { AuditEventId, CrewMemberId, SeatId, ShiftId, VesselId } from "./ids.js";

/** What happened to a crew member's seating. */
export const AUDIT_EVENT_TYPES = [
  "crew_added", // put on a seat (self-claim, operator override/force-assign)
  "crew_removed", // taken off a seat (admin vacate, override displacement)
  "shift_changed", // an import changed the trips of a shift they're on (#353)
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Who performed the action — the dimension distinct from the subject crew. */
export const AUDIT_ACTOR_KINDS = ["crew", "admin", "importer", "engine"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** The acting party. `id` is the admin's crew id for `admin`, a source tag
 *  (e.g. "xola") for `importer`, and undefined for `engine`/`crew`-self. */
export interface AuditActor {
  kind: AuditActorKind;
  id?: string;
}

/** Side-channel facts. All optional; different types populate different fields. */
export interface AuditEventMetadata {
  seatId?: SeatId;
  shiftId?: ShiftId;
  vesselId?: VesselId;
  /** For a `crew_added` that bumped someone: the crew this add displaced. */
  displaced?: CrewMemberId;
  /** How an add happened — mirrors `seat.acquiredVia`: self_claim | operator. */
  via?: string;
  /** Import run id for `shift_changed` (actor_kind: importer). */
  runId?: string;
  /** Free-text reason (admin note, "misassignment", the import's change kind). */
  reason?: string;
}

export interface AuditEvent {
  id: AuditEventId;
  /** The subject — the crew member the action happened TO. */
  crewMemberId: CrewMemberId;
  /** Who acted. */
  actorKind: AuditActorKind;
  /** The acting identity; undefined for engine and crew-self. */
  actorId?: string;
  type: AuditEventType;
  /** ISO-8601 UTC. Stored as a string to keep the domain serialization-pure. */
  timestamp: string;
  metadata: AuditEventMetadata;
}
