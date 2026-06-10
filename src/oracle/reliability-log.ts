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
 * Deterministic event id from its natural key (crew · type · timestamp · seat
 * · reason). Unique per logical event for the ask lifecycle; a durable DB swaps
 * in a surrogate key later. The append-only log never overwrites, so a same-key
 * collision would duplicate rather than clobber — the components above make that
 * vanishingly unlikely in practice. The `reason` component is load-bearing for
 * `board_landed` (DEC-026): one shift can land for TWO reasons in the SAME tick
 * (core + regression share `now`, and there's no seat), which collided on the
 * Postgres pkey before reason joined the key.
 */
function mintId(
  crewMemberId: CrewMemberId,
  type: ReliabilityEventType,
  timestamp: string,
  seatId?: SeatId,
  reason?: string,
): ReliabilityEvent["id"] {
  const seatPart = seatId ? `-${seatId}` : "";
  const reasonPart = reason ? `-${reason}` : "";
  return asId<"ReliabilityEventId">(
    `rel-${crewMemberId}-${type}-${timestamp}${seatPart}${reasonPart}`,
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
    id: mintId(crewMemberId, type, timestamp, metadata.seatId, metadata.reason),
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

// ── Tier-2 escalation actions (DEC-024) ─────────────────────────────────────
//
// Engine moves, not crew behavior — the scorer ignores them. They exist so the
// At-Risk board can reconstruct the escalation trail (§2.5) from the one
// append-only log (DEC-008), without a second aggregate. `escalationTrailFor`
// (asks/escalation-trail.ts) reads them back, filtered by `metadata.shiftId`.

/**
 * The non-crew actor for shift-level escalation events. `pool_widened` is an
 * engine action with no person attached, so it keys here instead of to a
 * CrewMember; this id never appears in `listCrewMembers`. The one keying wart of
 * the derived-trail choice (DEC-024) — accepted over standing up a new aggregate.
 */
export const SYSTEM_ACTOR_ID: CrewMemberId = asId<"CrewMemberId">("system");

/**
 * Tier-2 widened the pool for a shift (DEC-024). A **logged stub** in v1: every
 * eligibility rule is hard and the Tier-1 broadcast already reached the whole
 * pool, so there is nothing to relax — this records that the engine re-confirmed
 * full-pool exhaustion (the "I checked everyone, twice" rung of the trail), not
 * that anyone new became eligible. Keyed to the system actor; the shift is in
 * `metadata.shiftId`.
 */
export function logPoolWidened(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, SYSTEM_ACTOR_ID, "pool_widened", now, {
    shiftId,
  });
}

/**
 * Tier-2 direct-nudged a high-reliability person (DEC-024) — the live lever of
 * Tier 2: an assign-then-confirm to a not-yet-asked top-ranked crew. Keyed to the
 * nudged person (it's part of their escalation history; `escalation_accepted` is
 * the bonus when they take it), with the seat + shift in metadata.
 */
export function logNudged(
  repo: Repository,
  crewMemberId: CrewMemberId,
  seatId: SeatId,
  shiftId: ShiftId,
  now: Date,
  opts?: { manual?: boolean },
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, crewMemberId, "nudged", now, {
    seatId,
    shiftId,
    // A board *lean* (DEC-026) is Spink's move, not the engine's — flagged so
    // "how often did the human step in" stays derivable from the one log.
    ...(opts?.manual ? { manual: true } : {}),
  });
}

/**
 * A shift landed on the At-Risk board for a reason it hadn't landed for before
 * (DEC-026). Shift-level like `pool_widened`, so system-actor-keyed; one event
 * per (shift, reason) is the ping-dedup memory — `tick` checks for it before
 * recording, so a rescued shift that later REGRESSES re-pings (new reason) while
 * a same-reason re-landing stays quiet (accepted v1 wrinkle). Delivery is the
 * deferred DEC-MSG-3 half: when a real channel adapter lands, the send hangs off
 * this exact spot.
 */
export function logBoardLanded(
  repo: Repository,
  shiftId: ShiftId,
  reason: string,
  now: Date,
): Promise<ReliabilityEvent> {
  return recordReliabilityEvent(repo, SYSTEM_ACTOR_ID, "board_landed", now, {
    shiftId,
    reason,
  });
}
