/**
 * LOOSE drift guard for the db:seed:reservation fixture (12.10) — not a value-pinned snapshot.
 * It asserts the one thing that matters: the world the builder produces still materializes
 * bookings the deriver recognizes AS booked, on the expected vessel/date, and that a block over
 * the demo window sees them as conflicts. If an entity shape or the deriver's slot-overlay
 * drifts so the fixture stops rendering a conflict, this goes red.
 */
import { describe, expect, it } from "vitest";
import type { Block, Vessel } from "../domain/entities.js";
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

    it(`demo window starts after today (${today})`, () => {
      expect(d.window.start > today).toBe(true);
    });

    it(`today's month contains no demo day, so /book's default is empty (${today})`, () => {
      // The premise of the forward-paging test. If the window ever lands in the current
      // month, that test starts passing by racing a navigation instead of by paging.
      expect(d.window.start.slice(0, 7)).not.toBe(today.slice(0, 7));
      expect(d.window.end.slice(0, 7)).not.toBe(today.slice(0, 7));
    });

    it(`the season contains the whole demo window (${today})`, () => {
      expect(d.season.start <= d.window.start).toBe(true);
      expect(d.season.end >= d.window.end).toBe(true);
    });

    it(`every booking sits inside the demo window (${today})`, () => {
      for (const b of d.bookings) {
        expect(b.date >= d.window.start).toBe(true);
        expect(b.date <= d.window.end).toBe(true);
      }
    });

    it(`the vessel block covers exactly the first two bookings (${today})`, () => {
      // The block-impact fixture asserts an exact conflict count and dollar total, so the
      // third booking must stay OUTSIDE the window however the dates are derived.
      //
      // Filtered by HULL as well as date since #715. This is a **vessel** block on the primary
      // boat, so a booking that merely shares a date with it is not a conflict — and the big-party
      // fixtures put Brew 1 and Brew 2 bookings inside this window on purpose. Date-only was
      // right while every booking was on one boat; left alone it would now count five.
      const inWindow = d.bookings.filter(
        (b) =>
          (b.vesselId ?? d.vesselId) === d.vesselId &&
          b.date >= d.vesselBlockWindow.start &&
          b.date <= d.vesselBlockWindow.end,
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

/** Every boat the offering sells. Passing only the primary hull made the deriver skip the
 *  big-party bookings on Brew 1 and Brew 2 outright — it cannot place a slot for a vessel it
 *  was not given, so those bookings silently stopped existing (#715). */
const FLEET: Vessel[] = DEMO.fleet.map(
  (f) => ({ id: asId<"VesselId">(f.vesselId), name: f.name, coiMaxPax: f.coiMaxPax, manning: [] }) as Vessel,
);

describe("db:seed:reservation fixture", () => {
  it("materializes each booking on its own hull, at that hull's capacity", () => {
    expect(world.reservations).toHaveLength(DEMO.bookings.length);
    for (const b of DEMO.bookings) {
      const boat = b.vesselId ?? DEMO.vesselId;
      // Keyed on the vessel too: two boats share a departure in the big-party fixtures, so
      // date+time no longer identifies one event.
      const ev = world.events.find(
        (e) => e.date === b.date && e.time === b.time && String(e.vesselId) === boat,
      );
      expect(ev, `event on ${b.date} ${b.time} ${boat}`).toBeDefined();
      expect(ev?.source).toBe("muster");
      // A 16-guest party on an Event capped at 12 is a fixture that contradicts itself — and
      // `canBook` would refuse it. The capacity has to follow the boat.
      const cap = DEMO.fleet.find((f) => f.vesselId === boat)?.coiMaxPax;
      expect(ev?.capacity, `capacity for ${boat}`).toBe(cap);
      expect(b.partySize).toBeLessThanOrEqual(cap!);
    }
  });

  it("gives every booking a distinct reservation id, including two boats in one departure", () => {
    const ids = world.reservations.map((r) => String(r.id));
    expect(new Set(ids).size).toBe(ids.length);
    // The case that forced the hull into the id: same date, same time, different boat.
    const shared = DEMO.bookings.filter(
      (b) => DEMO.bookings.filter((o) => o.date === b.date && o.time === b.time).length > 1,
    );
    expect(shared.length, "the fixture must actually sell one departure twice").toBeGreaterThan(0);
  });

  // #715 — the hand-test for the guest filter is only meaningful against an offering with more
  // than one boat SIZE. With a single 12-pax hull, every party from 1 to 12 sees an identical
  // calendar and a broken filter looks exactly like a working one. This pins the fixture the
  // runbook's steps are written against: three boats, three distinct caps, two boundaries to
  // cross. It has no assertion about which boats — only that the shape survives.
  it("attaches boats of three distinct capacities, so the guest filter is observable", () => {
    const caps = DEMO.fleet.map((f) => f.coiMaxPax);
    expect(new Set(caps).size).toBe(3);
    expect([...caps].sort((a, b) => a - b)).toEqual(caps); // smallest first — the stepper's default
    expect(world.offering.vesselIds.map(String)).toEqual(DEMO.fleet.map((f) => f.vesselId));
    // The bookings and the block-impact figures all sit on the primary boat; if that stopped
    // being one of the offering's vessels the fixtures above would silently stop overlapping.
    expect(DEMO.fleet.some((f) => f.vesselId === DEMO.vesselId)).toBe(true);
  });

  it("the deriver sees the demo slots as booked over the demo window", () => {
    const slots = deriveVirtualAvailability({
      offerings: [world.offering],
      vessels: FLEET,
      dateRange: DEMO.window,
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
      vessels: FLEET,
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
