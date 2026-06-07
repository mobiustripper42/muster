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
}

export interface ReliabilityEvent {
  id: ReliabilityEventId;
  crewMemberId: CrewMemberId;
  type: ReliabilityEventType;
  /** ISO-8601 UTC. Stored as a string to keep the domain serialization-pure. */
  timestamp: string;
  metadata: ReliabilityEventMetadata;
}
