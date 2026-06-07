/**
 * The reliability scorer (SPEC §1.4, DEC-008, Phase 2.1).
 *
 * Turns a crew member's append-only `ReliabilityEvent` log into one blended
 * number — a *ranking signal*, not a gate or a grade. The score only ever
 * orders the eligible pool (`rankPool`, 1.4b); it never decides eligibility.
 *
 * The shape v1 commits to (deliberately dumb — DEC-008 'flat v1'):
 *  - **Neutral baseline 0.** A crew member with no in-window history scores 0 =
 *    mid-pool, never a misleading low. (`rankPool` already reads
 *    `reliabilityScore ?? 0`, so a cold-start `null` and a netted-to-zero log
 *    sort together at neutral.)
 *  - **Additive.** Each in-window event contributes a flat weight; the score is
 *    the sum. No normalization, no curve — that's the Pass-A tuning payoff and
 *    it waits on weeks of real logged data we don't have yet.
 *  - **Rolling window.** Only events within `WINDOW_DAYS` of `now` count. A hard
 *    cutoff, not exponential decay — the "flat" reading of "rolling window".
 *  - **Decline-neutral.** `ask_declined` weighs 0. Saying "no" is information,
 *    not a sin. The only ask-level penalty is `ask_ignored` (timed out, never
 *    answered).
 *  - **Bail lateness is the signal.** `shift_bailed` carries a fixed penalty
 *    plus a lateness-scaled penalty from `metadata.latenessMs`, so a late bail
 *    weighs more than an early one. `no_show` is the worst case, flat.
 *
 * All weights are tunable constants (`DEFAULT_WEIGHTS`) overridable per call —
 * the tuning lever for when real data arrives. The function is pure and
 * framework-free; `now` is injected like everywhere else in the core.
 */

import type {
  ReliabilityEvent,
  ReliabilityEventType,
} from "../domain/reliability.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/** Flat per-event weights (DEC-008 'flat v1'). Positive lifts, negative sinks. */
export interface ReliabilityWeights {
  /** Flat weight per event type. Bail/no-show lateness handled separately. */
  readonly perEvent: Readonly<Record<ReliabilityEventType, number>>;
  /**
   * Extra penalty per hour of bail lateness (`metadata.latenessMs`), on top of
   * `perEvent.shift_bailed`. Higher `latenessMs` ⇒ later bail ⇒ bigger penalty.
   * Bails with no lateness recorded take only the flat `shift_bailed` weight.
   */
  readonly bailLatenessPerHour: number;
}

/** Rolling-window length in days. Events older than this don't count. */
export const WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Flat v1 weights. Magnitudes are deliberately round and relative, not
 * calibrated — the point is the *ordering* they produce, not the absolute number.
 * Rationale per arm:
 *  - `shift_completed` is the load-bearing positive: showed up, ran the trip.
 *  - `ask_accepted` / `shift_acknowledged` are small willingness signals.
 *  - `ask_declined` / `ask_sent` are 0 — neutral by design (decline-neutral).
 *  - `ask_ignored` is the lone ask penalty; `shift_bailed` and `no_show` are the
 *    commitment penalties, with `no_show` the floor (confirmed, then vanished).
 *  - `escalation_accepted` / `at_risk_rescue` reward stepping up when it counts.
 *  - `hold_released` is Pass D — never emitted in v1, weighted 0.
 */
export const DEFAULT_WEIGHTS: ReliabilityWeights = {
  perEvent: {
    ask_sent: 0,
    ask_accepted: 1,
    ask_declined: 0,
    ask_ignored: -3,
    shift_completed: 5,
    shift_bailed: -5,
    no_show: -15,
    escalation_accepted: 4,
    at_risk_rescue: 6,
    shift_acknowledged: 1,
  },
  bailLatenessPerHour: -0.5,
};

export interface ScoreOptions {
  readonly weights?: ReliabilityWeights;
  readonly windowDays?: number;
}

export interface ReliabilityScore {
  /** Blended ranking signal. 0 = neutral/mid-pool (incl. cold start). */
  readonly score: number;
  /** Events that fell inside the window and were scored. 0 ⇒ cold start. */
  readonly eventCount: number;
  /** Window actually used (days) — echoed so callers can explain the score. */
  readonly windowDays: number;
}

/** Contribution of one in-window event under the given weights. */
function contributionOf(
  event: ReliabilityEvent,
  weights: ReliabilityWeights,
): number {
  const flat = weights.perEvent[event.type] ?? 0;
  if (event.type !== "shift_bailed") return flat;
  // Bail: flat penalty + lateness-scaled penalty. Higher latenessMs = later.
  const latenessMs = event.metadata.latenessMs;
  if (latenessMs === undefined || latenessMs <= 0) return flat;
  return flat + (latenessMs / MS_PER_HOUR) * weights.bailLatenessPerHour;
}

/**
 * Blended reliability score from a crew member's event log. Pure: same events +
 * same `now` ⇒ same number. Events outside the rolling window are ignored; an
 * empty (or all-stale) log scores a neutral 0 — never a misleading low.
 */
export function computeReliabilityScore(
  events: readonly ReliabilityEvent[],
  now: Date,
  opts: ScoreOptions = {},
): ReliabilityScore {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const cutoffMs = now.getTime() - windowDays * MS_PER_DAY;

  let score = 0;
  let eventCount = 0;
  for (const event of events) {
    const t = new Date(event.timestamp).getTime();
    // Inside the window: [now - windowDays, now]. Drop stale and (defensively)
    // future-dated events.
    if (Number.isNaN(t) || t < cutoffMs || t > now.getTime()) continue;
    score += contributionOf(event, weights);
    eventCount += 1;
  }
  return { score, eventCount, windowDays };
}

/**
 * Read one crew member's log through the port and score it. The thin bridge
 * between the append-only log and `rankPool` — `now` injected, no clock read.
 */
export async function scoreCrewMember(
  repo: Repository,
  crewMemberId: CrewMemberId,
  now: Date,
  opts: ScoreOptions = {},
): Promise<ReliabilityScore> {
  const events = await repo.reliabilityEventsFor(crewMemberId);
  return computeReliabilityScore(events, now, opts);
}
