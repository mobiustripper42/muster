/**
 * Crew own-standing — the plain, individual, non-comparative summary
 * (§2.6.2, §1.4, BRAND, DEC-008). Tests assert the deckhand voice and that the
 * reasons track the logged events on the same window as the score.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type {
  ReliabilityEvent,
  ReliabilityEventMetadata,
  ReliabilityEventType,
} from "../domain/reliability.js";
import { WINDOW_EVENTS } from "../oracle/reliability-score.js";
import { FAST_REPLY_MS, LATE_BAIL_MS, summarizeStanding } from "./standing.js";

const NOW = new Date("2026-07-01T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

let seq = 0;
function evt(
  type: ReliabilityEventType,
  metadata: ReliabilityEventMetadata = {},
  timestamp = daysAgo(1),
): ReliabilityEvent {
  return {
    id: asId<"ReliabilityEventId">(`evt-${seq++}`),
    crewMemberId: asId<"CrewMemberId">("crew-me"),
    type,
    timestamp,
    metadata,
  };
}

const lineOf = (events: ReliabilityEvent[]) => summarizeStanding(events, NOW).line;

describe("summarizeStanding — cold start", () => {
  it("no history reads neutral, never a low", () => {
    expect(summarizeStanding([], NOW)).toEqual({
      hasHistory: false,
      line: "New — no track record yet",
      reasons: [],
    });
  });
});

describe("summarizeStanding — the reasons", () => {
  it("showed N/M counts completions over commitments", () => {
    const r = summarizeStanding(
      [
        evt("shift_completed"),
        evt("shift_completed"),
        evt("shift_completed"),
        evt("no_show"),
      ],
      NOW,
    );
    expect(r.reasons).toContain("showed 3/4");
  });

  it("answered fast when responses are quick; answers asks when slow", () => {
    const fast = summarizeStanding(
      [evt("ask_accepted", { latencyMs: FAST_REPLY_MS - 1 })],
      NOW,
    );
    expect(fast.reasons).toContain("answered fast");
    const slow = summarizeStanding(
      [evt("ask_accepted", { latencyMs: FAST_REPLY_MS * 4 })],
      NOW,
    );
    expect(slow.reasons).toContain("answers asks");
    expect(slow.reasons).not.toContain("answered fast");
  });

  it("declining is not held against standing (no negative reason)", () => {
    const r = summarizeStanding(
      [evt("ask_declined", { latencyMs: FAST_REPLY_MS - 1 })],
      NOW,
    );
    expect(r.reasons).toContain("answered fast"); // responsive, not penalized
    expect(r.line).not.toMatch(/declin/i);
  });

  it("separates late bails from early ones by latenessMs", () => {
    const r = summarizeStanding(
      [
        evt("shift_bailed", { latenessMs: LATE_BAIL_MS }),
        evt("shift_bailed", { latenessMs: 0 }),
      ],
      NOW,
    );
    expect(r.reasons).toContain("one late bail");
    expect(r.reasons).toContain("one early bail");
  });

  it("pluralizes plainly", () => {
    const r = summarizeStanding([evt("no_show"), evt("no_show")], NOW);
    expect(r.reasons).toContain("two no-shows");
  });

  it("missed asks are stated as a neutral fact", () => {
    const r = summarizeStanding([evt("ask_ignored")], NOW);
    expect(r.reasons).toContain("missed one ask");
  });

  it("stepping up (escalation / rescue) is a positive reason", () => {
    const r = summarizeStanding(
      [evt("escalation_accepted"), evt("at_risk_rescue")],
      NOW,
    );
    expect(r.reasons).toContain("stepped up two times");
  });

  it("joins reasons with a plain middot, positives first", () => {
    const r = summarizeStanding(
      [
        evt("ask_accepted", { latencyMs: FAST_REPLY_MS - 1 }),
        evt("shift_completed"),
        evt("shift_completed"),
        evt("shift_bailed", { latenessMs: LATE_BAIL_MS }),
      ],
      NOW,
    );
    expect(r.line).toBe("answered fast · showed 2/3 · one late bail");
  });

  it("history with no notable signal still reads neutral, never blank", () => {
    const r = summarizeStanding([evt("shift_acknowledged"), evt("ask_sent")], NOW);
    expect(r.hasHistory).toBe(true);
    expect(r.line).toBe("Still building a track record");
  });
});

describe("summarizeStanding — non-comparative voice (BRAND)", () => {
  it("never uses leaderboard / grade / scolding language", () => {
    const line = lineOf([
      evt("shift_completed"),
      evt("no_show"),
      evt("ask_ignored"),
      evt("shift_bailed", { latenessMs: LATE_BAIL_MS }),
    ]);
    for (const banned of [
      "rank",
      "best",
      "worst",
      "top",
      "%",
      "compared",
      "better than",
      "average",
      "grade",
      "great job",
      "streak",
    ]) {
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("summarizeStanding — same window as the score", () => {
  it("events beyond the window do not count toward the reasons", () => {
    const fresh = Array.from({ length: WINDOW_EVENTS }, () =>
      evt("shift_completed", {}, daysAgo(1)),
    );
    const ancientNoShow = evt("no_show", {}, daysAgo(400));
    const r = summarizeStanding([ancientNoShow, ...fresh], NOW);
    // The ancient no_show is pushed out → commitments are all completions.
    expect(r.reasons).toContain(`showed ${WINDOW_EVENTS}/${WINDOW_EVENTS}`);
  });
});
