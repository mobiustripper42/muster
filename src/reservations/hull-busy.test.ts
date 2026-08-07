/**
 * Hull occupancy (#615, #691) — one boat cannot run two trips that overlap in time,
 * whichever system sold them.
 *
 * This is the shared truth behind the read path (the deriver, `candidateVessels`) and the
 * write CAS. Both had guarded on **slot identity** — the exact `(vessel, date, time)` triple —
 * which is defeated by two trips on the same hull at 13:30 and 14:00. Different identities,
 * both writes succeed, two parties on one boat and nothing anywhere reports it.
 */
import { describe, expect, it } from "vitest";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  XOLA_TRIP_MINUTES,
  busyIntervalsFor,
  hullIsBusy,
  minutesOfDay,
} from "./hull-busy.js";

const V = asId<"VesselId">("vessel-brew-3");
const OTHER = asId<"VesselId">("vessel-brew-2");
const DATE = "2026-09-12";

const ev = (over: Partial<Event> & Pick<Event, "time">): Event => ({
  id: asId<"EventId">(`ev-${over.time}-${over.source ?? "muster"}`),
  vesselId: V,
  date: DATE,
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

describe("minutesOfDay", () => {
  it("parses HH:MM to minutes past midnight", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("13:30")).toBe(810);
    expect(minutesOfDay("23:59")).toBe(1439);
  });
});

describe("busyIntervalsFor", () => {
  it("uses a Muster event's own frozen duration", () => {
    const out = busyIntervalsFor([ev({ time: "13:30", durationMinutes: 100 })], V, DATE);
    expect(out).toEqual([{ start: 810, end: 910 }]); // 13:30 → 15:10
  });

  it("gives a Xola event the standing trip length — the importer writes no duration", () => {
    const out = busyIntervalsFor([ev({ time: "13:30", source: "xola" })], V, DATE);
    expect(out).toEqual([{ start: 810, end: 810 + XOLA_TRIP_MINUTES }]);
  });

  it("counts BOTH sources — a Xola trip occupies the hull exactly like a Muster one", () => {
    const out = busyIntervalsFor(
      [ev({ time: "10:00", source: "xola" }), ev({ time: "13:30", durationMinutes: 100 })],
      V,
      DATE,
    );
    expect(out).toHaveLength(2);
  });

  it("ignores cancelled events, other vessels, and other dates", () => {
    const events = [
      ev({ time: "13:30", status: "cancelled" }),
      ev({ time: "13:30", vesselId: OTHER }),
      ev({ time: "13:30", date: "2026-09-13" }),
    ];
    expect(busyIntervalsFor(events, V, DATE)).toEqual([]);
  });

  it("a malformed time blocks the whole day rather than vanishing", () => {
    // NaN comparisons are always false, so an unparseable time used to drop OUT of the busy
    // set — the event became invisible to the very check meant to see it. Wrong direction:
    // garbage in the data must cost a sellable slot, never a double-booked boat.
    expect(busyIntervalsFor([ev({ time: "not-a-time" })], V, DATE)).toEqual([
      { start: 0, end: 1440 },
    ]);
  });

  it("falls back to the standing trip length for a Muster event with no duration", () => {
    // Pre-#570 events carry no `durationMinutes`. Treating that as a zero-length trip would
    // make an existing booking invisible to the overlap check — the failure this all exists
    // to prevent. Assume a full trip instead.
    const out = busyIntervalsFor([ev({ time: "13:30" })], V, DATE);
    expect(out).toEqual([{ start: 810, end: 810 + XOLA_TRIP_MINUTES }]);
  });
});

describe("hullIsBusy — the overlap rule", () => {
  const busy = [{ start: 810, end: 910 }]; // 13:30 → 15:10

  it("blocks a start INSIDE an existing trip — the #691 hole", () => {
    // 14:00 is a different slot identity from 13:30, so the exact-triple guard let this
    // through and both bookings succeeded.
    expect(hullIsBusy(busy, minutesOfDay("14:00"), 100)).toBe(true);
  });

  it("blocks a trip that STARTS before and runs into an existing one", () => {
    // 12:30 + 100 = 14:10, which lands inside 13:30–15:10.
    expect(hullIsBusy(busy, minutesOfDay("12:30"), 100)).toBe(true);
  });

  it("blocks the identical slot — the case the old guard did catch", () => {
    expect(hullIsBusy(busy, minutesOfDay("13:30"), 100)).toBe(true);
  });

  it("blocks a trip that fully CONTAINS an existing one", () => {
    expect(hullIsBusy([{ start: 810, end: 830 }], minutesOfDay("13:00"), 120)).toBe(true);
  });

  it("allows a trip that starts exactly when the last one ends", () => {
    // Half-open intervals: [start, end). Back-to-back is legal — the operator schedules
    // 13:30/15:30 on a 100-minute trip precisely so they abut without overlapping.
    expect(hullIsBusy(busy, 910, 100)).toBe(false);
  });

  it("allows a trip that ends exactly when the next one starts", () => {
    expect(hullIsBusy(busy, 710, 100)).toBe(false); // 11:50 → 13:30
  });

  it("allows a clear slot", () => {
    expect(hullIsBusy(busy, minutesOfDay("17:30"), 100)).toBe(false);
    expect(hullIsBusy([], minutesOfDay("13:30"), 100)).toBe(false);
  });
});

describe("hullIsBusy — unreadable input errs toward blocking", () => {
  it("an unparseable CANDIDATE time reads busy, not free", () => {
    // The mirror of busyIntervalsFor's whole-day block. NaN comparisons are all false, so an
    // unguarded candidate time made the slot sellable — bad data costing a boat.
    expect(hullIsBusy([{ start: 810, end: 910 }], minutesOfDay("nonsense"), 100)).toBe(true);
    expect(hullIsBusy([], minutesOfDay("nonsense"), 100)).toBe(true);
  });

  it("an unparseable duration falls back to a full trip rather than zero", () => {
    // A zero-length candidate would slip between two trips that leave no real gap.
    expect(hullIsBusy([{ start: 810, end: 910 }], 900, Number.NaN)).toBe(true);
  });
});

