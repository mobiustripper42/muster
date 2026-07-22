/**
 * Day·Grid calendar helpers (#464, 12.11) — pure geometry + derived offering colour.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRIP_MINUTES,
  GRID_SPAN_MIN,
  OFFERING_COLOR_COUNT,
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
