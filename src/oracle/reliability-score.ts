/**
 * The reliability scorer (SPEC §1.4, DEC-008, Phase 2.1).
 *
 * Turns a crew member's append-only `ReliabilityEvent` log into one blended
 * number — a *ranking signal*, not a gate or a grade. The score only ever
 * orders the eligible pool (`rankByReliability`, §2.4); it never decides
 * eligibility. The score is derived live from the log, NOT read from the
 * `CrewMember.reliabilityScore` field (that field is display-only — DEC-008).
 *
 * The shape v1 commits to (deliberately dumb — DEC-008 'flat v1'):
 *  - **Neutral baseline 0.** A crew member with no history scores 0 = mid-pool,
 *    never a misleading low — so a cold-start crew and a netted-to-zero log sort
 *    together at neutral, never below a real low.
 *  - **Additive.** Each in-window event contributes a flat weight; the score is
 *    the sum. No normalization, no curve — that's the Pass-A tuning payoff and
 *    it waits on weeks of real logged data we don't have yet. (Sum means a long
 *    good history outscores a short one; a volume-neutral / weighted variant so
 *    rookies aren't dumped to the bottom is parked in FUTURE_IDEAS.)
 *  - **Count-based rolling window (NOT calendar).** Only the most recent
 *    `WINDOW_EVENTS` events count. This is the seasonal-fleet fix: a calendar
 *    window would drop an entire off-season of history, so every returning
 *    veteran would reset to neutral each spring — flat ranking exactly when
 *    you're rebuilding the crew. A count window carries history across the gap
 *    (the off-season simply has no events to consume the count).
 *  - **Decline-neutral.** `ask_declined` weighs 0. Saying "no" is information,
 *    not a sin. The only ask-level penalty is `ask_ignored` (never answered).
 *  - **Bail lateness is the signal.** `shift_bailed` carries a fixed penalty
 *    plus a lateness-scaled penalty from `metadata.latenessMs`, so a late bail
 *    weighs more than an early one. `no_show` is the worst case, flat. (Lateness
 *    scales linearly in v1; a steeper near-call ramp — inverse-exponential — is
 *    parked in FUTURE_IDEAS.)
 *
 * All weights and the window size are tunable constants overridable per call —
 * the tuning lever for when real data arrives. The function is pure and
 * framework-free; `now` is injected like everywhere else in the core.
 */

import type {
  ReliabilityEvent,
  ReliabilityEventType,
} from "../domain/reliability.js";
import type { CrewMember } from "../domain/entities.js";
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

/**
 * Rolling-window size in **events** (not days). The score reads only the most
 * recent this-many events. Count-based so a seasonal off-season gap can't wipe
 * a returning crew member's history. Placeholder magnitude — roughly a season's
 * worth — until real per-crew event volumes are known; tune in Pass A.
 */
export const WINDOW_EVENTS = 40;

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
 *  - `nudged` / `pool_widened` / `board_landed` are 0 — engine *actions*, not
 *    crew behavior (being nudged isn't something you did); they feed the At-Risk
 *    trail and the board's ping memory, not the score (DEC-024/026). The reward
 *    for *taking* a nudge is `escalation_accepted`.
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
    nudged: 0,
    pool_widened: 0,
    board_landed: 0,
  },
  bailLatenessPerHour: -0.5,
};

export interface ScoreOptions {
  readonly weights?: ReliabilityWeights;
  /** Override the count-based window (most recent N events). */
  readonly windowEvents?: number;
}

export interface ReliabilityScore {
  /** Blended ranking signal. 0 = neutral/mid-pool (incl. cold start). */
  readonly score: number;
  /** Events that fell inside the window and were scored. 0 ⇒ cold start. */
  readonly eventCount: number;
  /** Window cap actually applied (events) — echoed so callers can explain it. */
  readonly windowEvents: number;
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
 * The most recent `windowEvents` well-formed, non-future events, newest first.
 * Count-based (not calendar) so an off-season gap can't silently drop a returning
 * crew member's whole history. The single window definition — both the score and
 * the crew-facing standing read the same set, so they never disagree.
 */
/** The window cap actually applied, clamped non-negative. One definition. */
export function resolveWindowCap(opts: ScoreOptions = {}): number {
  return Math.max(0, opts.windowEvents ?? WINDOW_EVENTS);
}

export function windowedEvents(
  events: readonly ReliabilityEvent[],
  now: Date,
  opts: ScoreOptions = {},
): ReliabilityEvent[] {
  const windowEvents = resolveWindowCap(opts);
  const nowMs = now.getTime();
  return events
    .map((event) => ({ event, t: new Date(event.timestamp).getTime() }))
    .filter(({ t }) => !Number.isNaN(t) && t <= nowMs)
    .sort((a, b) => b.t - a.t)
    .slice(0, windowEvents)
    .map((x) => x.event);
}

/**
 * Blended reliability score from a crew member's event log. Pure: same events +
 * same `now` ⇒ same number. Scores the most recent `windowEvents` well-formed,
 * non-future events; an empty log scores a neutral 0 — never a misleading low.
 */
export function computeReliabilityScore(
  events: readonly ReliabilityEvent[],
  now: Date,
  opts: ScoreOptions = {},
): ReliabilityScore {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const inWindow = windowedEvents(events, now, opts);
  let score = 0;
  for (const event of inWindow) score += contributionOf(event, weights);
  return { score, eventCount: inWindow.length, windowEvents: resolveWindowCap(opts) };
}

/**
 * Read one crew member's log through the port and score it. The thin bridge
 * between the append-only log and the ranker — `now` injected, no clock read.
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

/**
 * The effective ranking key: the computed reliability score with Spink's manual
 * thumb applied (§2.4). `manualFloor` raises a person to at least that value
 * (his "I vouch for this one" — lifts a known-good new hire above unknowns who
 * read a cold-start neutral 0); `manualBoost` adds on top. Pure.
 */
export function effectiveRankScore(
  score: number,
  crew: Pick<CrewMember, "manualBoost" | "manualFloor">,
): number {
  const floored =
    crew.manualFloor !== undefined ? Math.max(score, crew.manualFloor) : score;
  return floored + (crew.manualBoost ?? 0);
}

/**
 * Rank a set of eligible crew by reliability — the single ordering authority for
 * the ask sequence (§1.4, §2.4). Scores each member from their log, applies the
 * manual thumb (`effectiveRankScore`), and sorts best-first with a deterministic
 * id tie-break so the loop and its tests are stable. Ordering only — eligibility
 * is decided upstream by the oracle; this never gates anyone.
 */
export async function rankByReliability(
  repo: Repository,
  crew: readonly CrewMember[],
  now: Date,
  opts: ScoreOptions = {},
): Promise<CrewMember[]> {
  const keyed = await Promise.all(
    crew.map(async (c) => {
      const { score } = await scoreCrewMember(repo, c.id, now, opts);
      return { crew: c, key: effectiveRankScore(score, c) };
    }),
  );
  keyed.sort((a, b) => {
    if (a.key !== b.key) return b.key - a.key;
    return a.crew.id < b.crew.id ? -1 : a.crew.id > b.crew.id ? 1 : 0;
  });
  return keyed.map((k) => k.crew);
}

/**
 * Convenience for the common consumer shape: hydrate crew ids through the port
 * (dropping any that vanished) and rank them. The one place the fetch-and-rank
 * fan-out lives, so all callers share it. Each crew member's log is read once.
 */
export async function rankEligibleIds(
  repo: Repository,
  ids: readonly CrewMemberId[],
  now: Date,
  opts: ScoreOptions = {},
): Promise<CrewMember[]> {
  const crew = (
    await Promise.all(ids.map((id) => repo.getCrewMember(id)))
  ).filter((c): c is CrewMember => c !== null);
  return rankByReliability(repo, crew, now, opts);
}
