import { describe, expect, it } from "vitest";
import {
  assertClockTime,
  assertIsoDate,
  assertIsoDateTime,
  assertOptionalIsoDateTime,
  IsoDateError,
  isClockTime,
  isIsoDate,
  isIsoDateTime,
} from "./iso-date.js";

describe("isIsoDate", () => {
  it("accepts a calendar-true date", () => {
    expect(isIsoDate("2026-07-01")).toBe(true);
    expect(isIsoDate("2026-12-31")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // leap day
  });

  it("rejects impossible days the regex alone would pass", () => {
    expect(isIsoDate("2026-13-99")).toBe(false); // the canonical rot example
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2025-02-29")).toBe(false); // not a leap year
  });

  it("rejects wrong shapes and non-strings", () => {
    expect(isIsoDate("2026-7-1")).toBe(false); // unpadded
    expect(isIsoDate("2026-07-01T00:00:00.000Z")).toBe(false); // datetime
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(20260701)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("isIsoDateTime", () => {
  it("accepts the canonical toISOString shape", () => {
    expect(isIsoDateTime("2026-07-01T12:00:00.000Z")).toBe(true);
    expect(isIsoDateTime(new Date(0).toISOString())).toBe(true);
  });

  it("rejects non-canonical or impossible instants", () => {
    expect(isIsoDateTime("2026-07-01T12:00:00Z")).toBe(false); // no millis
    expect(isIsoDateTime("2026-07-01T12:00:00.000+00:00")).toBe(false); // offset, not Z
    expect(isIsoDateTime("2026-02-30T00:00:00.000Z")).toBe(false); // rolls forward
    expect(isIsoDateTime("2026-07-01")).toBe(false); // date only
  });
});

describe("isClockTime", () => {
  it("accepts HH:mm in range", () => {
    expect(isClockTime("14:00")).toBe(true);
    expect(isClockTime("00:00")).toBe(true);
    expect(isClockTime("23:59")).toBe(true);
  });
  it("rejects out-of-range or wrong shapes", () => {
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("12:60")).toBe(false);
    expect(isClockTime("2:00")).toBe(false);
    expect(isClockTime("14:00:00")).toBe(false);
  });
});

describe("asserts", () => {
  it("assertIsoDate throws IsoDateError with field + value", () => {
    expect(() => assertIsoDate("2026-13-99", "event.date")).toThrowError(IsoDateError);
    try {
      assertIsoDate("2026-13-99", "event.date");
    } catch (e) {
      expect(e).toBeInstanceOf(IsoDateError);
      expect((e as IsoDateError).field).toBe("event.date");
      expect((e as IsoDateError).value).toBe("2026-13-99");
    }
  });

  it("assertIsoDate passes a good value through", () => {
    expect(() => assertIsoDate("2026-07-01", "event.date")).not.toThrow();
  });

  it("assertIsoDateTime / assertClockTime guard their formats", () => {
    expect(() => assertIsoDateTime("nope", "ask.sentAt")).toThrow(IsoDateError);
    expect(() => assertIsoDateTime("2026-07-01T12:00:00.000Z", "ask.sentAt")).not.toThrow();
    expect(() => assertClockTime("99:99", "event.time")).toThrow(IsoDateError);
    expect(() => assertClockTime("14:00", "event.time")).not.toThrow();
  });

  it("assertOptionalIsoDateTime tolerates absence but not garbage", () => {
    expect(() => assertOptionalIsoDateTime(undefined, "ask.respondedAt")).not.toThrow();
    expect(() => assertOptionalIsoDateTime("bad", "ask.respondedAt")).toThrow(IsoDateError);
  });
});
