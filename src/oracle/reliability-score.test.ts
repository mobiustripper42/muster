/**
 * The reliability scorer — blended score from the logged event stream
 * (§1.4, DEC-008, Phase 2.1). Tests assert the *shape* of the ordering the
 * scorer must produce, not the exact tuning of the flat-v1 weights.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type {
  ReliabilityEvent,
  ReliabilityEventMetadata,
  ReliabilityEventType,
} from "../domain/reliability.js";
import {
  DEFAULT_WEIGHTS,
  WINDOW_DAYS,
  computeReliabilityScore,
  scoreCrewMember,
} from "./reliability-score.js";

const CREW = asId<"CrewMemberId">("crew-quint");
const NOW = new Date("2026-07-01T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const hours = (n: number) => n * 60 * 60 * 1000;

let seq = 0;
function evt(
  type: ReliabilityEventType,
  timestamp: string,
  metadata: ReliabilityEventMetadata = {},
): ReliabilityEvent {
  return {
    id: asId<"ReliabilityEventId">(`evt-${seq++}`),
    crewMemberId: CREW,
    type,
    timestamp,
    metadata,
  };
}

const scoreOf = (events: ReliabilityEvent[]) =>
  computeReliabilityScore(events, NOW).score;

describe("computeReliabilityScore — baselines", () => {
  it("cold start: no events reads neutral 0, not a misleading low", () => {
    const r = computeReliabilityScore([], NOW);
    expect(r.score).toBe(0);
    expect(r.eventCount).toBe(0);
    expect(r.windowDays).toBe(WINDOW_DAYS);
  });

  it("a log that nets to zero sorts at neutral, same as cold start", () => {
    // +5 completed and -5 flat bail cancel: a real history (eventCount 2) that
    // nonetheless sits at the cold-start neutral 0 — the docstring invariant.
    const r = computeReliabilityScore(
      [
        evt("shift_completed", daysAgo(1)),
        evt("shift_bailed", daysAgo(2)),
      ],
      NOW,
    );
    expect(r.score).toBe(0);
    expect(r.eventCount).toBe(2);
  });
});

describe("computeReliabilityScore — the load-bearing distinctions", () => {
  it("decline is neutral — declining does not hurt the score", () => {
    const declined = scoreOf([
      evt("ask_declined", daysAgo(1)),
      evt("ask_declined", daysAgo(2)),
    ]);
    expect(declined).toBe(0);
  });

  it("ask_ignored is penalized (the lone ask-level sin)", () => {
    expect(scoreOf([evt("ask_ignored", daysAgo(1))])).toBeLessThan(0);
  });

  it("ignoring sorts below declining the same number of asks", () => {
    const ignored = scoreOf([evt("ask_ignored", daysAgo(1))]);
    const declined = scoreOf([evt("ask_declined", daysAgo(1))]);
    expect(ignored).toBeLessThan(declined);
  });

  it("showing up (shift_completed) lifts the score", () => {
    expect(scoreOf([evt("shift_completed", daysAgo(1))])).toBeGreaterThan(0);
  });

  it("no_show is the floor — worse than a single bail", () => {
    const noShow = scoreOf([evt("no_show", daysAgo(1))]);
    const bailed = scoreOf([evt("shift_bailed", daysAgo(1))]);
    expect(noShow).toBeLessThan(bailed);
  });

  it("bonuses (escalation, rescue) lift the score", () => {
    expect(scoreOf([evt("escalation_accepted", daysAgo(1))])).toBeGreaterThan(0);
    expect(scoreOf([evt("at_risk_rescue", daysAgo(1))])).toBeGreaterThan(0);
  });
});

describe("computeReliabilityScore — bail lateness is the signal", () => {
  it("a late bail weighs more than an early one", () => {
    const lateBail = scoreOf([
      evt("shift_bailed", daysAgo(1), { latenessMs: hours(48) }),
    ]);
    const earlyBail = scoreOf([
      evt("shift_bailed", daysAgo(1), { latenessMs: hours(1) }),
    ]);
    expect(lateBail).toBeLessThan(earlyBail);
  });

  it("a bail with no lateness recorded takes only the flat penalty", () => {
    const flat = scoreOf([evt("shift_bailed", daysAgo(1))]);
    expect(flat).toBe(DEFAULT_WEIGHTS.perEvent.shift_bailed);
  });

  it("non-positive lateness does not turn the penalty into a reward", () => {
    const zero = scoreOf([evt("shift_bailed", daysAgo(1), { latenessMs: 0 })]);
    const negative = scoreOf([
      evt("shift_bailed", daysAgo(1), { latenessMs: -hours(5) }),
    ]);
    expect(zero).toBe(DEFAULT_WEIGHTS.perEvent.shift_bailed);
    expect(negative).toBe(DEFAULT_WEIGHTS.perEvent.shift_bailed);
  });
});

describe("computeReliabilityScore — rolling window", () => {
  it("events older than the window do not count", () => {
    const stale = scoreOf([evt("shift_completed", daysAgo(WINDOW_DAYS + 10))]);
    expect(stale).toBe(0);
  });

  it("events inside the window do count", () => {
    const fresh = scoreOf([evt("shift_completed", daysAgo(WINDOW_DAYS - 1))]);
    expect(fresh).toBeGreaterThan(0);
  });

  it("future-dated events are ignored defensively", () => {
    const future = new Date(NOW.getTime() + hours(1)).toISOString();
    expect(scoreOf([evt("shift_completed", future)])).toBe(0);
  });

  it("malformed timestamps are dropped, not counted", () => {
    const r = computeReliabilityScore(
      [evt("shift_completed", "not-a-date")],
      NOW,
    );
    expect(r.score).toBe(0);
    expect(r.eventCount).toBe(0);
  });

  it("the inclusive edges count: exactly now and exactly the cutoff", () => {
    const atNow = scoreOf([evt("shift_completed", NOW.toISOString())]);
    const atCutoff = scoreOf([evt("shift_completed", daysAgo(WINDOW_DAYS))]);
    expect(atNow).toBeGreaterThan(0);
    expect(atCutoff).toBeGreaterThan(0);
  });

  it("a custom window narrows what counts", () => {
    const events = [evt("shift_completed", daysAgo(30))];
    expect(computeReliabilityScore(events, NOW, { windowDays: 7 }).score).toBe(0);
    expect(
      computeReliabilityScore(events, NOW, { windowDays: 60 }).score,
    ).toBeGreaterThan(0);
  });

  it("eventCount reflects only in-window events", () => {
    const r = computeReliabilityScore(
      [
        evt("shift_completed", daysAgo(1)),
        evt("ask_accepted", daysAgo(2)),
        evt("shift_completed", daysAgo(WINDOW_DAYS + 5)), // stale
      ],
      NOW,
    );
    expect(r.eventCount).toBe(2);
  });
});

describe("computeReliabilityScore — tunable weights", () => {
  it("overriding weights changes the score (the Pass-A tuning lever)", () => {
    const events = [evt("shift_completed", daysAgo(1))];
    const harsh = computeReliabilityScore(events, NOW, {
      weights: {
        ...DEFAULT_WEIGHTS,
        perEvent: { ...DEFAULT_WEIGHTS.perEvent, shift_completed: 100 },
      },
    });
    expect(harsh.score).toBe(100);
  });

  it("the bail-lateness multiplier is tunable independently", () => {
    const events = [
      evt("shift_bailed", daysAgo(1), { latenessMs: hours(10) }),
    ];
    const gentle = computeReliabilityScore(events, NOW, {
      weights: { ...DEFAULT_WEIGHTS, bailLatenessPerHour: 0 },
    }).score;
    const harsh = computeReliabilityScore(events, NOW, {
      weights: { ...DEFAULT_WEIGHTS, bailLatenessPerHour: -2 },
    }).score;
    // With the multiplier off, only the flat bail penalty remains.
    expect(gentle).toBe(DEFAULT_WEIGHTS.perEvent.shift_bailed);
    expect(harsh).toBeLessThan(gentle);
  });
});

describe("computeReliabilityScore — blended ordering (the point)", () => {
  it("a dependable history outranks a flaky one, which outranks cold start", () => {
    const dependable = scoreOf([
      evt("shift_completed", daysAgo(2)),
      evt("shift_completed", daysAgo(9)),
      evt("ask_accepted", daysAgo(3)),
    ]);
    const flaky = scoreOf([
      evt("ask_ignored", daysAgo(2)),
      evt("shift_bailed", daysAgo(4), { latenessMs: hours(36) }),
      evt("no_show", daysAgo(10)),
    ]);
    const coldStart = scoreOf([]);
    expect(dependable).toBeGreaterThan(coldStart);
    expect(coldStart).toBeGreaterThan(flaky);
  });
});

describe("scoreCrewMember — reads the log through the port", () => {
  let repo: InMemoryRepository;
  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  it("scores from the appended log, neutral when empty", async () => {
    const empty = await scoreCrewMember(repo, CREW, NOW);
    expect(empty.score).toBe(0);
    expect(empty.eventCount).toBe(0);

    await repo.logReliabilityEvent(evt("shift_completed", daysAgo(1)));
    await repo.logReliabilityEvent(evt("ask_accepted", daysAgo(2)));
    const scored = await scoreCrewMember(repo, CREW, NOW);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.eventCount).toBe(2);
  });
});
