/**
 * The reliability-event log (SPEC §1.4, DEC-008).
 *
 * "Log rich from day one, even if v1's formula ignores some." These events are
 * the durable substrate; the v1 score (a deliberately dumb rolling window) reads
 * a subset. Everything here must be real from the first commit even though no
 * scorer consumes it yet.
 */

import type {
  CrewMemberId,
  ReliabilityEventId,
  SeatId,
  ShiftId,
} from "./ids.js";

/**
 * Loggable event kinds. The two distinctions that make or break the score:
 *  - declining is NEUTRAL; ignoring (`ask_ignored`) is the sin.
 *  - the lateness of a bail is the signal, not the bail itself.
 *
 * ⏳ `hold_released` is RESERVED for Pass D (progressive commitment, DEC-008):
 * when a soft `Held` seat is released at the hard-confirm horizon. Listed now so
 * the column exists; v1 never emits it.
 */
export const RELIABILITY_EVENT_TYPES = [
  // Response (per ask)
  "ask_sent",
  "ask_accepted", // +latency
  "ask_declined", // +latency, neutral
  "ask_ignored", // timed out — negative
  // Commitment (per confirmed seat)
  "shift_completed", // positive
  "shift_bailed", // negative, scaled by lateness
  "no_show", // worst case
  // Bonus
  "escalation_accepted",
  "at_risk_rescue",
  // Acknowledgment — small positive only, no penalty arm
  "shift_acknowledged",
  // Tier-2 escalation actions (DEC-024) — engine moves, not crew behavior. The
  // scorer ignores them; they exist to feed the At-Risk board's transparency
  // trail (§2.5). `nudged` keys to the nudged crew; `pool_widened` is a
  // shift-level stub keyed to the system actor (v1 has no soft rule to relax).
  "nudged",
  "pool_widened",
  // Board landing (DEC-026) — shift-level, system-actor-keyed like pool_widened.
  // The detection half of "landing on the board pings Spink" (§2.5): one event
  // per (shift, reason) is the dedup memory; delivery rides the DEC-MSG-3
  // pilot adapter later.
  "board_landed",
  /* ⏳ "hold_released"  ← Pass D (DEC-008) — do not emit in v1 */
] as const;

export type ReliabilityEventType = (typeof RELIABILITY_EVENT_TYPES)[number];

/**
 * Side-channel facts a scorer may weight. All optional — different event types
 * populate different fields. Room is left for Pass D metadata without a schema
 * change (the `Held` lineage of an event, etc.).
 */
export interface ReliabilityEventMetadata {
  /** ms between ask_sent and response — for ask_accepted / ask_declined. */
  latencyMs?: number;
  /**
   * How late a bail landed, in ms — measured from the bail toward call time, so
   * a *higher* value means a *later* bail. Drives the bail penalty: the scorer
   * (`reliability-score.ts`) weighs a late bail more than an early one.
   */
  latenessMs?: number;
  seatId?: SeatId;
  shiftId?: ShiftId;
  /**
   * True when a human (Spink) drove the action, not the engine — a board *lean*
   * logs `nudged` with `manual: true` (DEC-026), so "how often did the human
   * have to step in" stays derivable from the one log.
   */
  manual?: boolean;
  /** Which board membership reason a `board_landed` event records (DEC-026). */
  reason?: string;
}

export interface ReliabilityEvent {
  id: ReliabilityEventId;
  crewMemberId: CrewMemberId;
  type: ReliabilityEventType;
  /** ISO-8601 UTC. Stored as a string to keep the domain serialization-pure. */
  timestamp: string;
  metadata: ReliabilityEventMetadata;
}
