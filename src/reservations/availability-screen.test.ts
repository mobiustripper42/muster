/**
 * Customer availability screen view model (12.4, #457) — the pure calendar/slot/fare shaping
 * behind the public `/book` page.
 */
import { describe, expect, it } from "vitest";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { VirtualSlot } from "./availability.js";
import {
  boatsOpenLabel,
  buildMonthCalendar,
  buildSlotRows,
  dayState,
  daysInMonth,
  formatClock,
  formatDuration,
  formatShortDay,
  guestPricing,
  offeringCapacity,
  shiftMonth,
  shortClock,
  weekdaySun0,
} from "./availability-screen.js";

const OFF = asId<"OfferingId">("off-1");
const V = (id: string) => asId<"VesselId">(id);

function slot(over: Partial<VirtualSlot>): VirtualSlot {
  return {
    offeringId: OFF,
    vesselId: V("v1"),
    date: "2026-07-18",
    time: "13:30",
    capacity: 16,
    priceCents: 54900,
    status: "available",
    ...over,
  };
}

describe("formatDuration", () => {
  it("splits hours and minutes, dropping the zero part", () => {
    expect(formatDuration(100)).toBe("1h 40min");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(45)).toBe("45min");
  });
  it("returns null for absent or non-positive input", () => {
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("weekdaySun0 / daysInMonth", () => {
  it("reads Sunday=0 at UTC midnight", () => {
    expect(weekdaySun0("2026-07-01")).toBe(3); // Wed
    expect(weekdaySun0("2026-07-05")).toBe(0); // Sun
  });
  it("counts month length including leap February", () => {
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe("boatsOpenLabel", () => {
  it("distinguishes open, the last boat, and sold out", () => {
    expect(boatsOpenLabel(3)).toEqual({ text: "3 boats open", tone: "open" });
    expect(boatsOpenLabel(1)).toEqual({ text: "1 boat left", tone: "tight" });
    expect(boatsOpenLabel(0)).toEqual({ text: "Sold out", tone: "sold" });
  });
});

describe("dayState", () => {
  const today = "2026-07-10";
  it("is off for a past day even with availability", () => {
    expect(dayState([slot({ date: "2026-07-05" })], "2026-07-05", today)).toBe("off");
  });
  it("is off when no slots exist", () => {
    expect(dayState([], "2026-07-18", today)).toBe("off");
  });
  it("is avail when any slot is available", () => {
    expect(dayState([slot({ status: "booked" }), slot({ status: "available" })], "2026-07-18", today)).toBe("avail");
  });
  it("is soldout when slots exist but none are available", () => {
    expect(dayState([slot({ status: "booked" }), slot({ status: "blocked" })], "2026-07-18", today)).toBe("soldout");
  });
});

describe("buildMonthCalendar", () => {
  it("pads leading blanks to the Sunday-first weekday and labels the month", () => {
    const cal = buildMonthCalendar(2026, 7, new Map(), null, "2026-07-01");
    expect(cal.label).toBe("July 2026");
    // Jul 1 2026 is a Wednesday → 3 leading blanks.
    expect(cal.days.slice(0, 3).every((d) => d.state === "blank" && d.day === null)).toBe(true);
    expect(cal.days[3]).toMatchObject({ day: 1, date: "2026-07-01" });
    expect(cal.days).toHaveLength(3 + 31);
  });
  it("marks the selected day selected, overriding its availability", () => {
    const byDate = new Map([["2026-07-18", [slot({ date: "2026-07-18" })]]]);
    const cal = buildMonthCalendar(2026, 7, byDate, "2026-07-18", "2026-07-01");
    expect(cal.days.find((d) => d.date === "2026-07-18")?.state).toBe("selected");
  });
  it("reflects avail / soldout / off per day", () => {
    const byDate = new Map<string, VirtualSlot[]>([
      ["2026-07-18", [slot({ date: "2026-07-18", status: "available" })]],
      ["2026-07-19", [slot({ date: "2026-07-19", status: "booked" })]],
    ]);
    const cal = buildMonthCalendar(2026, 7, byDate, null, "2026-07-01");
    expect(cal.days.find((d) => d.date === "2026-07-18")?.state).toBe("avail");
    expect(cal.days.find((d) => d.date === "2026-07-19")?.state).toBe("soldout");
    expect(cal.days.find((d) => d.date === "2026-07-20")?.state).toBe("off");
  });
});

describe("buildSlotRows", () => {
  it("collapses per-vessel slots to one row per time with a boats-open count", () => {
    const rows = buildSlotRows([
      slot({ time: "13:30", vesselId: V("a"), status: "available", priceCents: 54900, capacity: 16 }),
      slot({ time: "13:30", vesselId: V("b"), status: "available", priceCents: 52900, capacity: 12 }),
      slot({ time: "13:30", vesselId: V("c"), status: "booked", priceCents: 40000, capacity: 40 }),
      slot({ time: "11:30", vesselId: V("a"), status: "available", priceCents: 49900 }),
    ]);
    expect(rows.map((r) => r.time)).toEqual(["11:30", "13:30"]); // time-sorted
    const midday = rows.find((r) => r.time === "13:30")!;
    expect(midday.boatsOpen).toBe(2);
    expect(midday.priceCents).toBe(52900); // lowest among AVAILABLE boats, not the booked $400
    expect(midday.capacity).toBe(16); // largest among AVAILABLE boats, not the booked 40
    expect(midday.soldOut).toBe(false);
  });
  it("still lists a fully-taken time as sold out, priced from all its boats", () => {
    const rows = buildSlotRows([
      slot({ time: "15:30", vesselId: V("a"), status: "booked", priceCents: 54900, capacity: 16 }),
      slot({ time: "15:30", vesselId: V("b"), status: "blocked", priceCents: 51900, capacity: 12 }),
    ]);
    expect(rows[0]).toMatchObject({ time: "15:30", boatsOpen: 0, soldOut: true, priceCents: 51900, capacity: 16 });
  });
});

describe("guestPricing", () => {
  const offering = { includedGuestCount: 12, extraGuestPriceCents: 4000 };
  it("charges the base within the included count", () => {
    const p = guestPricing(offering, 16, 54900, 10);
    expect(p).toMatchObject({ count: 10, included: 12, cap: 16, extraGuests: 0, extrasCents: 0, fareCents: 54900 });
  });
  it("adds per-guest extras above the included count", () => {
    const p = guestPricing(offering, 16, 54900, 14);
    expect(p.extraGuests).toBe(2);
    expect(p.extrasCents).toBe(8000);
    expect(p.fareCents).toBe(62900);
  });
  it("clamps the count to [1, cap]", () => {
    expect(guestPricing(offering, 16, 54900, 0).count).toBe(1);
    expect(guestPricing(offering, 16, 54900, 99).count).toBe(16);
  });
  it("defaults included to the cap when the offering leaves it unset (no extra charge below cap)", () => {
    const p = guestPricing({ extraGuestPriceCents: 4000 }, 16, 54900, 16);
    expect(p.included).toBe(16);
    expect(p.extrasCents).toBe(0);
  });
});

describe("clock + day formatters", () => {
  it("formats a 24h clock to a customer AM/PM string", () => {
    expect(formatClock("13:30")).toBe("1:30 PM");
    expect(formatClock("00:00")).toBe("12:00 AM");
    expect(formatClock("11:30")).toBe("11:30 AM");
  });
  it("formats the terse slot form", () => {
    expect(shortClock("13:30")).toBe("1:30p");
    expect(shortClock("11:30")).toBe("11:30a");
  });
  it("formats a short weekday+date", () => {
    expect(formatShortDay("2026-07-18")).toBe("Sat, Jul 18");
  });
});

describe("shiftMonth", () => {
  it("steps months and rolls the year at the boundary", () => {
    expect(shiftMonth(2026, 7, 1)).toEqual({ year: 2026, month: 8, first: "2026-08-01" });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1, first: "2027-01-01" });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12, first: "2025-12-01" });
  });
});

describe("offeringCapacity", () => {
  const vessels: Vessel[] = [
    { id: V("v1"), coiMaxPax: 12 } as Vessel,
    { id: V("v2"), coiMaxPax: 16 } as Vessel,
    { id: V("v3"), coiMaxPax: 20 } as Vessel,
  ];
  it("is the largest COI cap among the offering's vessels", () => {
    expect(offeringCapacity({ vesselIds: [V("v1"), V("v2")] }, vessels)).toBe(16);
  });
  it("is 0 when the offering has no vessels", () => {
    expect(offeringCapacity({ vesselIds: [] }, vessels)).toBe(0);
  });
});
