/**
 * Pure builder for the `db:seed:reservation` dev fixture (task 12.10) — a self-contained
 * reservation world so the /admin/blocks impact numbers show something real when hand-testing:
 * a live Offering (so virtual slots exist), the owned-day mask that lets them emit, and a
 * couple of MATERIALIZED bookings (Event + booked Reservation) at KNOWN slots — so a block
 * drawn over that window shows a non-zero "removes N" AND a non-zero booked-trip conflict.
 *
 * Side-effect-free (no repo, no clock): the caller supplies today, the runnable script
 * (`db/seed-reservation-dev.ts`) persists the world, and the drift test
 * (`seed-reservation.test.ts`) asserts the deriver still sees the bookings. Deterministic ids
 * ⇒ idempotent re-seed **within a day**.
 *
 * **Dates are RELATIVE to today (#646), and that is load-bearing rather than tidy.** They used
 * to be literals — Aug 10–16 2026 — with a comment saying fixed dates let the e2e type them
 * verbatim. That was true and it gave every reservations spec a shelf life. `book-availability`'s
 * paging test needs `/book`'s default month (today's) to be **empty** and the seeded month to be
 * reachable by paging **forward**; both premises died the day today reached August 2026, and
 * since the loop only walks forward the window then became unreachable in either direction. The
 * failure was worse than a red test: the loop raced a link navigation and usually broke out on
 * iteration 0 against the page it never left, so the spec passed while verifying nothing.
 *
 * The window therefore sits on the **10th–16th of next month**, always. Same seven-day shape as
 * before, never the current month, always ahead of today, and every offset is ≤15 so it fits
 * inside even February.
 *
 * **Caveat, stated rather than papered over:** the seed script and the e2e process each compute
 * "today" independently, so a run that crosses vessel-local midnight can disagree about which
 * month is next. Anchoring on the month (not a day offset) narrows that to the final midnight of
 * a month. It is not zero.
 */
import type { Event, Location, Offering, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";
import { eventIdForSlot } from "./availability.js";

export interface ReservationDemoBooking {
  date: string;
  time: string;
  customerName: string;
  partySize: number;
  priceCents: number;
  phone: string;
}

export interface ReservationDemo {
  locationId: string;
  offeringId: string;
  vesselId: string;
  vesselName: string;
  season: { start: string; end: string };
  departureTimes: readonly string[];
  /** Inclusive owned-day range — the offering emits virtual slots only where owned. */
  ownedRange: { start: string; end: string };
  /** The materialized bookings, at known slots inside the owned range. */
  bookings: readonly ReservationDemoBooking[];
  /** A vessel-block window overlapping exactly the FIRST TWO bookings. */
  vesselBlockWindow: { start: string; end: string };
  /** A location-block window overlapping ONLY the first booking. */
  locationBlockWindow: { date: string; startTime: string; endTime: string };
}

/** `yyyy-mm-01` of the month after `todayISO`'s. December rolls the year. */
function firstOfNextMonth(todayISO: string): string {
  const y = Number(todayISO.slice(0, 4));
  const m = Number(todayISO.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** `yyyy-mm-dd` + n days, UTC-midnight math (same idiom as {@link eachDay}). */
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The demo world's dates and identities for a given vessel-local `todayISO`.
 *
 * Pure — call it with the same day and get the same answer. The one clock read lives in the
 * callers that legitimately have one (`db/seed-reservation-dev.ts`, `e2e/reservation-demo.ts`);
 * the core stays clock-free.
 */
export function reservationDemo(todayISO: string): ReservationDemo {
  // Day 0 = the 1st of next month, so `+9` is the 10th. Offsets, not literals, so the shape
  // survives every month length and the year roll.
  const anchor = firstOfNextMonth(todayISO);
  const day = (n: number) => addDays(anchor, n);

  return {
    locationId: "location-reservation-demo",
    offeringId: "offering-reservation-demo",
    /** A fleet boat (seeded by seedFleet — cap 12). */
    vesselId: "vessel-brew-3",
    vesselName: "Brew 3",
    // Wide enough to contain the window whichever month it lands in, including the December
    // roll into next year.
    season: { start: `${todayISO.slice(0, 4)}-01-01`, end: `${Number(anchor.slice(0, 4)) + 1}-12-31` },
    departureTimes: ["13:30", "15:30", "17:30"],
    ownedRange: { start: day(9), end: day(15) }, // the 10th … the 16th
    bookings: [
      { date: day(11), time: "13:30", customerName: "Marcus Webb", partySize: 8, priceCents: 54900, phone: "216-555-0148" },
      { date: day(12), time: "15:30", customerName: "Dana Cho", partySize: 6, priceCents: 43900, phone: "(440) 555-0102" },
      // Marcus again — same phone, different spelling of the number. Makes the customers tab
      // demoable (a repeat guest with history + lifetime value) and exercises canonicalization.
      // Deliberately OUTSIDE `vesselBlockWindow` so the block-impact fixture, which asserts an
      // exact conflict count and dollar total, keeps meaning what it says.
      { date: day(15), time: "13:30", customerName: "Marcus Webb", partySize: 10, priceCents: 54900, phone: "+1 216 555 0148" },
    ],
    vesselBlockWindow: { start: day(10), end: day(13) }, // the 11th … the 14th
    locationBlockWindow: { date: day(11), startTime: "13:00", endTime: "16:00" },
  };
}

export interface SeededReservationWorld {
  location: Location;
  offering: Offering;
  ownedDays: { vesselId: VesselId; date: string }[];
  events: Event[];
  reservations: Reservation[];
}

/** Inclusive `yyyy-mm-dd` day list. */
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${start}T00:00:00Z`); ms <= Date.parse(`${end}T00:00:00Z`); ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/** Build the demo world. `createdAt` and `demo` are injected to keep the builder clock-free. */
export function buildSeededReservationWorld(
  createdAt: string,
  demo: ReservationDemo,
): SeededReservationWorld {
  const V = asId<"VesselId">(demo.vesselId);

  const location: Location = {
    id: asId<"LocationId">(demo.locationId),
    name: "Reservation Demo Dock",
    pickupDescription: "Demo pickup — Flats East Bank",
    routeDescription: "Demo route — up the Cuyahoga and back",
  };

  const offering: Offering = {
    id: asId<"OfferingId">(demo.offeringId),
    tenantId: asId<"TenantId">("tenant-brewboat"),
    name: "Reservation Demo Cruise",
    status: "live",
    vesselIds: [V],
    locationId: location.id,
    schedule: {
      seasonStart: demo.season.start,
      seasonEnd: demo.season.end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      departureTimes: [...demo.departureTimes],
    },
    basePriceCents: 49900,
    priceVariations: [],
    extraGuestPriceCents: 5000,
  };

  const ownedDays = eachDay(demo.ownedRange.start, demo.ownedRange.end).map((date) => ({
    vesselId: V,
    date,
  }));

  const events: Event[] = [];
  const reservations: Reservation[] = [];
  for (const b of demo.bookings) {
    const eventId = eventIdForSlot(V, b.date, b.time);
    events.push({
      id: eventId,
      vesselId: V,
      date: b.date,
      time: b.time,
      capacity: 12,
      status: "scheduled",
      source: "muster",
      price: b.priceCents,
    });
    reservations.push({
      id: asId<"ReservationId">(demoReservationId(b.date, b.time)),
      eventId,
      source: "muster",
      customerName: b.customerName,
      partySize: b.partySize,
      phone: b.phone,
      status: "booked",
      updatedAt: createdAt,
    });
  }

  return { location, offering, ownedDays, events, reservations };
}

/**
 * The seeded reservation's id for a slot. Exported because the e2e types these into URLs
 * (`/admin/calendar/<id>`, the manage link) and hand-spelling the format in six specs is how
 * it drifts — the dates inside it move now.
 */
export function demoReservationId(date: string, time: string): string {
  return `resv-demo-${date}-${time}`;
}
