/**
 * Pay periods (#347) — locks the biweekly dates to the sibling xola-tip-extractor's
 * anchor (2026-01-05) so the two tools never diverge. The operator named these
 * boundaries ("5/25–6/7, 6/8–6/21"); pin them.
 */

import { describe, expect, it } from "vitest";
import { currentPeriod, periodsForYear, periodLabel } from "./pay-periods.js";

const ANCHOR = "2026-01-05";

describe("currentPeriod", () => {
  it("puts 2026-07-10 in the Jul 6 – Jul 19 period", () => {
    expect(currentPeriod(ANCHOR, "2026-07-10")).toEqual({ start: "2026-07-06", end: "2026-07-19" });
  });
  it("names the anchor day itself as a period start", () => {
    expect(currentPeriod(ANCHOR, "2026-01-05")).toEqual({ start: "2026-01-05", end: "2026-01-18" });
  });
  it("the last day of a period still resolves to that period", () => {
    expect(currentPeriod(ANCHOR, "2026-07-19")).toEqual({ start: "2026-07-06", end: "2026-07-19" });
    expect(currentPeriod(ANCHOR, "2026-07-20")).toEqual({ start: "2026-07-20", end: "2026-08-02" });
  });
});

describe("periodsForYear", () => {
  it("contains the operator's cited boundaries (5/25–6/7, 6/8–6/21)", () => {
    const labels = periodsForYear(ANCHOR, 2026).map(periodLabel);
    expect(labels).toContain("May 25 – Jun 7");
    expect(labels).toContain("Jun 8 – Jun 21");
    expect(labels).toContain("Jul 6 – Jul 19");
  });
  it("walks a clean 14-day cadence with no gaps or overlaps", () => {
    const ps = periodsForYear(ANCHOR, 2026);
    for (let i = 1; i < ps.length; i++) {
      const prevEnd = new Date(ps[i - 1]!.end + "T00:00:00Z").getTime();
      const thisStart = new Date(ps[i]!.start + "T00:00:00Z").getTime();
      expect(thisStart - prevEnd).toBe(86_400_000); // next starts the day after prev ends
    }
  });
});
