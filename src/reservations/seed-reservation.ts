/**
 * Pure builder for the `db:seed:reservation` dev fixture (task 12.10) — a self-contained
 * reservation world so the /admin/blocks impact numbers show something real when hand-testing:
 * a live Offering (so virtual slots exist), the owned-day mask that lets them emit, and a
 * couple of MATERIALIZED bookings (Event + booked Reservation) at KNOWN slots — so a block
 * drawn over that window shows a non-zero "removes N" AND a non-zero booked-trip conflict.
 *
 * Side-effect-free (no repo, no clock): the runnable script (`db/seed-reservation-dev.ts`)
 * persists the world, and the drift test (`seed-reservation.test.ts`) asserts the deriver still
 * sees the bookings. Deterministic ids ⇒ idempotent re-seed. FIXED dates (not relative to
 * today) so the e2e can type them verbatim — they sit inside a full-year season, so "past vs
 * upcoming" greying is the only thing today affects, never the impact math.
 */
import type { Event, Location, Offering, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";
import { eventIdForSlot } from "./availability.js";

// ── The fixed demo world (exported so the e2e types the exact same dates) ──────
export const RESERVATION_DEMO = {
  locationId: "location-reservation-demo",
  offeringId: "offering-reservation-demo",
  /** A fleet boat (seeded by seedFleet — cap 12). */
  vesselId: "vessel-brew-3",
  vesselName: "Brew 3",
  season: { start: "2026-01-01", end: "2026-12-31" },
  departureTimes: ["13:30", "15:30", "17:30"],
  /** Inclusive owned-day range — the offering emits virtual slots only where owned. */
  ownedRange: { start: "2026-08-10", end: "2026-08-16" },
  /** The two materialized bookings, at known slots inside the owned range. */
  bookings: [
    { date: "2026-08-12", time: "13:30", customerName: "Marcus Webb", partySize: 8, priceCents: 54900 },
    { date: "2026-08-13", time: "15:30", customerName: "Dana Cho", partySize: 6, priceCents: 43900 },
  ],
  /** A convenient vessel-block window that overlaps BOTH bookings (Aug 11–14). */
  vesselBlockWindow: { start: "2026-08-11", end: "2026-08-14" },
  /** A convenient location-block window overlapping ONLY the first booking (Aug 12, 13:00–16:00). */
  locationBlockWindow: { date: "2026-08-12", startTime: "13:00", endTime: "16:00" },
} as const;

const V = asId<"VesselId">(RESERVATION_DEMO.vesselId);

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

/** Build the demo world. `createdAt` is injected to keep the builder clock-free. */
export function buildSeededReservationWorld(createdAt: string): SeededReservationWorld {
  const location: Location = {
    id: asId<"LocationId">(RESERVATION_DEMO.locationId),
    name: "Reservation Demo Dock",
    pickupDescription: "Demo pickup — Flats East Bank",
    routeDescription: "Demo route — up the Cuyahoga and back",
  };

  const offering: Offering = {
    id: asId<"OfferingId">(RESERVATION_DEMO.offeringId),
    tenantId: asId<"TenantId">("tenant-brewboat"),
    name: "Reservation Demo Cruise",
    status: "live",
    vesselIds: [V],
    locationId: location.id,
    schedule: {
      seasonStart: RESERVATION_DEMO.season.start,
      seasonEnd: RESERVATION_DEMO.season.end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      departureTimes: [...RESERVATION_DEMO.departureTimes],
    },
    basePriceCents: 49900,
    priceVariations: [],
    extraGuestPriceCents: 5000,
  };

  const ownedDays = eachDay(RESERVATION_DEMO.ownedRange.start, RESERVATION_DEMO.ownedRange.end).map(
    (date) => ({ vesselId: V, date }),
  );

  const events: Event[] = [];
  const reservations: Reservation[] = [];
  for (const b of RESERVATION_DEMO.bookings) {
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
      id: asId<"ReservationId">(`resv-demo-${b.date}-${b.time}`),
      eventId,
      source: "muster",
      customerName: b.customerName,
      partySize: b.partySize,
      status: "booked",
      updatedAt: createdAt,
    });
  }

  return { location, offering, ownedDays, events, reservations };
}
