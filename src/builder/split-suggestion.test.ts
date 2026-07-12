import { describe, expect, it } from "vitest";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { suggestSplit } from "./derive.js";

/**
 * Split-suggestion detector (8.1, #204). The reporter's real case: a boat with
 * trips at 11:30 · 5:30 · 7:30 landed in ONE shift and should have suggested a
 * split ({11:30} + {5:30, 7:30}). Fixtures are interpreted in UTC (tz "UTC") so
 * the wall-clock IS the instant — deterministic, the engine-test convention.
 */

const UTC = "UTC";

/** A scheduled Event at a vessel-local clock time on one shared day. */
function ev(time: string, status: Event["status"] = "scheduled"): Event {
  return {
    id: asId<"EventId">(`e-${time}-${status}`),
    vesselId: asId<"VesselId">("v"),
    date: "2026-07-04",
    time,
    capacity: 12,
    status,
    source: "xola",
  };
}

describe("suggestSplit", () => {
  it("flags a large mid-day gap: 11:30 · 5:30 · 7:30 → split at 11:30/5:30", () => {
    expect(suggestSplit([ev("11:30"), ev("17:30"), ev("19:30")], UTC)).toEqual({
      reason: "large-gap",
      minutes: 170,
      boundary: { before: "11:30", after: "17:30" },
    });
  });

  it("does NOT flag a normal turnaround: 11:30 · 3:30 → one shift", () => {
    expect(suggestSplit([ev("11:30"), ev("15:30")], UTC)).toBeNull();
  });

  it("does NOT flag back-to-back trips: 5:30 · 7:30", () => {
    expect(suggestSplit([ev("17:30"), ev("19:30")], UTC)).toBeNull();
  });

  it("flags a long span with no single big gap as the human call: 11:30 · 3:30 · 7:30", () => {
    expect(suggestSplit([ev("11:30"), ev("15:30"), ev("19:30")], UTC)).toEqual({
      reason: "long-span",
      minutes: 670,
    });
  });

  it("returns null for 0 or 1 scheduled trips", () => {
    expect(suggestSplit([], UTC)).toBeNull();
    expect(suggestSplit([ev("11:30")], UTC)).toBeNull();
  });

  it("ignores cancelled events — a cancelled 3:30 doesn't bridge the 11:30→7:30 gap", () => {
    const s = suggestSplit(
      [ev("11:30"), ev("15:30", "cancelled"), ev("19:30")],
      UTC,
    );
    expect(s?.reason).toBe("large-gap");
    expect(s?.boundary).toEqual({ before: "11:30", after: "19:30" });
  });

  it("gap wins over span, and the largest qualifying gap is reported", () => {
    // 06:00 · 12:00 (gap 170) · 18:30 (gap 200) — the larger gap wins the boundary.
    const s = suggestSplit([ev("06:00"), ev("12:00"), ev("18:30")], UTC);
    expect(s?.reason).toBe("large-gap");
    expect(s?.boundary).toEqual({ before: "12:00", after: "18:30" });
  });

  it("honors env-knob overrides via opts (raise both thresholds → no suggestion)", () => {
    expect(
      suggestSplit([ev("11:30"), ev("17:30"), ev("19:30")], UTC, {
        gapMinutes: 10_000,
        spanMinutes: 10_000,
      }),
    ).toBeNull();
  });

  it("is order-independent (unsorted input sorts by instant)", () => {
    expect(suggestSplit([ev("19:30"), ev("11:30"), ev("17:30")], UTC)).toEqual({
      reason: "large-gap",
      minutes: 170,
      boundary: { before: "11:30", after: "17:30" },
    });
  });

  // Boundary pins — the thresholds are strict `>` ("exceeds"), and these are
  // tune-later env knobs, so a `>`↔`>=` regression must fail loudly. 11:30·17:30
  // is exactly 170 dead-min (span 550); 11:30·3:30·7:30 is exactly 670 span (gaps 50).
  it("gap threshold is strict: dead-gap == threshold does NOT flag", () => {
    expect(
      suggestSplit([ev("11:30"), ev("17:30")], UTC, { gapMinutes: 170 }),
    ).toBeNull();
  });

  it("gap threshold is strict: one minute over DOES flag", () => {
    expect(
      suggestSplit([ev("11:30"), ev("17:30")], UTC, { gapMinutes: 169 }),
    ).toEqual({ reason: "large-gap", minutes: 170, boundary: { before: "11:30", after: "17:30" } });
  });

  it("span threshold is strict: span == threshold does NOT flag", () => {
    expect(
      suggestSplit([ev("11:30"), ev("15:30"), ev("19:30")], UTC, { spanMinutes: 670 }),
    ).toBeNull();
  });

  it("span threshold is strict: one minute under DOES flag", () => {
    expect(
      suggestSplit([ev("11:30"), ev("15:30"), ev("19:30")], UTC, { spanMinutes: 669 }),
    ).toEqual({ reason: "long-span", minutes: 670 });
  });
});
