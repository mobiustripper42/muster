/**
 * LOOSE drift guard for the db:seed:reservation fixture (12.10) — not a value-pinned snapshot.
 * It asserts the one thing that matters: the world the builder produces still materializes
 * bookings the deriver recognizes AS booked, on the expected vessel/date, and that a block over
 * the demo window sees them as conflicts. If an entity shape or the deriver's slot-overlay
 * drifts so the fixture stops rendering a conflict, this goes red.
 */
import { describe, expect, it } from "vitest";
import type { Block } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { deriveVirtualAvailability } from "./availability.js";
import { computeBlockImpact } from "./block-impact.js";
import { buildSeededReservationWorld, reservationDemo } from "./seed-reservation.js";

// A fixed "today" so the drift guard below stays value-stable; the relative-window
// invariants above are what exercise the date arithmetic across the calendar.
const DEMO = reservationDemo("2026-07-20");
const world = buildSeededReservationWorld("2026-07-20T12:00:00Z", DEMO);

describe("the demo window is relative to today, not a fixed calendar month (#646)", () => {
  // The dates used to be literals (Aug 10–16 2026). That gave every reservations spec a
  // shelf life: `book-availability`'s paging test assumes /book's default month — today's —
  // is EMPTY and the seeded month is reachable by paging FORWARD. Both halves stopped being
  // true the day today caught up to August 2026, and the loop only ever walks forward, so
  // from September the window is unreachable in either direction.
  //
  // These run against several synthetic "todays", including the two that broke it — a date
  // inside the old fixed window, and one after it.
  const TODAYS = [
    "2026-01-01", // new year — next month is same-year
    "2026-08-03", // inside the old fixed window: the day the bug surfaced
    "2026-11-15", // late in the year
    "2026-12-20", // December — next month rolls the YEAR, the arithmetic trap
    "2027-06-30", // a year on, to prove it doesn't rot again
  ];

  for (const today of TODAYS) {
    const d = reservationDemo(today);

    it(`owned window starts after today (${today})`, () => {
      expect(d.ownedRange.start > today).toBe(true);
    });

    it(`today's month contains no owned day, so /book's default is empty (${today})`, () => {
      // The premise of the forward-paging test. If the window ever lands in the current
      // month, that test starts passing by racing a navigation instead of by paging.
      expect(d.ownedRange.start.slice(0, 7)).not.toBe(today.slice(0, 7));
      expect(d.ownedRange.end.slice(0, 7)).not.toBe(today.slice(0, 7));
    });

    it(`the season contains the whole owned window (${today})`, () => {
      expect(d.season.start <= d.ownedRange.start).toBe(true);
      expect(d.season.end >= d.ownedRange.end).toBe(true);
    });

    it(`every booking sits inside the owned window (${today})`, () => {
      for (const b of d.bookings) {
        expect(b.date >= d.ownedRange.start).toBe(true);
        expect(b.date <= d.ownedRange.end).toBe(true);
      }
    });

    it(`the vessel block covers exactly the first two bookings (${today})`, () => {
      // The block-impact fixture asserts an exact conflict count and dollar total, so the
      // third booking must stay OUTSIDE the window however the dates are derived.
      const inWindow = d.bookings.filter(
        (b) => b.date >= d.vesselBlockWindow.start && b.date <= d.vesselBlockWindow.end,
      );
      expect(inWindow).toHaveLength(2);
      expect(inWindow.map((b) => b.date)).toEqual([d.bookings[0]!.date, d.bookings[1]!.date]);
    });

    it(`the location block falls on the first booking's day (${today})`, () => {
      expect(d.locationBlockWindow.date).toBe(d.bookings[0]!.date);
    });
  }

  it("is pure — the same today always yields the same world", () => {
    expect(reservationDemo("2026-08-03")).toEqual(reservationDemo("2026-08-03"));
  });
});

describe("db:seed:reservation fixture", () => {
  it("materializes the expected bookings on vessel-brew-3", () => {
    expect(world.reservations).toHaveLength(DEMO.bookings.length);
    for (const b of DEMO.bookings) {
      const ev = world.events.find((e) => e.date === b.date && e.time === b.time);
      expect(ev, `event on ${b.date} ${b.time}`).toBeDefined();
      expect(String(ev?.vesselId)).toBe(DEMO.vesselId);
      expect(ev?.source).toBe("muster");
    }
  });

  it("the deriver sees the demo slots as booked over the owned window", () => {
    const slots = deriveVirtualAvailability({
      offerings: [world.offering],
      vessels: [{ id: asId<"VesselId">(DEMO.vesselId), name: "Brew 3", coiMaxPax: 12, manning: [] }],
      dateRange: DEMO.ownedRange,
      ownedDays: world.ownedDays,
      blocks: [],
      events: world.events,
      reservations: world.reservations,
    });
    const booked = slots.filter((s) => s.status === "booked");
    expect(booked.length).toBe(DEMO.bookings.length);
  });

  it("a vessel block over the demo window conflicts with the two bookings inside it", () => {
    const block: Block = {
      id: asId<"BlockId">("blk-drift"),
      kind: "vessel",
      vesselId: asId<"VesselId">(DEMO.vesselId),
      startDate: DEMO.vesselBlockWindow.start,
      endDate: DEMO.vesselBlockWindow.end,
    };
    const impact = computeBlockImpact(block, {
      offerings: [world.offering],
      vessels: [{ id: asId<"VesselId">(DEMO.vesselId), name: "Brew 3", coiMaxPax: 12, manning: [] }],
      ownedDays: world.ownedDays,
      events: world.events,
      reservations: world.reservations,
    });
    // The block window covers the first two bookings; the third sits outside it by
    // construction (asserted date-independently in the relative-window suite above).
    expect(impact.conflictCount).toBe(2);
    expect(impact.conflictCents).toBe(54900 + 43900);
    expect(impact.removedSlots).toBeGreaterThan(0);
  });
});
