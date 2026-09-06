/**
 * Pure builder for the `db:seed:xola` fixture — a SYNTHETIC Xola import.
 *
 * **Why this exists.** Every Xola-shaped bug this project has hit reached the operator's screen
 * rather than a red test, because the test suite had no `source='xola'` data at all: not one
 * imported trip, so not one assertion about what the calendar or the sell funnel does with one.
 * In a single session that cost three separate regressions — the sell funnel ignoring imported
 * bookings (#615), the calendar rendering every occupied hull as free, and imported trips drawn
 * as anonymous "Booked" blocks with no customer.
 *
 * The `db:seed:overlap` tool works against a REAL import, which needs API access and returns
 * different data every pull. That is the right tool for exploring the operator's actual data and
 * the wrong one for CI. This builder needs no API and no network: it produces the same world
 * every time, deliberately containing every case that has bitten.
 *
 * **Composes with `reservationDemo`.** Its trips land on that offering's window and vessel, so
 * the interaction between an import and a live Muster offering is what gets exercised — which is
 * the whole point. Seed `reservation` first, then this.
 *
 * **Dates are RELATIVE to today**, for the reason `seed-reservation.ts` spells out at length: a
 * fixture with literal dates has a shelf life, and when it expires the tests do not go red, they
 * go meaningless. Same anchor as the demo world: these days derive from `demo.window.start`, so
 * they follow it wherever it moves rather than restating a literal that can drift.
 */
import type { Event, Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { reservationDemo } from "./seed-reservation.js";

/** A vessel Muster knows about but NO offering sells — the #700 blind spot, on purpose. */
export const UNCOVERED_VESSEL: Vessel = {
  id: asId<"VesselId">("vessel-xola-only"),
  name: "Xola Only",
  coiMaxPax: 10,
  manning: [],
};

/** One synthetic imported trip, and what it is here to prove. */
export interface XolaFixtureTrip {
  vesselId: string;
  date: string;
  /** "HH:MM", vessel-local. */
  time: string;
  customerName: string;
  phone: string;
  partySize: number;
  /** `cancelled` trips must NOT occupy the hull — the importer writes that when a trip empties. */
  cancelled?: boolean;
  /** Why this row is in the fixture. Read it before deleting one. */
  why: string;
}

export interface XolaFixture {
  /** The vessel the fixture needs beyond the standard fleet. */
  extraVessel: Vessel;
  /**
   * A SECOND live offering on the same boat as the demo cruise, at **14:00 for one hour** —
   * deliberately NOT one of the demo's departure times.
   *
   * This is the Muster-vs-Muster overlap, in the fixture rather than hand-built: 14:00–15:00 sits
   * inside the demo's 13:30 trip (100 minutes, to 15:10). Two offerings, two slot identities, one
   * hull — the #691 shape, reachable without an import.
   *
   * NB two VIRTUAL slots do not block each other; only a materialized trip occupies a hull. So on
   * a day with no booking both read open and either can be sold — and the first sale takes the
   * other out. That is the real-world scenario, and it is why this offering exists at a different
   * time rather than a duplicate one.
   *
   * The duplicate-at-the-same-time case (what the dedupe and badge assertions need) comes from
   * the demo and fleet offerings both selling Brew 3 at 13:30 on the window's first day.
   */
  secondOffering: Offering;
  /**
   * The realistic one: five departures a day on all four Brew boats, running from the 1st of the
   * CURRENT month and STOPPING where the contrived week begins. The other two offerings exist to
   * make specific bugs reachable; this one exists so the operator can look at a calendar that
   * resembles the business — a month with a full schedule on it.
   *
   * Ending it at the window start keeps the two apart: a full realistic month to look at, then a
   * week where every day is one deliberate case and nothing else is in the way.
   */
  fleetOffering: Offering;
  trips: XolaFixtureTrip[];
  /** Convenience handles the specs assert against, so they never re-derive a date. */
  days: {
    /** Xola sits exactly on a Muster departure time — that slot must go unsellable (#615). */
    onGrid: string;
    /** Xola OVERLAPS a Muster departure without matching it — the #691 shape, from the import side. */
    overlapping: string;
    /** Xola at a time, and on a boat, no offering schedules — invisible to the calendar (#700). */
    invisible: string;
    /** No imported trips at all — the control. Everything must read open. */
    clean: string;
    /** Two trips, one customer, phone spelled two ways — customer resolution must collapse them. */
    repeatGuest: string;
    /** A CANCELLED import — must not occupy the hull. */
    cancelled: string;
  };
}

/**
 * Build the fixture for a given vessel-local `todayISO`. Pure — no clock, no repo, no network.
 *
 * The demo offering (`reservationDemo`) runs 13:30 / 15:30 / 17:30 on Brew 3 across its window
 * late in next month, with no `tripLengthMinutes`, so its trips are measured at the standing 100.
 * Every choice below is made against those numbers.
 */
export function xolaFixture(todayISO: string): XolaFixture {
  const demo = reservationDemo(todayISO);
  const d = (n: number) => {
    const ms = Date.parse(`${demo.window.start}T00:00:00Z`) + n * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  };
  const BOAT = demo.vesselId; // Brew 3 — the boat the demo offering sells

  // The demo world books offsets +2, +3 and +6 of its own window, so the fixture uses the four
  // free days and doubles up where the scenarios cannot interfere. Sharing a day is deliberate,
  // not crowding: the 09:00 and uncovered-boat trips cannot touch a 13:30 assertion, and the
  // cancelled 15:30 sits in a gap both repeat-guest trips leave open.
  const days = {
    onGrid: d(0),
    invisible: d(0),
    overlapping: d(1),
    repeatGuest: d(4),
    cancelled: d(4),
    clean: d(5),
  };

  // The 1st of the month `todayISO` falls in — relative, so the fixture never goes stale, and
  // wide enough that the calendar has a real month of schedule before the contrived week.
  const firstOfThisMonth = `${todayISO.slice(0, 7)}-01`;
  const fleetOffering: Offering = {
    id: asId<"OfferingId">("offering-xola-fixture-fleet"),
    tenantId: asId<"TenantId">("tenant-brewboat"),
    name: "Brewboat Cruise",
    status: "live",
    vesselIds: [
      asId<"VesselId">("vessel-brew-1"),
      asId<"VesselId">("vessel-brew-2"),
      asId<"VesselId">("vessel-brew-3"),
      asId<"VesselId">("vessel-brew-4"),
    ],
    locationId: asId<"LocationId">(demo.locationId),
    schedule: {
      seasonStart: firstOfThisMonth,
      // Stops where the contrived week starts, so the fixture's days stay legible.
      seasonEnd: days.onGrid,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      departureTimes: ["11:30", "13:30", "15:30", "17:30", "19:30"],
    },
    basePriceCents: 49900,
    priceVariations: [],
    // 100 minutes on the water — the real trip length, and the number every overlap in this
    // fixture is reasoned against.
    tripLengthMinutes: 100,
    extraGuestPriceCents: 5000,
  };

  const secondOffering: Offering = {
    id: asId<"OfferingId">("offering-xola-fixture-second"),
    tenantId: asId<"TenantId">("tenant-brewboat"),
    name: "Second Cruise",
    status: "live",
    vesselIds: [asId<"VesselId">(BOAT)],
    locationId: asId<"LocationId">(demo.locationId),
    schedule: {
      seasonStart: demo.season.start,
      seasonEnd: demo.season.end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      departureTimes: ["14:00"],
    },
    basePriceCents: 59900,
    priceVariations: [],
    tripLengthMinutes: 60,
    extraGuestPriceCents: 5000,
  };

  return {
    extraVessel: UNCOVERED_VESSEL,
    secondOffering,
    fleetOffering,
    days,
    trips: [
      {
        vesselId: BOAT,
        date: days.onGrid,
        time: "13:30",
        customerName: "Priya Raman",
        phone: "216-555-0101",
        partySize: 8,
        why: "Sits exactly on a Muster departure. That slot must read sold out, and the calendar must draw THIS trip with Priya's name (#615).",
      },
      {
        vesselId: BOAT,
        date: days.overlapping,
        time: "14:00",
        customerName: "Dev Okonkwo",
        phone: "216-555-0102",
        partySize: 6,
        why: "14:00 + 100min runs to 15:40, over the 15:30 departure — a DIFFERENT slot identity. The exact-triple guard missed this shape (#691). 13:30 must also go, since 13:30 + 100 reaches 15:10.",
      },
      {
        vesselId: BOAT,
        date: days.invisible,
        time: "09:00",
        customerName: "Marta Feld",
        phone: "216-555-0103",
        partySize: 4,
        why: "No offering schedules 09:00, so the calendar's offering grid cannot draw it — the boat reads free while it is out (#700).",
      },
      {
        vesselId: String(UNCOVERED_VESSEL.id),
        date: days.invisible,
        time: "13:00",
        customerName: "Sam Iyer",
        phone: "216-555-0104",
        partySize: 5,
        why: "A boat no offering covers at all. It has no column and no slots, so nothing about it can ever surface (#700).",
      },
      {
        vesselId: BOAT,
        date: days.repeatGuest,
        time: "13:30",
        customerName: "Nora Blake",
        phone: "216-555-0155",
        partySize: 2,
        why: "Repeat guest, first trip. Pairs with the next row. Runs to 15:10, so it leaves 15:30 open — which is where the cancelled row sits.",
      },
      {
        vesselId: BOAT,
        date: days.repeatGuest,
        time: "17:30",
        customerName: "Nora Blake",
        phone: "(216) 555-0155",
        partySize: 3,
        why: "Same phone, spelled differently. Customer resolution must collapse these to ONE customer — the property the importer does not yet honour (#701).",
      },
      {
        vesselId: BOAT,
        date: days.cancelled,
        time: "15:30",
        customerName: "Gone Away",
        phone: "216-555-0106",
        partySize: 2,
        cancelled: true,
        why: "A cancelled import releases the boat. If this ever blocks a slot, the hull check is treating a dead trip as live.",
      },
    ],
  };
}

/** Deterministic id for a fixture trip — stable across re-seeds within a day. */
export function xolaEventId(vesselId: string, date: string, time: string): string {
  return `xola-${vesselId}-${date}-${time.replace(":", "")}`;
}

export interface SeededXolaWorld {
  extraVessel: Vessel;
  events: Event[];
  reservations: Reservation[];
}

/**
 * Materialize the fixture. `source: 'xola'` throughout — the importer structurally only ever
 * writes Xola-owned rows (DEC-106), and a fixture that wrote anything else would be describing
 * a state the import path cannot produce.
 *
 * No `durationMinutes`: real imports carry none, which is precisely why `XOLA_TRIP_MINUTES`
 * exists as the standing fallback. Setting one here would hide that.
 */
export function buildSeededXolaWorld(createdAt: string, fx: XolaFixture): SeededXolaWorld {
  const events: Event[] = [];
  const reservations: Reservation[] = [];

  for (const t of fx.trips) {
    const id = xolaEventId(t.vesselId, t.date, t.time);
    events.push({
      id: asId<"EventId">(id),
      vesselId: asId<"VesselId">(t.vesselId),
      date: t.date,
      time: t.time,
      capacity: 12,
      status: t.cancelled ? "cancelled" : "scheduled",
      source: "xola",
    });
    reservations.push({
      id: asId<"ReservationId">(`resv-${id}`),
      eventId: asId<"EventId">(id),
      source: "xola",
      customerName: t.customerName,
      partySize: t.partySize,
      phone: t.phone,
      status: t.cancelled ? "cancelled" : "booked",
      updatedAt: createdAt,
    });
  }

  return { extraVessel: fx.extraVessel, events, reservations };
}
