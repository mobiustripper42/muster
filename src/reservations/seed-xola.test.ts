/**
 * The synthetic Xola fixture's own properties.
 *
 * A fixture is only worth having if its premises hold on any day it runs. `seed-reservation`
 * learned that the hard way: literal dates gave every reservations spec a shelf life, and when it
 * expired the tests did not go red — they went quiet, passing while verifying nothing. So these
 * assert the *relationships* the specs depend on, across a spread of "todays", rather than any
 * particular date.
 */
import { describe, expect, it } from "vitest";
import { deriveVirtualAvailability } from "./availability.js";
import { XOLA_TRIP_MINUTES, minutesOfDay } from "./hull-busy.js";
import { reservationDemo, buildSeededReservationWorld } from "./seed-reservation.js";
import { buildSeededXolaWorld, xolaFixture, UNCOVERED_VESSEL } from "./seed-xola.js";
import { asId } from "../domain/ids.js";
import type { Vessel } from "../domain/entities.js";

const TODAYS = [
  "2026-01-01", // new year — next month is same-year
  "2026-06-15",
  "2026-11-30",
  "2026-12-20", // December — next month rolls the YEAR
  "2027-02-27", // short month
];

const NOW = "2026-01-01T00:00:00.000Z";

describe("xolaFixture — date properties", () => {
  for (const today of TODAYS) {
    const fx = xolaFixture(today);
    const demo = reservationDemo(today);

    it(`every trip lands inside the demo window (${today})`, () => {
      // The whole point is interaction with a live offering. A trip outside its window would
      // silently stop testing anything.
      for (const t of fx.trips) {
        expect(t.date >= demo.window.start).toBe(true);
        expect(t.date <= demo.window.end).toBe(true);
      }
    });

    it(`no fixture trip lands on a day the demo world already books (${today})`, () => {
      // The demo books three days of its own window. A fixture trip on one of them would make
      // "is this slot taken by the import?" unanswerable — which is how the first draft of this
      // fixture reported a clean day as booked.
      const demoBooked = new Set(demo.bookings.map((b) => b.date));
      for (const t of fx.trips) expect(demoBooked.has(t.date)).toBe(false);
    });

    it(`the clean day really has no trips (${today})`, () => {
      // The control. If anything drifts onto it, "everything reads open" stops being a signal.
      expect(fx.trips.some((t) => t.date === fx.days.clean)).toBe(false);
    });

    it(`the overlapping trip does NOT sit on a demo departure time (${today})`, () => {
      // If it did, it would test #615 again and never exercise #691's different-identity shape.
      const t = fx.trips.find((x) => x.date === fx.days.overlapping)!;
      expect(demo.departureTimes).not.toContain(t.time);
      // …but it must still reach a departure, or it proves nothing.
      const reach = minutesOfDay(t.time) + XOLA_TRIP_MINUTES;
      expect(demo.departureTimes.some((d) => minutesOfDay(d) > minutesOfDay(t.time) && minutesOfDay(d) < reach)).toBe(true);
    });

    it(`the invisible trips really are off the offering grid (${today})`, () => {
      // Select the two rows by what they ARE, not by their day — `invisible` shares a date with
      // `onGrid`, and selecting by date swept in the on-grid trip and made this assert the
      // opposite of its own name.
      const offGrid = fx.trips.find((t) => t.time === "09:00")!;
      expect(demo.departureTimes).not.toContain(offGrid.time);
      const uncovered = fx.trips.find((t) => t.vesselId === String(UNCOVERED_VESSEL.id))!;
      expect(uncovered.vesselId).not.toBe(demo.vesselId);
    });

    it(`the repeat guest's two rows share a canonical phone but not its spelling (${today})`, () => {
      const rows = fx.trips.filter((x) => x.customerName === "Nora Blake");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.phone).not.toBe(rows[1]!.phone); // spelled differently…
      const digits = (p: string) => p.replace(/\D/g, "");
      expect(digits(rows[0]!.phone)).toBe(digits(rows[1]!.phone)); // …same number
    });
  }
});

describe("the fixture against the deriver — the cases it exists to prove", () => {
  const today = "2026-06-15";
  const demo = reservationDemo(today);
  const fx = xolaFixture(today);
  const demoWorld = buildSeededReservationWorld(NOW, demo);
  const xolaWorld = buildSeededXolaWorld(NOW, fx);
  const boat: Vessel = {
    id: asId<"VesselId">(demo.vesselId),
    name: demo.vesselName,
    coiMaxPax: 12,
    manning: [],
  };
  const on = (date: string) =>
    deriveVirtualAvailability({
      offerings: [demoWorld.offering],
      vessels: [boat, UNCOVERED_VESSEL],
      dateRange: { start: date, end: date },
      blocks: [],
      events: [...demoWorld.events, ...xolaWorld.events],
      reservations: [...demoWorld.reservations, ...xolaWorld.reservations],
    });

  it("#615 — a Xola trip on a Muster departure time makes that slot unsellable", () => {
    const slots = on(fx.days.onGrid);
    expect(slots.find((s) => s.time === "13:30")!.status).toBe("unavailable");
  });

  it("#691 — a Xola trip at 14:00 takes out BOTH 13:30 and 15:30", () => {
    // Neither is the same slot identity as the trip. This is the shape the exact-triple guard
    // could not see, and the reason the fixture puts a trip off-grid on purpose.
    const slots = on(fx.days.overlapping);
    expect(slots.find((s) => s.time === "13:30")!.status).toBe("unavailable");
    expect(slots.find((s) => s.time === "15:30")!.status).toBe("unavailable");
    expect(slots.find((s) => s.time === "17:30")!.status).toBe("available");
  });

  it("the clean day is entirely open — the control", () => {
    const slots = on(fx.days.clean);
    expect(slots.every((s) => s.status === "available")).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
  });

  it("a CANCELLED import releases the boat", () => {
    // The cancelled trip sits at 15:30, in the gap the repeat guest's two live trips leave open
    // (13:30 runs to 15:10, 17:30 starts after). So 15:30 is available iff `cancelled` is being
    // honoured — if a dead trip occupied the hull, this is the assertion that catches it.
    const slots = on(fx.days.cancelled);
    expect(slots.find((s) => s.time === "15:30")!.status).toBe("available");
    expect(slots.find((s) => s.time === "13:30")!.status).toBe("unavailable"); // live one still blocks
  });

  it("#700 — the off-grid trips produce no slot at all, which is the blind spot", () => {
    // Nothing here is 'wrong' in the deriver: no offering schedules 09:00, so no slot exists.
    // The bug is that the CALENDAR draws only slots, so a boat that is out reads free. Pinned
    // here so that when #700 lands, this expectation is the thing that has to change.
    const slots = on(fx.days.invisible);
    expect(slots.some((s) => s.time === "09:00")).toBe(false);
    expect(slots.some((s) => String(s.vesselId) === String(UNCOVERED_VESSEL.id))).toBe(false);
  });
});
