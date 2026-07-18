/**
 * Availability read model (11.1) — whole-boat mutex, DEC-108/109 amended.
 */
import { describe, expect, it } from "vitest";
import type {
  Block,
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

const owned = (date: string, vesselId = V) => ({ vesselId, date });
const RANGE = { start: "2026-07-01", end: "2026-07-15" };

/** Both Saturdays owned, no blocks/events — the happy baseline; override per test. */
const base = {
  offerings: [offering()],
  vessels: [vessel()],
  dateRange: RANGE,
  ownedDays: [owned("2026-07-04"), owned("2026-07-11")],
  blocks: [] as Block[],
  events: [] as Event[],
  reservations: [] as Reservation[],
};

describe("deriveVirtualAvailability — the DEC-125 grid", () => {
  it("enumerates schedule × vessels × dates ∩ season, all available on empty state", () => {
    const out = deriveVirtualAvailability(base);
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

  it("owned-day mask: an unmarked (Xola-owned) vessel-day yields no slot (DEC-106)", () => {
    const out = deriveVirtualAvailability({ ...base, ownedDays: [owned("2026-07-04")] });
    expect(out.map((s) => s.date)).toEqual(["2026-07-04"]); // 07-11 not owned → gone
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
      ownedDays: [owned("2026-07-04"), owned("2026-07-05"), owned("2026-07-06")], // Sat, Sun, Mon
    });
    expect(out.map((s) => s.date)).toEqual(["2026-07-04", "2026-07-05"]); // Mon dropped
  });

  it("one slot per departure time × vessel", () => {
    const V2 = asId<"VesselId">("vessel-brew-3");
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [
        offering({ vesselIds: [V, V2], schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30", "17:00"] } }),
      ],
      vessels: [vessel(), vessel({ id: V2, coiMaxPax: 6 })],
      ownedDays: [owned("2026-07-04"), owned("2026-07-04", V2)],
    });
    // 1 date × 2 vessels × 2 times = 4 slots
    expect(out).toHaveLength(4);
    expect(out.filter((s) => String(s.vesselId) === "vessel-brew-3").every((s) => s.capacity === 6)).toBe(true);
  });
});

describe("deriveVirtualAvailability — price resolution (first match wins)", () => {
  const one = (over: Partial<Offering>) =>
    deriveVirtualAvailability({
      ...base,
      ownedDays: [owned("2026-07-04")],
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
      blocks: [{ id: asId<"BlockId">("blk-v"), kind: "vessel", vesselId: V, startDate: "2026-07-04", endDate: "2026-07-04" }],
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("blocked");
    expect(out.find((s) => s.date === "2026-07-11")!.status).toBe("available");
  });

  it("location block darks slots in its time window, leaves others available", () => {
    const out = deriveVirtualAvailability({
      ...base,
      offerings: [offering({ schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: ["13:30", "17:00"] } })],
      ownedDays: [owned("2026-07-04")],
      blocks: [{ id: asId<"BlockId">("blk-l"), kind: "location", locationId: asId<"LocationId">("loc-dock"), date: "2026-07-04", startTime: "13:00", endTime: "14:00" }],
    });
    expect(out.find((s) => s.time === "13:30")!.status).toBe("blocked"); // in window
    expect(out.find((s) => s.time === "17:00")!.status).toBe("available"); // outside window
  });

  it("a location block at a DIFFERENT location doesn't touch this offering", () => {
    const out = deriveVirtualAvailability({
      ...base,
      ownedDays: [owned("2026-07-04")],
      blocks: [{ id: asId<"BlockId">("blk-l2"), kind: "location", locationId: asId<"LocationId">("loc-other"), date: "2026-07-04", startTime: "00:00", endTime: "23:59" }],
    });
    expect(out.find((s) => s.date === "2026-07-04")!.status).toBe("available");
  });

  it("vessel-hold darks exactly the held slot", () => {
    const out = deriveVirtualAvailability({
      ...base,
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
      ownedDays: [owned("2026-07-04")],
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
      ownedDays: [owned("2026-07-04")],
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
      ownedDays: [owned("2026-07-04")],
      events: [e],
      reservations: [res("r1", "evt-c", { status: "cancelled" })],
    })[0]!;
    expect(slot.status).toBe("available");
  });

  it("committed state beats a block — you can't block away a booking", () => {
    const booked = ev("evt-f", { time: "13:30" });
    const slot = deriveVirtualAvailability({
      ...base,
      ownedDays: [owned("2026-07-04")],
      events: [booked],
      reservations: [res("r1", "evt-f")],
      blocks: [{ id: asId<"BlockId">("blk-v"), kind: "vessel", vesselId: V, startDate: "2026-07-04", endDate: "2026-07-04" }],
    })[0]!;
    expect(slot.status).toBe("booked"); // not "blocked"
  });

  it("a Xola-owned event never overlays a Muster slot", () => {
    const xola = ev("evt-xola", { time: "13:30", source: "xola" });
    const slot = deriveVirtualAvailability({
      ...base,
      ownedDays: [owned("2026-07-04")],
      events: [xola],
    })[0]!;
    expect(slot.eventId).toBeUndefined(); // stays purely virtual
    expect(slot.status).toBe("available");
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
