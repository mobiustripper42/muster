/**
 * Availability read model (11.1) — whole-boat mutex, DEC-108/109 amended.
 */
import { describe, expect, it } from "vitest";
import type {
  Block,
  CheckoutHold,
  Event,
  Offering,
  Reservation,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  canBook,
  deriveAvailability,
  deriveVirtualAvailability,
  eventIdForSlot,
  isActiveMusterClaim,
  isSlotBlocked,
  slotIdentity,
} from "./availability.js";

const V = asId<"VesselId">("vessel-brew-2");

const ev = (id: string, over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">(id),
  vesselId: V,
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

const res = (id: string, eventId: string, over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">(id),
  eventId: asId<"EventId">(eventId),
  source: "muster",
  customerName: "Mary",
  partySize: 6,
  status: "booked",
  ...over,
});

describe("deriveAvailability — whole-boat mutex", () => {
  it("includes only scheduled Muster events; drops Xola + cancelled", () => {
    const out = deriveAvailability(
      [
        ev("m-open"),
        ev("x-boat", { source: "xola" }), // Xola event — never in the Muster funnel
        ev("m-cancelled", { status: "cancelled" }),
      ],
      [],
    );
    expect(out.map((a) => String(a.eventId))).toEqual(["m-open"]);
    expect(out[0]!.available).toBe(true);
  });

  it("available=false once the boat carries an active Muster reservation (mutex, not a seat count)", () => {
    const out = deriveAvailability(
      [ev("m1")],
      [res("r1", "m1", { partySize: 4 })], // party of 4 on a 12-cap boat...
    );
    // ...still UNAVAILABLE — the whole boat is taken, not "8 seats left" (the old
    // COI − Σ formula would wrongly re-offer it).
    expect(out[0]!.available).toBe(false);
  });

  it("a cancelled reservation does not claim the boat", () => {
    const out = deriveAvailability([ev("m1")], [res("r1", "m1", { status: "cancelled" })]);
    expect(out[0]!.available).toBe(true);
  });

  it("a Xola reservation never claims a Muster event", () => {
    const out = deriveAvailability([ev("m1")], [res("r1", "m1", { source: "xola" })]);
    expect(out[0]!.available).toBe(true);
  });

  it("a PENDING row is not a sold claim — the calendar shows it as nothing until 14.9 (14.3, SPEC §2.8.10)", () => {
    // `isActiveMusterClaim` is the one allow-list every slot reader (calendar, /book, block
    // impact) sits on. A pending row has no event (§2.8.2) and is not `booked`, so no slot is
    // `sold` for it. Rendering a LIVE pending row as `held` needs the row to name its slot,
    // which is 14.4's write and 14.9's read — this pins that it is never `sold` in the meantime.
    expect(isActiveMusterClaim(res("r1", "m1", { status: "pending", eventId: null }))).toBe(false);
    const out = deriveAvailability([ev("m1")], [res("r1", "m1", { status: "pending", eventId: null })]);
    expect(out[0]!.available).toBe(true);
  });

  it("surfaces price (DEC-112) when present, omits it when unpriced", () => {
    const [priced, free] = deriveAvailability(
      [ev("m1", { price: 49900 }), ev("m2")],
      [],
    );
    expect(priced!.price).toBe(49900);
    expect("price" in free!).toBe(false);
  });
});

describe("canBook — the whole-boat claim predicate", () => {
  const event = ev("m1", { capacity: 12 });

  it("true: unclaimed Muster event, party within the COI cap", () => {
    expect(canBook(event, [], 12)).toBe(true); // party == capacity is allowed
    expect(canBook(event, [], 1)).toBe(true);
  });

  it("false: the boat is already claimed by an active Muster reservation", () => {
    expect(canBook(event, [res("r1", "m1")], 2)).toBe(false);
  });

  it("false: party exceeds the boat's COI cap", () => {
    expect(canBook(event, [], 13)).toBe(false);
  });

  it("false: non-positive or non-integer party size", () => {
    expect(canBook(event, [], 0)).toBe(false);
    expect(canBook(event, [], -1)).toBe(false);
    expect(canBook(event, [], 2.5)).toBe(false);
  });

  it("false: not a sellable event (Xola, or cancelled)", () => {
    expect(canBook(ev("x", { source: "xola" }), [], 4)).toBe(false);
    expect(canBook(ev("c", { status: "cancelled" }), [], 4)).toBe(false);
  });

  it("a cancelled reservation on the boat does not block a new booking", () => {
    expect(canBook(event, [res("r1", "m1", { status: "cancelled" })], 4)).toBe(true);
  });
});

// ── Virtual availability read model (12.0, DEC-125) ──────────────────────────
// 2026-07-04 and 2026-07-11 are Saturdays (weekdayMon0 === 5); 2026-07-05 a Sunday (6),
// 2026-07-06 a Monday (0). RANGE spans both Saturdays.

const vessel = (over: Partial<Vessel> = {}): Vessel => ({
  id: V,
  name: "Brew 2",
  coiMaxPax: 12,
  manning: [],
  ...over,
});

const offering = (over: Partial<Offering> = {}): Offering => ({
  id: asId<"OfferingId">("off-1"),
  tenantId: asId<"TenantId">("brewboat"),
  name: "Sunset Cruise",
  status: "live",
  vesselIds: [V],
  locationId: asId<"LocationId">("loc-dock"),
  schedule: {
    seasonStart: "2026-06-01",
    seasonEnd: "2026-08-31",
    weekdays: [5], // Saturdays only
    departureTimes: ["13:30"],
  },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
  ...over,
});

const RANGE = { start: "2026-07-01", end: "2026-07-15" };   // two Saturdays: 07-04, 07-11
const ONE_SAT = { start: "2026-07-01", end: "2026-07-05" }; // just 07-04

/** One Saturday, no blocks/events — the happy baseline; override per test. */
const base = {
  offerings: [offering()],
  vessels: [vessel()],
  dateRange: ONE_SAT,
  blocks: [] as Block[],
  events: [] as Event[],
  reservations: [] as Reservation[],
};

describe("deriveVirtualAvailability — the DEC-125 grid", () => {
  it("enumerates schedule × vessels × dates ∩ season, all available on empty state", () => {
    const out = deriveVirtualAvailability({ ...base, dateRange: RANGE });
    expect(out.map((s) => s.date)).toEqual(["2026-07-04", "2026-07-11"]);
    expect(
      out.every(
        (s) =>
          s.status === "available" &&
          s.capacity === 12 &&
          s.priceCents === 49900 &&
          s.time === "13:30" &&
          s.eventId === undefined,
      ),
    ).toBe(true);
  });

  it("sells the whole season with no marking step — ownership is gone (#688)", () => {
    // The offering's schedule says when. Nothing else gates. Before #688 this returned []
    // unless someone had hand-typed an allowlist row per boat per date via `db:own`.
    const out = deriveVirtualAvailability({
      offerings: [offering({ schedule: { seasonStart: "2026-05-01", seasonEnd: "2026-09-30", weekdays: [5], departureTimes: ["13:30"] } })],
      vessels: [vessel()],
      dateRange: { start: "2026-07-01", end: "2026-07-31" },
      blocks: [],
      events: [],
      reservations: [],
    });
    // Every Saturday in July, none of them marked anything.
    expect(out.map((s) => s.date)).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
  });

  it("blocks are the only thing that takes a day off the market (#688)", () => {
    // Note the difference from the deleted owned-day mask: a block SURFACES the slot as
    // `blocked` — the operator can see they closed it. An unowned day vanished silently,
    // indistinguishable from a day the offering never scheduled.
    const out = deriveVirtualAvailability({
      ...base,
      dateRange: RANGE,
      blocks: [
        {
          id: asId<"BlockId">("blk-1"),
          kind: "vessel",
          vesselId: V,
          startDate: "2026-07-11",
          endDate: "2026-07-11",
        },
      ],
    });
    expect(out.map((s) => [s.date, s.status])).toEqual([
      ["2026-07-04", "available"],
      ["2026-07-11", "blocked"],
    ]);
  });

  it("only a live offering publishes a rule; draft + hidden emit nothing", () => {
    expect(
      deriveVirtualAvailability({ ...base, offerings: [offering({ status: "draft" })] }),
    ).toEqual([]);
    expect(
      deriveVirtualAvailability({ ...base, offerings: [offering({ status: "hidden" })] }),
    ).toEqual([]);
  });

  it("season start clips the window (season ∩ dateRange)", () => {
    const out = deriveVirtualAvailability({
      ...base,
      dateRange: RANGE,
      offerings: [
        offering({
          schedule: {
            seasonStart: "2026-07-05", // after the first Saturday
            seasonEnd: "2026-08-31",
            weekdays: [5],
            departureTimes: ["13:30"],
          },
        }),
      ],
    });
    expect(out.map((s) => s.date)).toEqual(["2026-07-11"]);
  });

  it("weekday mask drops an owned day the schedule doesn't run", () => {
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [
        offering({
          schedule: {
            seasonStart: "2026-06-01",
            seasonEnd: "2026-08-31",
            weekdays: [5, 6], // Sat + Sun, never Mon
            departureTimes: ["13:30"],
          },
        }),
      ],
    });
    expect(out.map((s) => s.date)).toEqual(["2026-07-04", "2026-07-05"]); // Mon dropped
  });

  it("an Offering.vesselId with no matching vessel row is silently skipped", () => {
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [offering({ vesselIds: [V, asId<"VesselId">("ghost-boat")] })],
    });
    // Only the real vessel yields slots; the unknown id can't be priced/capped → dropped.
    expect(out.every((s) => String(s.vesselId) === "vessel-brew-2")).toBe(true);
    expect(out.map((s) => s.date)).toEqual(["2026-07-04"]);
  });

  it("two live offerings on the same physical slot each emit a slot (no dedup; 12.1 guards materialization)", () => {
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [
        offering({ id: asId<"OfferingId">("off-a"), basePriceCents: 49900 }),
        offering({ id: asId<"OfferingId">("off-b"), basePriceCents: 59900 }),
      ],
    });
    // Same (vessel, 2026-07-04, 13:30) from both offerings → two slots, distinct offeringId.
    expect(out).toHaveLength(2);
    expect(out.map((s) => String(s.offeringId)).sort()).toEqual(["off-a", "off-b"]);
    expect(out.map((s) => s.priceCents).sort()).toEqual([49900, 59900]);
  });

  it("one slot per departure time × vessel", () => {
    const V2 = asId<"VesselId">("vessel-brew-3");
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [
        offering({ vesselIds: [V, V2], schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30", "17:00"] } }),
      ],
      vessels: [vessel(), vessel({ id: V2, coiMaxPax: 6 })],
    });
    // 1 date × 2 vessels × 2 times = 4 slots
    expect(out).toHaveLength(4);
    expect(out.filter((s) => String(s.vesselId) === "vessel-brew-3").every((s) => s.capacity === 6)).toBe(true);
  });
});

describe("deriveVirtualAvailability — the hull is busy (#615, #691)", () => {
  const trip = (over: Partial<Offering> = {}) =>
    offering({
      tripLengthMinutes: 100,
      schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30", "15:30"] },
      ...over,
    });
  const day = { ...base, offerings: [trip()], dateRange: ONE_SAT };

  it("hull-busy is `unavailable`, NOT `booked` — nobody bought this slot", () => {
    // The distinction is the operator's. `booked` means a reservation exists; the admin
    // calendar draws it as a card with the customer's name. A slot whose boat is merely out
    // on another trip has no reservation, and rendering it as `booked` put a phantom booking
    // on the calendar — two "Booked" cards on one boat where only one trip was sold.
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("x0", { source: "xola", date: "2026-07-04", time: "13:30" })],
    });
    expect(out.find((s) => s.time === "13:30")!.status).toBe("unavailable");
    // …and a REAL booking still reads `booked`.
    const real = deriveVirtualAvailability({
      ...day,
      events: [ev("m0", { date: "2026-07-04", time: "13:30", durationMinutes: 100 })],
      reservations: [res("r0", "m0")],
    });
    expect(real.find((s) => s.time === "13:30")!.status).toBe("booked");
  });

  it("an operator BLOCK outranks a busy hull — a blackout must not vanish (#694 review)", () => {
    // `unavailable` used to win, and the calendar hides those, so an operator block on a day
    // with an overlapping trip disappeared from the grid AND from the Blocked count. The
    // operator could not see their own blackout. A block is a deliberate act; it outranks a
    // fact about the boat.
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("xb", { source: "xola", date: "2026-07-04", time: "13:30" })],
      blocks: [
        {
          id: asId<"BlockId">("blk-day"),
          kind: "vessel",
          vesselId: V,
          startDate: "2026-07-04",
          endDate: "2026-07-04",
        },
      ],
    });
    // Every slot that day is blocked, including the one whose hull is also busy.
    expect(out.every((s) => s.status === "blocked")).toBe(true);
    expect(out.length).toBeGreaterThan(1);
  });

  it("a XOLA trip on the hull takes the slot off the market", () => {
    // The whole point of #615: an imported Xola booking was invisible to the funnel, so
    // Muster would happily sell a boat Xola had already sold.
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("x1", { source: "xola", date: "2026-07-04", time: "13:30" })],
    });
    const at1330 = out.find((s) => s.time === "13:30")!;
    expect(at1330.status).not.toBe("available");
    expect(out.find((s) => s.time === "15:30")!.status).toBe("available");
  });

  it("a Xola trip at 14:00 also takes out the 15:30 slot — overlap, not identity (#691)", () => {
    // 14:00 + 100min runs to 15:40, over the 15:30 departure. Different slot identity, so
    // the old exact-triple guard let this through.
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("x2", { source: "xola", date: "2026-07-04", time: "14:00" })],
    });
    expect(out.find((s) => s.time === "15:30")!.status).not.toBe("available");
  });

  it("a MUSTER booking blocks an overlapping slot too — same defect, either source", () => {
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("m1", { date: "2026-07-04", time: "14:00", durationMinutes: 100 })],
      reservations: [res("r1", "m1")],
    });
    expect(out.find((s) => s.time === "15:30")!.status).not.toBe("available");
  });

  it("a busy hull does not block the SAME offering on another vessel", () => {
    const V2 = asId<"VesselId">("vessel-brew-9");
    const out = deriveVirtualAvailability({
      ...day,
      offerings: [trip({ vesselIds: [V, V2] })],
      vessels: [vessel(), vessel({ id: V2 })],
      events: [ev("x3", { source: "xola", date: "2026-07-04", time: "13:30" })],
    });
    const at1330 = out.filter((s) => s.time === "13:30");
    expect(at1330.find((s) => String(s.vesselId) === "vessel-brew-9")!.status).toBe("available");
    expect(at1330.find((s) => String(s.vesselId) === String(V))!.status).not.toBe("available");
  });

  it("a CANCELLED Xola trip releases the boat", () => {
    const out = deriveVirtualAvailability({
      ...day,
      events: [ev("x4", { source: "xola", status: "cancelled", date: "2026-07-04", time: "13:30" })],
    });
    expect(out.find((s) => s.time === "13:30")!.status).toBe("available");
  });

  it("back-to-back departures still both sell", () => {
    // 13:30 and 15:30 on a 100-minute trip abut exactly (13:30–15:10, then 15:30). A closed
    // interval would refuse the operator's own schedule.
    const out = deriveVirtualAvailability(day);
    expect(out.filter((s) => s.status === "available")).toHaveLength(2);
  });
});

describe("deriveVirtualAvailability — price resolution (first match wins)", () => {
  const one = (over: Partial<Offering>) =>
    deriveVirtualAvailability({
      ...base,
      offerings: [offering(over)],
    })[0]!;

  it("weekday variation, flat cents", () => {
    expect(
      one({ priceVariations: [{ label: "Prime Sat", applies: { kind: "weekdays", weekdays: [5] }, adjustment: { kind: "flatCents", deltaCents: 10000 } }] }).priceCents,
    ).toBe(59900);
  });

  it("percent adjustment rounds to the cent", () => {
    expect(
      one({ priceVariations: [{ label: "Off-peak", applies: { kind: "weekdays", weekdays: [5] }, adjustment: { kind: "percent", percent: -20 } }] }).priceCents,
    ).toBe(39920); // 49900 × 0.8
  });

  it("earlier rule wins over a later one that also matches", () => {
    expect(
      one({
        priceVariations: [
          { label: "Holiday", applies: { kind: "date", date: "2026-07-04" }, adjustment: { kind: "flatCents", deltaCents: 10000 } },
          { label: "Any Sat", applies: { kind: "weekdays", weekdays: [5] }, adjustment: { kind: "flatCents", deltaCents: 50000 } },
        ],
      }).priceCents,
    ).toBe(59900); // first (Holiday) wins, not 99900
  });

  it("dateRange variation applies inside the span", () => {
    expect(
      one({ priceVariations: [{ label: "Peak week", applies: { kind: "dateRange", start: "2026-07-01", end: "2026-07-10" }, adjustment: { kind: "flatCents", deltaCents: 20000 } }] }).priceCents,
    ).toBe(69900);
  });

  it("no matching variation → the base fare", () => {
    expect(
      one({ priceVariations: [{ label: "Sundays", applies: { kind: "weekdays", weekdays: [6] }, adjustment: { kind: "flatCents", deltaCents: 10000 } }] }).priceCents,
    ).toBe(49900);
  });
});

describe("deriveVirtualAvailability — blocks subtract (DEC-125)", () => {
  it("vessel block (date range) darks its slots", () => {
    const out = deriveVirtualAvailability({
      ...base,
      dateRange: RANGE,
      blocks: [{ id: asId<"BlockId">("blk-v"), kind: "vessel", vesselId: V, startDate: "2026-07-04", endDate: "2026-07-04" }],
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("blocked");
    expect(out.find((s) => s.date === "2026-07-11")!.status).toBe("available");
  });

  it("location block darks slots in its time window, leaves others available", () => {
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [offering({ schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30", "17:00"] } })],
      blocks: [{ id: asId<"BlockId">("blk-l"), kind: "location", locationId: asId<"LocationId">("loc-dock"), date: "2026-07-04", startTime: "13:00", endTime: "14:00" }],
    });
    expect(out.find((s) => s.time === "13:30")!.status).toBe("blocked"); // in window
    expect(out.find((s) => s.time === "17:00")!.status).toBe("available"); // outside window
  });

  it("a location block at a DIFFERENT location doesn't touch this offering", () => {
    const out = deriveVirtualAvailability({
      ...base,
      blocks: [{ id: asId<"BlockId">("blk-l2"), kind: "location", locationId: asId<"LocationId">("loc-other"), date: "2026-07-04", startTime: "00:00", endTime: "23:59" }],
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("available");
  });

  it("vessel-hold darks exactly the held slot", () => {
    const out = deriveVirtualAvailability({
      ...base,
      dateRange: RANGE,
      blocks: [{ id: asId<"BlockId">("blk-h"), kind: "vesselHold", vesselId: V, date: "2026-07-04", time: "13:30" }],
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("blocked");
    expect(out.find((s) => s.date === "2026-07-11")!.status).toBe("available");
  });
});

describe("deriveVirtualAvailability — materialized events overlay (DEC-125 precedence)", () => {
  it("a per-departure override wins price + capacity and stays available", () => {
    const override = ev("evt-x", { time: "13:30", capacity: 8, price: 60000 });
    const slot = deriveVirtualAvailability({
      ...base,
      events: [override],
    })[0]!;
    expect(slot.status).toBe("available");
    expect(slot.capacity).toBe(8);
    expect(slot.priceCents).toBe(60000);
    expect(String(slot.eventId)).toBe("evt-x");
  });

  it("a booked slot is frozen 'booked'", () => {
    const booked = ev("evt-b", { time: "13:30" });
    const slot = deriveVirtualAvailability({
      ...base,
      events: [booked],
      reservations: [res("r1", "evt-b")], // active muster claim
    })[0]!;
    expect(slot.status).toBe("booked");
    expect(String(slot.eventId)).toBe("evt-b");
  });

  it("a cancelled reservation on the materialized event leaves the slot available", () => {
    const e = ev("evt-c", { time: "13:30" });
    const slot = deriveVirtualAvailability({
      ...base,
      events: [e],
      reservations: [res("r1", "evt-c", { status: "cancelled" })],
    })[0]!;
    expect(slot.status).toBe("available");
  });

  it("committed state beats a block — you can't block away a booking", () => {
    const booked = ev("evt-f", { time: "13:30" });
    const slot = deriveVirtualAvailability({
      ...base,
      events: [booked],
      reservations: [res("r1", "evt-f")],
      blocks: [{ id: asId<"BlockId">("blk-v"), kind: "vessel", vesselId: V, startDate: "2026-07-04", endDate: "2026-07-04" }],
    })[0]!;
    expect(slot.status).toBe("booked"); // not "blocked"
  });

  it("a Xola event occupies the hull but never becomes the Muster slot's event", () => {
    // Two halves, and #615 inverted one of them. A Xola event must never overlay a Muster
    // slot's IDENTITY — its money lives in Xola (DEC-105) and it must not be sold or mutated
    // through the Muster funnel, so `eventId` stays undefined. But it does occupy the boat,
    // and this test used to assert the slot stayed `available` — encoding the double-sell as
    // the contract. It was green the whole time.
    const xola = ev("evt-xola", { time: "13:30", source: "xola" });
    const slot = deriveVirtualAvailability({
      ...base,
      events: [xola],
    })[0]!;
    expect(slot.eventId).toBeUndefined(); // still purely virtual — not Muster's to sell
    expect(slot.status).toBe("unavailable"); // …but the hull is taken
  });
});

describe("deriveVirtualAvailability — checkout holds (12.1, DEC-109)", () => {
  const hold = (over: Partial<CheckoutHold> = {}): CheckoutHold => ({
    id: asId<"CheckoutHoldId">("hold-1"),
    vesselId: V,
    date: "2026-07-04",
    time: "13:30",
    source: "muster",
    offeringId: asId<"OfferingId">("off-1"),
    guestCount: 4,
    expiresAt: "2026-07-04T12:15:00.000Z",
    createdAt: "2026-07-04T12:00:00.000Z",
    ...over,
  });
  const sat0704 = { ...base };

  it("a live hold (expiresAt > asOf) marks the slot 'held'", () => {
    const out = deriveVirtualAvailability({
      ...sat0704,
      holds: [hold()],
      asOf: "2026-07-04T12:10:00.000Z", // before 12:15 expiry
    });
    expect(out[0]!.status).toBe("held");
  });

  it("an EXPIRED hold contributes nothing — slot reads available (lazy-on-read, no cron)", () => {
    const out = deriveVirtualAvailability({
      ...sat0704,
      holds: [hold()],
      asOf: "2026-07-04T12:20:00.000Z", // after 12:15 expiry
    });
    expect(out[0]!.status).toBe("available");
  });

  it("no asOf ⇒ holds are ignored (conservative; the write CAS still guards)", () => {
    const out = deriveVirtualAvailability({ ...sat0704, holds: [hold()] });
    expect(out[0]!.status).toBe("available");
  });

  it("a booked Event outranks a live hold on the same slot", () => {
    const out = deriveVirtualAvailability({
      ...sat0704,
      events: [ev("evt-b", { time: "13:30" })],
      reservations: [res("r1", "evt-b")],
      holds: [hold()],
      asOf: "2026-07-04T12:10:00.000Z",
    });
    expect(out[0]!.status).toBe("booked");
  });

  it("a block outranks a live hold on the same slot", () => {
    const out = deriveVirtualAvailability({
      ...sat0704,
      blocks: [{ id: asId<"BlockId">("blk"), kind: "vesselHold", vesselId: V, date: "2026-07-04", time: "13:30" }],
      holds: [hold()],
      asOf: "2026-07-04T12:10:00.000Z",
    });
    expect(out[0]!.status).toBe("blocked");
  });

  it("a hold on a DIFFERENT slot doesn't touch this one", () => {
    const out = deriveVirtualAvailability({
      ...base,
      dateRange: RANGE,
      holds: [hold({ date: "2026-07-11" })],
      asOf: "2026-07-04T12:10:00.000Z",
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("available");
    expect(out.find((s) => s.date === "2026-07-11")!.status).toBe("held");
  });
});

describe("isSlotBlocked — shared block predicate", () => {
  const L = "loc-dock";
  it("vesselHold matches exact slot only", () => {
    const blocks: Block[] = [{ id: asId<"BlockId">("b"), kind: "vesselHold", vesselId: V, date: "2026-07-04", time: "13:30" }];
    expect(isSlotBlocked(blocks, L, V, "2026-07-04", "13:30")).toBe(true);
    expect(isSlotBlocked(blocks, L, V, "2026-07-04", "17:00")).toBe(false);
  });
  it("vessel block covers its inclusive date range", () => {
    const blocks: Block[] = [{ id: asId<"BlockId">("b"), kind: "vessel", vesselId: V, startDate: "2026-07-04", endDate: "2026-07-06" }];
    expect(isSlotBlocked(blocks, L, V, "2026-07-05", "13:30")).toBe(true);
    expect(isSlotBlocked(blocks, L, V, "2026-07-07", "13:30")).toBe(false);
  });
  it("location block covers its time window at its location", () => {
    const blocks: Block[] = [{ id: asId<"BlockId">("b"), kind: "location", locationId: asId<"LocationId">("loc-dock"), date: "2026-07-04", startTime: "13:00", endTime: "14:00" }];
    expect(isSlotBlocked(blocks, "loc-dock", V, "2026-07-04", "13:30")).toBe(true);
    expect(isSlotBlocked(blocks, "loc-dock", V, "2026-07-04", "15:00")).toBe(false);
    expect(isSlotBlocked(blocks, "loc-other", V, "2026-07-04", "13:30")).toBe(false);
  });
});

describe("slot-identity helpers — the 12.1 guardrail contract", () => {
  it("slotIdentity is vessel|date|time", () => {
    expect(slotIdentity(V, "2026-07-04", "13:30")).toBe("vessel-brew-2|2026-07-04|13:30");
  });

  it("eventIdForSlot is deterministic and slot-derived", () => {
    expect(String(eventIdForSlot(V, "2026-07-04", "13:30"))).toBe("slot_vessel-brew-2|2026-07-04|13:30");
    expect(eventIdForSlot(V, "2026-07-04", "13:30")).toBe(eventIdForSlot(V, "2026-07-04", "13:30"));
  });
});
