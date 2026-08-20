/**
 * Day·Grid calendar helpers (#464, 12.11) — pure geometry + derived offering colour.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRIP_MINUTES,
  GRID_SPAN_MIN,
  OFFERING_COLOR_COUNT,
  assignLanes,
  gridPosition,
  offeringColorClass,
  offeringColorIndex,
  offeringDotClass,
  offeringOpenClass,
  parseHhmmToMinutes,
} from "./calendar-grid.js";

describe("parseHhmmToMinutes", () => {
  it("parses HH:MM to minutes since midnight", () => {
    expect(parseHhmmToMinutes("08:00")).toBe(480);
    expect(parseHhmmToMinutes("11:30")).toBe(690);
    expect(parseHhmmToMinutes("21:30")).toBe(1290);
  });
  it("returns NaN for a malformed clock", () => {
    expect(parseHhmmToMinutes("nope")).toBeNaN();
  });
});

describe("gridPosition", () => {
  it("spans 8:00–21:30 = 810 min", () => {
    expect(GRID_SPAN_MIN).toBe(810);
  });

  // Sanity anchors lifted straight from the mockup comment.
  it("places 11:30 at ~25.9% top", () => {
    expect(gridPosition("11:30", 100).topPct).toBeCloseTo(25.9, 1);
  });
  it("sizes a 100-min trip at ~12.3% height", () => {
    expect(gridPosition("11:30", 100).heightPct).toBeCloseTo(12.3, 1);
  });
  it("sizes a 90-min trip at ~11.1% and a 150-min at ~18.5%", () => {
    expect(gridPosition("08:00", 90).heightPct).toBeCloseTo(11.1, 1);
    expect(gridPosition("08:30", 150).heightPct).toBeCloseTo(18.5, 1);
  });
  it("puts 8:00 at the very top (0%)", () => {
    expect(gridPosition("08:00", DEFAULT_TRIP_MINUTES).topPct).toBe(0);
  });
});

describe("offering colour (derived, #495)", () => {
  const ids = ["offering-reservation-demo", "offering-a", "offering-b", "xyz", ""];

  it("indexes into the fixed palette range (1…N)", () => {
    for (const id of ids) {
      const i = offeringColorIndex(id);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(OFFERING_COLOR_COUNT);
    }
  });

  it("is stable — same id, same class, every call", () => {
    for (const id of ids) {
      expect(offeringColorClass(id)).toBe(offeringColorClass(id));
      expect(offeringDotClass(id)).toBe(offeringDotClass(id));
    }
  });

  it("returns a class from the vessel-token palette", () => {
    expect(offeringColorClass("offering-reservation-demo")).toMatch(
      /^border-vessel-[1-6]\/45 bg-vessel-[1-6]\/15$/,
    );
    expect(offeringDotClass("offering-reservation-demo")).toMatch(/^bg-vessel-[1-6]$/);
    expect(offeringOpenClass("offering-reservation-demo")).toMatch(/^border-vessel-[1-6]\/40$/);
  });
});

/**
 * Lane assignment (#702) — several offerings can schedule ONE boat at ONE time, and the grid drew
 * them at identical coordinates: text over text, in the seeded fixture three deep.
 *
 * The rule these pin: overlap is an **interval** question, not an equal-start-time one. Two
 * offerings at 13:30 collide, and so does a 14:00 that begins inside the 13:30's trip — a check
 * keyed on `time === time` finds the first and misses the second, while looking like it works.
 */
describe("assignLanes (#702)", () => {
  const at = (time: string, durationMin: number) => ({ time, durationMin });

  it("leaves a lone slot full width", () => {
    expect(assignLanes([at("13:30", 100)])).toEqual([{ lane: 0, laneCount: 1 }]);
  });

  it("splits two slots at the same time", () => {
    expect(assignLanes([at("13:30", 100), at("13:30", 100)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
    ]);
  });

  it("splits the reported three-deep case", () => {
    // Brew 3 in the `db:seed:concurrent` fixture: three live offerings, one departure time.
    expect(assignLanes([at("13:30", 100), at("13:30", 100), at("13:30", 100)])).toEqual([
      { lane: 0, laneCount: 3 },
      { lane: 1, laneCount: 3 },
      { lane: 2, laneCount: 3 },
    ]);
  });

  it("splits a PARTIAL overlap — a departure starting inside another trip", () => {
    // 13:30 + 100min runs to 15:10, so a 14:00 departure collides with it. This is the case an
    // equal-start-time check cannot see.
    expect(assignLanes([at("13:30", 100), at("14:00", 60)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
    ]);
  });

  it("leaves slots that merely touch alone — an end is not an overlap", () => {
    // 13:30 + 60min ends exactly at 14:30. Half-open intervals: the next departure may reuse the
    // full width. Getting this wrong halves every card on a back-to-back schedule.
    expect(assignLanes([at("13:30", 60), at("14:30", 60)])).toEqual([
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
    ]);
  });

  it("reuses a freed lane, and sizes the whole cluster to its widest point", () => {
    // A 13:30–14:30 (lane 0), B 13:30–15:30 (lane 1), C 14:45–15:45 overlaps only B, so it takes
    // the lane A vacated. All three share laneCount 2 — one cluster, one width, so the columns
    // line up instead of C jumping to full width mid-cluster.
    expect(assignLanes([at("13:30", 60), at("13:30", 120), at("14:45", 60)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
      { lane: 0, laneCount: 2 },
    ]);
  });

  it("separates clusters — a later, unrelated slot is full width again", () => {
    expect(assignLanes([at("13:30", 60), at("13:30", 60), at("17:30", 60)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
      { lane: 0, laneCount: 1 },
    ]);
  });

  it("does not depend on input order", () => {
    // The view hands over whatever order the slots arrive in. Same set, same geometry — otherwise
    // a card moves lane when an unrelated slot is added earlier in the day.
    const forward = assignLanes([at("13:30", 100), at("14:00", 60), at("17:30", 60)]);
    const shuffled = assignLanes([at("17:30", 60), at("14:00", 60), at("13:30", 100)]);
    expect(shuffled[2]).toEqual(forward[0]);
    expect(shuffled[1]).toEqual(forward[1]);
    expect(shuffled[0]).toEqual(forward[2]);
  });

  it("survives a malformed clock instead of collapsing the column", () => {
    // `parseHhmmToMinutes` returns NaN, and NaN comparisons are all false — left unhandled that
    // silently drops the slot into lane 0 alongside a real one, drawing the overlap this exists
    // to prevent. It gets its own lane.
    const out = assignLanes([at("13:30", 100), at("nope", 100)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ lane: 0, laneCount: 1 });
    expect(out[1]!.laneCount).toBe(1);
  });

  it("returns nothing for nothing", () => {
    expect(assignLanes([])).toEqual([]);
  });
});
