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
import type { CrewMember } from "../domain/entities.js";
import {
  DEFAULT_WEIGHTS,
  WINDOW_EVENTS,
  computeReliabilityScore,
  effectiveRankScore,
  rankByReliability,
  scoreCrewMember,
} from "./reliability-score.js";
import { bailLatenessMs } from "../builder/derive.js";

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
    expect(r.windowEvents).toBe(WINDOW_EVENTS);
  });

  it("a log that nets to zero sorts at neutral, same as cold start", () => {
    // -3 bail, +2 accept, +1 decline cancel (DEC-120 weights): a real history
    // (eventCount 3) that nonetheless sits at the cold-start neutral 0 — the
    // docstring invariant.
    const r = computeReliabilityScore(
      [
        evt("shift_bailed", daysAgo(1)),
        evt("ask_accepted", daysAgo(2)),
        evt("ask_declined", daysAgo(3)),
      ],
      NOW,
    );
    expect(r.score).toBe(0);
    expect(r.eventCount).toBe(3);
  });
});

describe("computeReliabilityScore — the load-bearing distinctions", () => {
  it("decline is rewarded a little — answering 'no' lifts the score (DEC-120)", () => {
    // Reverses the old decline-neutral rule: Out is now +1 (responsiveness), so
    // two declines net +2 — still far below a completed shift, but not free.
    const declined = scoreOf([
      evt("ask_declined", daysAgo(1)),
      evt("ask_declined", daysAgo(2)),
    ]);
    expect(declined).toBe(2 * DEFAULT_WEIGHTS.perEvent.ask_declined);
    // In (+2) still beats Out (+1) beats silence (-3).
    expect(scoreOf([evt("ask_accepted", daysAgo(1))])).toBeGreaterThan(
      scoreOf([evt("ask_declined", daysAgo(1))]),
    );
    expect(scoreOf([evt("ask_declined", daysAgo(1))])).toBeGreaterThan(
      scoreOf([evt("ask_ignored", daysAgo(1))]),
    );
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

  it("a zero-notice bail stays ABOVE the no_show floor at the DEFAULT horizon (DEC-120)", () => {
    // The floor invariant that matters — composed against the REAL `bailLatenessMs`
    // at the shipped 7-day (168h) horizon, not a hardcoded stand-in. A prior draft
    // calibrated the ramp for 48h and silently drove this below no_show (-89 at 7d);
    // this test is the guard that would have caught it.
    const maxLateness = bailLatenessMs(NOW, NOW); // zero notice → full horizon window
    const worstBail = scoreOf([
      evt("shift_bailed", daysAgo(1), { latenessMs: maxLateness }),
    ]);
    expect(worstBail).toBeGreaterThan(DEFAULT_WEIGHTS.perEvent.no_show); // above -15
    expect(worstBail).toBeLessThan(DEFAULT_WEIGHTS.perEvent.shift_bailed); // worse than full-notice -3
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

describe("computeReliabilityScore — count-based rolling window", () => {
  it("only the most recent WINDOW_EVENTS events count", () => {
    // WINDOW_EVENTS good shifts (recent) + one ancient bad event that should
    // be pushed out of the window by the newer ones.
    const recent = Array.from({ length: WINDOW_EVENTS }, (_, i) =>
      evt("shift_completed", daysAgo(i + 1)),
    );
    const ancientNoShow = evt("no_show", daysAgo(400));
    const r = computeReliabilityScore([ancientNoShow, ...recent], NOW);
    expect(r.eventCount).toBe(WINDOW_EVENTS);
    // The ancient no_show fell out of the window — score is all positives.
    expect(r.score).toBe(WINDOW_EVENTS * DEFAULT_WEIGHTS.perEvent.shift_completed);
  });

  it("SEASONAL: a months-long off-season gap does NOT drop history", () => {
    // The whole reason for a count window. Last season ended ~8 months ago; the
    // new season is a few days old. A calendar window would have wiped the
    // veteran's record — a count window carries it across the winter.
    const lastSeason = Array.from({ length: 10 }, (_, i) =>
      evt("shift_completed", daysAgo(240 + i)),
    );
    const thisSeason = [evt("ask_accepted", daysAgo(2))];
    const r = computeReliabilityScore([...lastSeason, ...thisSeason], NOW);
    expect(r.eventCount).toBe(11);
    expect(r.score).toBeGreaterThan(0); // veteran still ranks above a rookie
  });

  it("a smaller window keeps only the newest events", () => {
    const events = [
      evt("shift_completed", daysAgo(1)), // newest, kept at window 1
      evt("no_show", daysAgo(2)), // older, excluded at window 1
    ];
    expect(
      computeReliabilityScore(events, NOW, { windowEvents: 1 }).score,
    ).toBe(DEFAULT_WEIGHTS.perEvent.shift_completed);
    expect(
      computeReliabilityScore(events, NOW, { windowEvents: 1 }).eventCount,
    ).toBe(1);
  });

  it("future-dated events are ignored defensively (don't consume a slot)", () => {
    const future = new Date(NOW.getTime() + hours(1)).toISOString();
    const r = computeReliabilityScore(
      [evt("shift_completed", future), evt("ask_accepted", daysAgo(1))],
      NOW,
      { windowEvents: 1 },
    );
    expect(r.eventCount).toBe(1);
    expect(r.score).toBe(DEFAULT_WEIGHTS.perEvent.ask_accepted);
  });

  it("malformed timestamps are dropped, not counted", () => {
    const r = computeReliabilityScore(
      [evt("shift_completed", "not-a-date")],
      NOW,
    );
    expect(r.score).toBe(0);
    expect(r.eventCount).toBe(0);
  });

  it("an event timestamped exactly now still counts", () => {
    expect(scoreOf([evt("shift_completed", NOW.toISOString())])).toBeGreaterThan(
      0,
    );
  });

  it("eventCount reflects only the scored (in-window) events", () => {
    const r = computeReliabilityScore(
      [evt("shift_completed", daysAgo(1)), evt("ask_accepted", daysAgo(2))],
      NOW,
      { windowEvents: 1 },
    );
    expect(r.eventCount).toBe(1);
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
    const events = [evt("shift_bailed", daysAgo(1), { latenessMs: hours(10) })];
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

describe("effectiveRankScore — Spink's manual thumb (§2.4)", () => {
  const thumb = (over: Partial<CrewMember>) => over as CrewMember;

  it("is the raw score when no boost/floor is set", () => {
    expect(effectiveRankScore(7, thumb({}))).toBe(7);
  });

  it("boost adds on top of the score", () => {
    expect(effectiveRankScore(7, thumb({ manualBoost: 5 }))).toBe(12);
    expect(effectiveRankScore(-3, thumb({ manualBoost: 5 }))).toBe(2);
  });

  it("floor raises a low score but never lowers a high one", () => {
    expect(effectiveRankScore(-10, thumb({ manualFloor: 0 }))).toBe(0);
    expect(effectiveRankScore(8, thumb({ manualFloor: 0 }))).toBe(8);
  });

  it("a negative floor is a floor, not a clamp (no-op above it)", () => {
    expect(effectiveRankScore(5, thumb({ manualFloor: -5 }))).toBe(5);
    expect(effectiveRankScore(-9, thumb({ manualFloor: -5 }))).toBe(-5);
  });

  it("floor then boost: a vouched-for cold-start beats an unknown", () => {
    // Spink floors a known-good new hire to neutral and bumps them.
    const vouchedNewHire = effectiveRankScore(0, thumb({ manualFloor: 0, manualBoost: 3 }));
    const unknown = effectiveRankScore(0, thumb({}));
    expect(vouchedNewHire).toBeGreaterThan(unknown);
  });
});

describe("rankByReliability — the ask-order authority", () => {
  let repo: InMemoryRepository;
  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  const crew = (id: string, over: Partial<CrewMember> = {}): CrewMember => ({
    id: asId<"CrewMemberId">(id),
    name: id,
    phone: "555",
    ratings: [],
    status: "active",
    reliabilityScore: null,
    ...over,
  });

  async function log(id: string, ...events: ReliabilityEvent[]) {
    for (const e of events) {
      await repo.logReliabilityEvent({ ...e, crewMemberId: asId<"CrewMemberId">(id) });
    }
  }

  it("orders by real logged reliability, best first", async () => {
    await log("dependable", evt("shift_completed", daysAgo(1)), evt("shift_completed", daysAgo(3)));
    await log("flaky", evt("no_show", daysAgo(2)));
    // "fresh" has no events → cold-start neutral 0, between the two.
    const ranked = await rankByReliability(
      repo,
      [crew("flaky"), crew("fresh"), crew("dependable")],
      NOW,
    );
    expect(ranked.map((c) => c.id)).toEqual(["dependable", "fresh", "flaky"]);
  });

  it("cold-start crew tie-break is deterministic by id", async () => {
    const ranked = await rankByReliability(
      repo,
      [crew("zeb"), crew("amy"), crew("mol")],
      NOW,
    );
    expect(ranked.map((c) => c.id)).toEqual(["amy", "mol", "zeb"]);
  });

  it("manualFloor lifts a flaky veteran back into contention", async () => {
    await log("flaky", evt("no_show", daysAgo(1)));
    const withoutFloor = await rankByReliability(repo, [crew("flaky"), crew("fresh")], NOW);
    expect(withoutFloor.map((c) => c.id)).toEqual(["fresh", "flaky"]);

    const withFloor = await rankByReliability(
      repo,
      [crew("flaky", { manualFloor: 0 }), crew("fresh")],
      NOW,
    );
    // Floor raises flaky to neutral 0; id tie-break ("flaky" < "fresh") then wins.
    expect(withFloor.map((c) => c.id)).toEqual(["flaky", "fresh"]);
  });

  it("manualBoost can push a known-good crew member to the top", async () => {
    await log("star", evt("shift_completed", daysAgo(1)));
    const ranked = await rankByReliability(
      repo,
      [crew("star"), crew("boosted", { manualBoost: 100 })],
      NOW,
    );
    expect(ranked[0]!.id).toBe("boosted");
  });
});
