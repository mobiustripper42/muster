/**
 * The one rounding rule, in one place (#758).
 *
 * Before this module the rule was spelled FOUR times in THREE shapes — `decimalHours` in
 * `payroll-reconcile.ts`, `fmtMinutes` byte-identically in two page components, and `hoursLabel`
 * in a third — and one of them had drifted. These tests exist so "every surface agrees" is a
 * checked fact rather than a claim: the copies were each correct when written, and nothing but a
 * shared, tested rule stops them diverging again.
 */
import { describe, expect, it } from "vitest";
import { compactDuration, decimalHours, hoursLabel } from "./hours-format.js";

describe("decimalHours — the payroll company's unit", () => {
  it("rounds to the nearest hundredth rather than truncating (#758)", () => {
    // 2h37m43s = 157.7166… minutes = 2.6286h. The old policy floored this to 2.62 on the
    // reasoning that under-stating beats inflating "when the number becomes a payment" — right
    // for a number you charge, backwards for one you owe.
    expect(decimalHours(157 + 43 / 60)).toBe("2.63");
  });

  it("rounds a single minute up, where flooring lost the whole cent", () => {
    // One minute is 0.01666…h. This is the first disagreement in the sweep below, and the
    // cheapest demonstration that the old rule only ever moved one way.
    expect(decimalHours(1)).toBe("0.02");
  });

  it("agrees with exact rational arithmetic across every whole-minute total", () => {
    // Hours are m/60, so the exact hundredths are round(m * 5 / 3) — integer arithmetic with no
    // representation to get wrong. No tie-breaking to argue about either: m * 5 / 3 is never
    // exactly half a hundredth for a whole minute, since that would need 10m to be odd.
    for (let m = 0; m <= 20_000; m++) {
      expect(decimalHours(m), `${m} minutes`).toBe((Math.round((m * 5) / 3) / 100).toFixed(2));
    }
  });

  it("does not lose a cent to floating point — 69 minutes is exactly 1.15h", () => {
    // The regression that made `(minutes / 60) * 100` a banned spelling: it yields
    // 114.99999999999999, which the OLD floor turned into "1.14" — an extra cent below even the
    // intended truncation, in the column Gusto pays from. Rounding has no cliff there, but the
    // case stays pinned: it is the one number that proves the arithmetic order still holds.
    expect(decimalHours(69)).toBe("1.15");
  });

  it("always emits exactly two decimals, including whole hours and zero", () => {
    expect(decimalHours(0)).toBe("0.00");
    expect(decimalHours(60)).toBe("1.00");
    expect(decimalHours(600)).toBe("10.00");
  });
});

describe("hoursLabel — the payroll table's aligned Xh Ym", () => {
  it("always carries both units, so a column of them lines up", () => {
    // `payroll-reconcile.spec.ts` asserts the literal "0h 0m" for a scheduled crew member who
    // never punched. The compact form below would render that as "0m" and break the column.
    expect(hoursLabel(0)).toBe("0h 0m");
    expect(hoursLabel(290)).toBe("4h 50m");
  });

  it("rounds to the nearest minute rather than dropping the seconds (#758)", () => {
    // A crew punch is stamped to the millisecond at the tap, so it is essentially never a whole
    // number of minutes — the old floor discarded up to 59.999s on every row, always downward.
    expect(hoursLabel(255.9)).toBe("4h 16m");
    expect(hoursLabel(255.4)).toBe("4h 15m");
  });

  it("carries a rounded-up minute into the hour", () => {
    expect(hoursLabel(59.7)).toBe("1h 0m");
    expect(hoursLabel(119.5)).toBe("2h 0m");
  });
});

describe("compactDuration — the punch list's 8h / 45m / 9h 30m", () => {
  it("drops the unit that would read as zero", () => {
    // `admin-time-clock.spec.ts` asserts the literal "8h" and "9h 30m".
    expect(compactDuration(45)).toBe("45m");
    expect(compactDuration(480)).toBe("8h");
    expect(compactDuration(570)).toBe("9h 30m");
  });

  it("rounds to the nearest minute, on the same rule as everything else (#758)", () => {
    expect(compactDuration(255.9)).toBe("4h 16m");
    expect(compactDuration(0.4)).toBe("0m");
    expect(compactDuration(59.7)).toBe("1h");
  });
});

describe("the two labels and the file never disagree about the minute", () => {
  it("splits the SAME rounded minute, whatever the presentation", () => {
    // The point of the module. Three surfaces, three formats, one rounding step — so a crew
    // member reading their own clock, the operator reading the reconcile table, and the file
    // Gusto is paid from can never be looking at different arithmetic.
    for (const m of [0, 0.4, 0.5, 59.7, 119.5, 157 + 43 / 60, 255.4, 255.9, 1199.999]) {
      const rounded = Math.round(m);
      expect(hoursLabel(m), `${m} minutes`).toBe(
        `${Math.floor(rounded / 60)}h ${rounded % 60}m`,
      );
      expect(compactDuration(m).replace(/^(\d+)m$/, "0h $1m"), `${m} minutes`).toBe(
        rounded % 60 === 0 && rounded >= 60 ? `${rounded / 60}h` : hoursLabel(m),
      );
    }
  });
});
