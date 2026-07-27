import { describe, expect, it } from "vitest";
import { buildBookingIcs } from "./booking-ics.js";

describe("buildBookingIcs", () => {
  const base = {
    uid: "resv-1",
    title: "Brew Boat Party",
    date: "2026-07-18",
    time: "13:30",
    durationMinutes: 100,
    tzid: "America/New_York",
    location: "Cleveland — East Bank",
    dtstamp: "2026-07-17T15:10:00Z",
  };

  it("emits a single tz-aware VEVENT with CRLF endings", () => {
    const ics = buildBookingIcs(base);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:resv-1@muster");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260718T133000");
    expect(ics).toContain("DURATION:PT1H40M");
    expect(ics).toContain("DTSTAMP:20260717T151000Z");
    expect(ics).toContain("SUMMARY:Brew Boat Party");
    expect(ics).toContain("LOCATION:Cleveland — East Bank");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });

  it("defaults to a 1-hour block when duration is absent", () => {
    const { durationMinutes, ...noDur } = base;
    void durationMinutes;
    expect(buildBookingIcs(noDur)).toContain("DURATION:PT1H");
  });

  it("escapes commas and semicolons in text values", () => {
    expect(buildBookingIcs({ ...base, location: "Dock A, Pier 5; East" })).toContain(
      "LOCATION:Dock A\\, Pier 5\\; East",
    );
  });

  it("omits optional lines when absent", () => {
    const { location, ...noLoc } = base;
    void location;
    expect(buildBookingIcs(noLoc)).not.toContain("LOCATION:");
  });
});
