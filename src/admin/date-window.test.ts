/**
 * The shared date window (issue #1142). All Shifts has no unit test of its window, so this file
 * is AC1's parity proof: the values `app/(admin)/admin/shifts/page.tsx:150-232` answers today,
 * asserted against the shared module. The vessel is on America/New_York (DEC-032).
 */
import { describe, expect, it } from "vitest";
import { resolveWindow, windowParams } from "./date-window.js";

/** Wednesday 2026-10-21, noon EDT. */
const WED = new Date("2026-10-21T16:00:00.000Z");

describe("issue #1142 — resolveWindow, All Shifts' presets", () => {
  it("AC1: today is the vessel-local day, not the UTC one", () => {
    // 22:00 EDT on the 21st is already the 22nd in UTC.
    const lateEvening = new Date("2026-10-22T02:00:00.000Z");
    expect(resolveWindow({ preset: "today" }, lateEvening)).toEqual({
      from: "2026-10-21",
      to: "2026-10-21",
      kind: "today",
      scope: "today",
    });
  });

  it("AC1: weekend is the coming Saturday and Sunday", () => {
    expect(resolveWindow({ preset: "weekend" }, WED)).toEqual({
      from: "2026-10-24",
      to: "2026-10-25",
      kind: "weekend",
      scope: "this weekend",
    });
  });

  it("AC1: weekend on a Saturday starts today, and on a Sunday started yesterday", () => {
    const sat = new Date("2026-10-24T16:00:00.000Z");
    const sun = new Date("2026-10-25T16:00:00.000Z");
    for (const now of [sat, sun]) {
      expect(resolveWindow({ preset: "weekend" }, now)).toMatchObject({
        from: "2026-10-24",
        to: "2026-10-25",
        kind: "weekend",
      });
    }
  });

  it("AC1: next7 is today and the six days after", () => {
    expect(resolveWindow({ preset: "next7" }, WED)).toEqual({
      from: "2026-10-21",
      to: "2026-10-27",
      kind: "next7",
      scope: "the next 7 days",
    });
  });

  it("AC1: next8to15 is days 8 to 15, starting the day after next7 ends", () => {
    expect(resolveWindow({ preset: "next8to15" }, WED)).toEqual({
      from: "2026-10-28",
      to: "2026-11-04",
      kind: "next8to15",
      scope: "2 weeks out",
    });
  });

  it("AC1: days30 is today and the 29 days after", () => {
    expect(resolveWindow({ preset: "days30" }, WED)).toEqual({
      from: "2026-10-21",
      to: "2026-11-19",
      kind: "days30",
      scope: "the next 30 days",
    });
  });

  it("AC1: with no params the window is the next 7 days", () => {
    expect(resolveWindow({}, WED)).toEqual({
      from: "2026-10-21",
      to: "2026-10-27",
      kind: "next7",
      scope: "the next 7 days",
    });
  });

  it("AC1: an unknown preset — past or all among them when not allowed — falls to the next 7 days", () => {
    const week = { from: "2026-10-21", to: "2026-10-27", kind: "next7", scope: "the next 7 days" };
    expect(resolveWindow({ preset: "bogus" }, WED)).toEqual(week);
    expect(resolveWindow({ preset: "past" }, WED)).toEqual(week);
    expect(resolveWindow({ preset: "all" }, WED)).toEqual(week);
    // Each preset has its own switch: allowing one does not allow the other.
    expect(resolveWindow({ preset: "all" }, WED, { allowPast: true })).toEqual(week);
    expect(resolveWindow({ preset: "past" }, WED, { allowAll: true })).toEqual(week);
  });

  it("AC1: a from/to range is a range, labelled by its two days", () => {
    expect(resolveWindow({ from: "2026-10-22", to: "2026-10-24" }, WED)).toEqual({
      from: "2026-10-22",
      to: "2026-10-24",
      kind: "range",
      scope: "Thu, Oct 22 – Sat, Oct 24",
    });
  });

  it("AC1: a range missing one end takes from = today, or to = from", () => {
    expect(resolveWindow({ to: "2026-10-24" }, WED)).toEqual({
      from: "2026-10-21",
      to: "2026-10-24",
      kind: "range",
      scope: "Wed, Oct 21 – Sat, Oct 24",
    });
    expect(resolveWindow({ from: "2026-10-22" }, WED)).toEqual({
      from: "2026-10-22",
      to: "2026-10-22",
      kind: "range",
      scope: "Thu, Oct 22",
    });
  });

  it("AC1: a range that ends before it starts is the one day it starts on", () => {
    expect(resolveWindow({ from: "2026-10-25", to: "2026-10-22" }, WED)).toEqual({
      from: "2026-10-25",
      to: "2026-10-25",
      kind: "range",
      scope: "Sun, Oct 25",
    });
  });

  it("AC1: a range is clamped 30 days back and 45 ahead, and the label is the clamped window", () => {
    expect(resolveWindow({ from: "2026-08-01", to: "2027-01-31" }, WED)).toEqual({
      from: "2026-09-21",
      to: "2026-12-05",
      kind: "range",
      scope: "Mon, Sep 21 – Sat, Dec 5",
    });
    // Wholly before the floor: both ends land on it.
    expect(resolveWindow({ from: "2026-01-01", to: "2026-01-05" }, WED)).toMatchObject({
      from: "2026-09-21",
      to: "2026-09-21",
    });
  });

  it("AC1: a malformed date is no date, so the window is the default", () => {
    expect(resolveWindow({ from: "Oct 22", to: "2026-1-5" }, WED)).toEqual({
      from: "2026-10-21",
      to: "2026-10-27",
      kind: "next7",
      scope: "the next 7 days",
    });
  });

  it("AC1: a known preset beats a range beside it", () => {
    expect(resolveWindow({ preset: "today", from: "2026-10-22", to: "2026-10-24" }, WED)).toMatchObject({
      from: "2026-10-21",
      to: "2026-10-21",
      kind: "today",
    });
  });
});

describe("issue #1142 — resolveWindow, Purchases' presets", () => {
  it("AC2: past is today−30 to yesterday, both ends included", () => {
    expect(resolveWindow({ preset: "past" }, WED, { allowPast: true })).toEqual({
      from: "2026-09-21",
      to: "2026-10-20",
      kind: "past",
      scope: "the last 30 days",
    });
  });

  it("AC2: all has no date bound", () => {
    expect(resolveWindow({ preset: "all" }, WED, { allowAll: true })).toEqual({
      from: "",
      to: "",
      kind: "all",
      scope: "all dates",
    });
  });
});

describe("issue #1142 — windowParams, the preset-or-range half of a querystring", () => {
  const params = (p: URLSearchParams) => Object.fromEntries(p);

  it.each(["today", "weekend", "next7", "next8to15", "days30"])(
    "AC8: carries the known preset %s",
    (preset) => {
      expect(params(windowParams({ preset }))).toEqual({ preset });
    },
  );

  it("AC8: a known preset is carried alone, even beside a range", () => {
    expect(params(windowParams({ preset: "days30", from: "2026-10-01", to: "2026-10-05" }))).toEqual({
      preset: "days30",
    });
  });

  it("AC8: with no preset a range is carried, and a malformed end is dropped", () => {
    expect(params(windowParams({ from: "2026-10-01", to: "2026-10-05" }))).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
    expect(params(windowParams({ from: "2026-10-01", to: "Oct 5" }))).toEqual({ from: "2026-10-01" });
  });

  it("AC8: past and all are carried only when allowed, so All Shifts' URLs are unchanged", () => {
    expect(params(windowParams({ preset: "past" }))).toEqual({});
    expect(params(windowParams({ preset: "all" }))).toEqual({});
    expect(params(windowParams({ preset: "past" }, { allowPast: true }))).toEqual({ preset: "past" });
    expect(params(windowParams({ preset: "all" }, { allowAll: true }))).toEqual({ preset: "all" });
    expect(params(windowParams({ preset: "all" }, { allowPast: true }))).toEqual({});
  });

  it("AC8: the bare default and an unknown preset carry nothing", () => {
    expect(params(windowParams({}))).toEqual({});
    expect(params(windowParams({ preset: "bogus" }))).toEqual({});
  });
});
