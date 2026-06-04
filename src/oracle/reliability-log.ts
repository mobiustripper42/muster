/**
 * Reliability-event logging helpers (SPEC §1.4, DEC-008).
 *
 * "Log rich from day one, even if v1's formula ignores some." The ask/confirm
 * loop (1.4b) and the lifecycle hooks call these to append real events; no scorer
 * reads them yet, but the substrate must be real from the first commit (DEC-008).
 *
 * Each helper mints a deterministic id from the event's natural key (matching the
 * codebase's no-random-no-clock id convention — every other id is derived, not
 * UUID'd), stamps the injected `now`, and appends through the port. `now` is
 * always injected: the core never reads the clock.
 *
 * The two distinctions the score lives or dies on (§1.4), encoded as separate
 * helpers so a caller can't blur them:
 *  - declining (`ask_declined`) is NEUTRAL; ignoring (`ask_ignored`) is the sin.
 *  - a bail's *lateness* is the signal (`latenessMs`), not the bail itself.
 *
 * ⏳ `hold_released` (Pass D, DEC-008) has no helper — v1 never emits it.
 */

import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import type {
  ReliabilityEvent,
  ReliabilityEventMetadata,
  ReliabilityEventType,
} from "../domain/reliability.js";
import type { Repository } from "../ports/repository.js";

/**
 * Deterministic event id from its natural key (crew · type · timestamp · seat).
 * Unique per logical event for the ask lifecycle; a durable DB swaps in a
 * surrogate key later. The append-only log never overwrites, so a same-key
 * collision would duplicate rather than clobber — the components above make that
 * vanishingly unlikely in practice.
 */
function mintId(
  crewMemberId: CrewMemberId,
  type: ReliabilityEventType,
  timestamp: string,
  seatId?: SeatId,
): ReliabilityEvent["id"] {
  const seatPart = seatId ? `-${seatId}` : "";
  return asId<"ReliabilityEventId">(
    `rel-${crewMemberId}-${type}-${timestamp}${seatPart}`,
  );
}

/**
 * The one append path every helper funnels through. Builds the event, stamps
 * `now`, and writes it. Exported for event types without a named wrapper and for
 * tests; prefer the typed helpers below for the common lifecycle events.
 */
export async function recordReliabilityEvent(
  repo: Repository,
  crewMemberId: CrewMemberId,
  type: ReliabilityEventType,
  now: Date,
  metadata: ReliabilityEventMetadata = {},
): Promise<ReliabilityEvent> {
  const timestamp = now.toISOString();
  const event: ReliabilityEvent = {
    id: mintId(crewMemberId, type, timestamp, metadata.seatId),
    crewMemberId,
    type,
    timestamp,
    metadata,
  };
  await repo.logReliabilityEvent(event);
  return event;
}

// ── Response events (per ask) ───────────────────────────────────────────────

/** An ask went out. The lifecycle's opening event. */
export function logAskSent(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "ask_sent", now, {
    seatId,
    shiftId,
  });
}

/** Accepted — positive, scaled by how fast (`latencyMs` since the ask). */
export function logAskAccepted(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
  latencyMs: number,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "ask_accepted", now, {
    seatId,
    shiftId,
    latencyMs,
  });
}

/** Declined — **neutral** (§1.4). They answered; that's the point. Latency kept. */
export function logAskDeclined(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
  latencyMs: number,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "ask_declined", now, {
    seatId,
    shiftId,
    latencyMs,
  });
}

/** Timed out with no answer — the **negative** one (§1.4). No latency: silence. */
export function logAskIgnored(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "ask_ignored", now, {
    seatId,
    shiftId,
  });
}

// ── Commitment events (per confirmed seat) ──────────────────────────────────

/** Trip ran and they crewed it — positive. */
export function logShiftCompleted(
  repo: Repository,
  crewMemberId: CrewMemberId,
  shiftId: ShiftId,
  now: Date,
  seatId?: SeatId,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "shift_completed", now, {
    shiftId,
    ...(seatId ? { seatId } : {}),
  });
}

/** Backed out after confirming — negative, scaled by `latenessMs` before call. */
export function logShiftBailed(
  repo: Repository,
  crewMemberId: CrewMemberId,
  shiftId: ShiftId,
  now: Date,
  latenessMs: number,
  seatId?: SeatId,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "shift_bailed", now, {
    shiftId,
    latenessMs,
    ...(seatId ? { seatId } : {}),
  });
}

/** Confirmed, then simply didn't show — the worst case. */
export function logNoShow(
  repo: Repository,
  crewMemberId: CrewMemberId,
  shiftId: ShiftId,
  now: Date,
  seatId?: SeatId,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "no_show", now, {
    shiftId,
    ...(seatId ? { seatId } : {}),
  });
}

// ── Bonus + acknowledgment ──────────────────────────────────────────────────

/** Took an escalation ask (a shift others passed on) — bonus. */
export function logEscalationAccepted(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(
    repo,
    crewMemberId,
    "escalation_accepted",
    now,
    { seatId, shiftId },
  );
}

/** Rescued an at-risk shift — bonus. */
export function logAtRiskRescue(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "at_risk_rescue", now, {
    seatId,
    shiftId,
  });
}

/** Acknowledged an upcoming shift — small positive, no penalty arm (§1.4). */
export function logShiftAcknowledged(
  repo: Repository,
  crewMemberId: CrewMemberId,
  shiftId: ShiftId,
  now: Date,
  seatId?: SeatId,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "shift_acknowledged", now, {
    shiftId,
    ...(seatId ? { seatId } : {}),
  });
}
