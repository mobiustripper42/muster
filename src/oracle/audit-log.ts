/**
 * Crew audit-log helpers (#400, DEC-118).
 *
 * The write half of the crew audit trail. Mirrors `reliability-log.ts`: each
 * helper mints a deterministic id (no random, no clock — `now` injected), stamps
 * the time, and appends through the port. Distinct from the reliability log in
 * two ways that are the whole point of the second table: it carries an **actor**
 * (who acted, separate from the subject crew) and it **never feeds the scorer**.
 *
 * Emitted at the EDGE (server actions), not threaded through the seat machine
 * (DEC-030 posture): the domain call mutates + returns what happened, and the
 * action logs the audit event with the actor the session knows. The append is
 * post-mutation and not transactional with the seat write — a crash in the gap
 * drops one audit row (accepted at pilot scale; same posture as the ask loop's
 * reliability appends).
 */

import type { CrewMemberId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import type {
  AuditActor,
  AuditEvent,
  AuditEventMetadata,
  AuditEventType,
} from "../domain/audit.js";
import type { Repository } from "../ports/repository.js";

/**
 * Deterministic id from the event's natural key (subject · actor · type · time ·
 * seat · reason). Append-only, so a same-key collision would duplicate rather
 * than clobber — the components make that vanishingly unlikely. The two events an
 * override fires (a `crew_added` for the placed crew, a `crew_removed` for the
 * displaced one) key on different subjects, so they never collide despite sharing
 * `now`.
 */
function mintId(
  crewMemberId: CrewMemberId,
  actorKind: string,
  type: AuditEventType,
  timestamp: string,
  metadata: AuditEventMetadata,
): AuditEvent["id"] {
  const seatPart = metadata.seatId ? `-${metadata.seatId}` : "";
  const runPart = metadata.runId ? `-${metadata.runId}` : "";
  const reasonPart = metadata.reason ? `-${metadata.reason}` : "";
  return asId<"AuditEventId">(
    `aud-${crewMemberId}-${actorKind}-${type}-${timestamp}${seatPart}${runPart}${reasonPart}`,
  );
}

/**
 * The one append path every helper funnels through. Exported for event types
 * without a named wrapper and for tests; prefer the typed helpers below.
 */
export async function recordAuditEvent(
  repo: Repository,
  crewMemberId: CrewMemberId,
  actor: AuditActor,
  type: AuditEventType,
  now: Date,
  metadata: AuditEventMetadata = {},
): Promise<AuditEvent> {
  const timestamp = now.toISOString();
  const event: AuditEvent = {
    id: mintId(crewMemberId, actor.kind, type, timestamp, metadata),
    crewMemberId,
    actorKind: actor.kind,
    ...(actor.id !== undefined ? { actorId: actor.id } : {}),
    type,
    timestamp,
    metadata,
  };
  await repo.appendAuditEvent(event);
  return event;
}

/** Crew member was put on a seat (self-claim, operator override/force-assign). */
export function logCrewAdded(
  repo: Repository,
  crewMemberId: CrewMemberId,
  actor: AuditActor,
  now: Date,
  metadata: AuditEventMetadata = {},
): Promise<AuditEvent> {
  return recordAuditEvent(repo, crewMemberId, actor, "crew_added", now, metadata);
}

/** Crew member was taken off a seat (admin vacate, override displacement). */
export function logCrewRemoved(
  repo: Repository,
  crewMemberId: CrewMemberId,
  actor: AuditActor,
  now: Date,
  metadata: AuditEventMetadata = {},
): Promise<AuditEvent> {
  return recordAuditEvent(repo, crewMemberId, actor, "crew_removed", now, metadata);
}

/** An import changed the trips of a shift this crew member is on (#353). */
export function logShiftChanged(
  repo: Repository,
  crewMemberId: CrewMemberId,
  actor: AuditActor,
  now: Date,
  metadata: AuditEventMetadata = {},
): Promise<AuditEvent> {
  return recordAuditEvent(repo, crewMemberId, actor, "shift_changed", now, metadata);
}
