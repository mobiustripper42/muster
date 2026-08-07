/**
 * What the operator's calendar draws (#615, #691).
 *
 * `unavailable` is two different facts wearing one word, and conflating them is what put
 * phantom "Booked" cards on the operator's calendar.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import { drawsOnCalendar } from "./calendar-grid.js";

const V = asId<"VesselId">("vessel-brew-1");
const DATE = "2026-08-15";
const slot = (time: string, status: string) => ({ vesselId: V, date: DATE, time, status });
const event = (time: string, status = "scheduled") => ({ vesselId: V, date: DATE, time, status });

describe("drawsOnCalendar", () => {
  it("draws every ordinary status untouched", () => {
    for (const st of ["available", "booked", "held", "blocked"]) {
      expect(drawsOnCalendar(slot("17:30", st), [])).toBe(true);
    }
  });

  it("draws an unavailable slot that has a real trip at that exact time", () => {
    // A Xola charter at 17:30. The boat is out and the operator must see it.
    expect(drawsOnCalendar(slot("17:30", "unavailable"), [event("17:30")])).toBe(true);
  });

  it("hides an unavailable slot with no trip of its own — the phantom", () => {
    // 17:30 + 100min reaches over an 18:00 departure. Nothing runs at 18:00; the schedule
    // merely proposes it. Drawing it is what produced two "Booked" cards on one hull.
    expect(drawsOnCalendar(slot("18:00", "unavailable"), [event("17:30")])).toBe(false);
  });

  it("a CANCELLED event at the time does not count as a trip", () => {
    expect(drawsOnCalendar(slot("17:30", "unavailable"), [event("17:30", "cancelled")])).toBe(false);
  });

  it("another boat's or another day's trip does not rescue the slot", () => {
    const other = { vesselId: asId<"VesselId">("vessel-brew-9"), date: DATE, time: "17:30", status: "scheduled" };
    expect(drawsOnCalendar(slot("17:30", "unavailable"), [other])).toBe(false);
    expect(drawsOnCalendar(slot("17:30", "unavailable"), [{ ...event("17:30"), date: "2026-08-16" }])).toBe(false);
  });
});
