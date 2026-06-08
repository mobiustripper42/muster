/**
 * Crew own-standing — the plain, individual, non-comparative summary a crew
 * member sees about *themselves* (SPEC §2.6.2, §1.4, BRAND, DEC-008).
 *
 * Derives deckhand-plain reasons from the same windowed event set the score
 * reads (`windowedEvents`), so what the crew member sees and how they get ranked
 * never disagree. The voice (BRAND): "individual and neutral" — self-ratios only,
 * factual, like "answered fast · showed 8/8 · one late bail". NEVER a leaderboard,
 * a rank-vs-others, a grade, a streak, or a scolding. A "no" is never guilt-tripped.
 *
 * Pure + framework-free; `now` injected. The crew read model (`crew-view.ts`)
 * feeds it the log; the crew app renders the line.
 */

import type { ReliabilityEvent } from "../domain/reliability.js";
import type { ScoreOptions } from "../oracle/reliability-score.js";
import { windowedEvents } from "../oracle/reliability-score.js";

export interface CrewStandingView {
  /** False ⇒ cold start (no in-window history) → neutral, never a low. */
  hasHistory: boolean;
  /** The whole standing as one deckhand-plain line (reasons joined by ` · `). */
  line: string;
  /** The individual reasons, so the app can render a sheet/list if it wants. */
  reasons: string[];
}

/**
 * A response counts as "fast" when its `latencyMs` is under this. Placeholder —
 * uncalibrated until real reply-time data lands (Pass-A tuning).
 */
export const FAST_REPLY_MS = 30 * 60 * 1000; // 30 min

/**
 * A bail counts as "late" when its `latenessMs` is at least this (higher
 * `latenessMs` = later bail — see ReliabilityEventMetadata). Placeholder —
 * uncalibrated until a real bail-time producer exists.
 */
export const LATE_BAIL_MS = 24 * 60 * 60 * 1000; // within a day of call

/** Small whole numbers read better as words; larger ones stay digits. */
function count(n: number): string {
  return ["zero", "one", "two", "three", "four", "five"][n] ?? String(n);
}

/** "1 bail" → "one bail", "2 bails" → "two bails". */
function tally(n: number, singular: string, plural = `${singular}s`): string {
  return `${count(n)} ${n === 1 ? singular : plural}`;
}

/**
 * Build the crew member's own standing from their reliability log. Reasons lean
 * positive-first, then plain facts; `ask_ignored` ("missed asks") is stated as a
 * neutral fact, not a nag. Cold start reads neutral, never a low.
 */
export function summarizeStanding(
  events: readonly ReliabilityEvent[],
  now: Date,
  opts: ScoreOptions = {},
): CrewStandingView {
  const window = windowedEvents(events, now, opts);
  if (window.length === 0) {
    return { hasHistory: false, line: "New — no track record yet", reasons: [] };
  }

  let completed = 0;
  let bailed = 0;
  let lateBails = 0;
  let earlyBails = 0;
  let noShows = 0;
  let steppedUp = 0;
  let ignored = 0;
  const latencies: number[] = [];

  for (const e of window) {
    switch (e.type) {
      case "shift_completed":
        completed++;
        break;
      case "shift_bailed":
        bailed++;
        // Only qualify late/early when lateness was actually recorded — an
        // unrecorded bail stays a plain "bail", not an asserted "early bail".
        if (e.metadata.latenessMs !== undefined) {
          if (e.metadata.latenessMs >= LATE_BAIL_MS) lateBails++;
          else earlyBails++;
        }
        break;
      case "no_show":
        noShows++;
        break;
      case "escalation_accepted":
      case "at_risk_rescue":
        steppedUp++;
        break;
      case "ask_ignored":
        ignored++;
        break;
      case "ask_accepted":
      case "ask_declined":
        if (e.metadata.latencyMs !== undefined) latencies.push(e.metadata.latencyMs);
        break;
      default:
        break; // ask_sent / shift_acknowledged — no standing reason of their own
    }
  }

  const commitments = completed + bailed + noShows;
  const plainBails = bailed - lateBails - earlyBails; // lateness not recorded
  const reasons: string[] = [];

  // Positives first.
  if (latencies.length > 0) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    reasons.push(avg < FAST_REPLY_MS ? "answered fast" : "answers asks");
  }
  if (commitments > 0) reasons.push(`showed ${completed}/${commitments}`);
  if (steppedUp > 0) {
    reasons.push(steppedUp === 1 ? "stepped up once" : `stepped up ${count(steppedUp)} times`);
  }
  // Then the plain facts — factual, not a scolding.
  if (lateBails > 0) reasons.push(tally(lateBails, "late bail"));
  if (earlyBails > 0) reasons.push(tally(earlyBails, "early bail"));
  if (plainBails > 0) reasons.push(tally(plainBails, "bail"));
  if (noShows > 0) reasons.push(tally(noShows, "no-show"));
  if (ignored > 0) reasons.push(`missed ${tally(ignored, "ask")}`);

  // History exists but nothing notable yet (e.g. only acknowledgments / sent asks).
  if (reasons.length === 0) {
    return { hasHistory: true, line: "Still building a track record", reasons: [] };
  }
  return { hasHistory: true, line: reasons.join(" · "), reasons };
}
