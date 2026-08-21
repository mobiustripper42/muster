/**
 * Pure builder for the `db:seed:reservation` dev fixture (task 12.10) — a self-contained
 * reservation world so the /admin/blocks impact numbers show something real when hand-testing:
 * a live Offering whose season IS the demo window (so virtual slots exist across it), and a
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
 * **The SEASON is wider than the window since #797** — it starts today. The window scopes the
 * demo (bookings, block fixtures, every pinned figure); the season only decides where virtual
 * slots may emit. They were the same range under #688 and are not any more, so read the two as
 * separate things: a slot near today is bookable, but nothing is *booked* there.
 *
 * Today's month therefore has bookable slots where it had none. **#797 claimed that broke the
 * forward-paging test in `book-availability.spec.ts` and filed issue #804 for it. Both were
 * wrong** — that test asserts a prompt which renders whenever no date is selected, and a month
 * LABEL one page ahead; neither depends on the current month being empty. CI proved it green on
 * the branch that widened the season (PR #805, `e2e` 25m47s). The claim was made from the test's
 * title and its comments rather than from its assertions.
 *
 * **Caveat, stated rather than papered over:** the seed script and the e2e process each compute
 * "today" independently, so a run that crosses vessel-local midnight can disagree about which
 * month is next. Anchoring on the month (not a day offset) narrows that to the final midnight of
 * a month. It is not zero.
 */
import { createHash } from "node:crypto";
import type { Event, Location, Offering, Reservation } from "../domain/entities.js";
import { mintBookingCode } from "./booking-code.js";
import { asId } from "../domain/ids.js";
import { addDays } from "../config/tenant.js";
import { eventIdForSlot } from "./availability.js";

export interface ReservationDemoBooking {
  date: string;
  time: string;
  customerName: string;
  partySize: number;
  priceCents: number;
  phone: string;
  /** Which hull this sits on. Absent ⇒ the demo's primary boat, which is what the first three
   *  bookings (and every block-impact figure computed against them) have always assumed. */
  vesselId?: string;
}

export interface ReservationDemo {
  locationId: string;
  offeringId: string;
  /** The offering's PRIMARY boat — the one the materialized bookings and the vessel block sit
   *  on, and the only one the block-impact figures are computed against. */
  vesselId: string;
  vesselName: string;
  /**
   * Every boat on the demo offering, smallest first, with its COI cap (#715).
   *
   * The offering used to carry one 12-pax hull, which made the guest filter invisible: with a
   * single boat size there is no day a party of 14 can see differ from a party of 4, so nothing
   * a hand-test does can tell a working filter from a broken one. Three real BrewBoats at three
   * real capacities — Brew 3 (12), Brew 1 (14), Brew 2 (16), matching `resource-map.ts` — give
   * the screen two capacity boundaries to cross and a top end to bump into.
   */
  fleet: readonly { vesselId: string; name: string; coiMaxPax: number }[];
  season: { start: string; end: string };
  departureTimes: readonly string[];
  /** Inclusive demo window. Since #688 this IS the offering's season — the schedule is
   *  the only thing that decides when slots emit, so the season is what scopes the demo. */
  window: { start: string; end: string };
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
    // All three are seeded by `seedFleet` already; this just attaches them to the offering.
    fleet: [
      { vesselId: "vessel-brew-3", name: "Brew 3", coiMaxPax: 12 },
      { vesselId: "vessel-brew-1", name: "Brew 1", coiMaxPax: 14 },
      { vesselId: "vessel-brew-2", name: "Brew 2", coiMaxPax: 16 },
    ],
    // **The season runs from TODAY to the end of the demo window (#797).** It used to equal the
    // window exactly (#688), which put every bookable slot at least ~10 days out and often 40 —
    // so the two cancellation rules that only differ INSIDE the 14-day window had no slot a hand
    // test could reach. Booking a trip five days out is now possible, which is what makes
    // "customer cancels inside 14 days ⇒ nothing" observable at all.
    //
    // The window below still scopes the DEMO — the materialized bookings, the block fixtures and
    // every figure pinned to them are unchanged and still sit next month. The season is only
    // where slots may emit.
    season: { start: todayISO, end: day(15) }, // today … the 16th of next month
    departureTimes: ["13:30", "15:30", "17:30"],
    window: { start: day(9), end: day(15) }, // the 10th … the 16th
    bookings: [
      { date: day(11), time: "13:30", customerName: "Marcus Webb", partySize: 8, priceCents: 54900, phone: "216-555-0148" },
      { date: day(12), time: "15:30", customerName: "Dana Cho", partySize: 6, priceCents: 43900, phone: "(440) 555-0102" },
      // Marcus again — same phone, different spelling of the number. Makes the customers tab
      // demoable (a repeat guest with history + lifetime value) and exercises canonicalization.
      // Deliberately OUTSIDE `vesselBlockWindow` so the block-impact fixture, which asserts an
      // exact conflict count and dollar total, keeps meaning what it says.
      { date: day(15), time: "13:30", customerName: "Marcus Webb", partySize: 10, priceCents: 54900, phone: "+1 216 555 0148" },

      // ── Big-party fixtures (#715, operator 2026-08-16) ────────────────────────────────────
      // The first three bookings are all small and all on the 12, which left the two states the
      // guest filter exists for untestable: a 16 that is actually SOLD, and a party being put on
      // a bigger hull because the smaller ones are gone.
      //
      // **Day allocation is a contract with the Xola fixture** (`seed-xola.ts`), whose comment
      // records it: the demo world books offsets +2, +3 and +6 of its window and the import
      // fixture takes the four free days. Every booking below therefore lands on +2/+3/+6 —
      // day(11), day(12), day(15) — and none on the days Xola owns.
      //
      // Two further constraints, both load-bearing for figures asserted elsewhere:
      //   · `vesselBlockWindow` is a **Brew 3** block over day(10)…day(13), and the drift test
      //     pins its impact at exactly 2 conflicts / $988. So no new Brew 3 booking in that
      //     range — the ones below sit on day(15), outside it.
      //   · `locationBlockWindow` covers day(11) 13:00–16:00 across ALL boats. So nothing new on
      //     day(11) before 16:00, which also keeps `/book`'s day(11) boat counts where the
      //     availability spec pins them.

      // day(15) 13:30 — Marcus (10) already has the 12; the 14 goes too, leaving only the 16.
      // THIS is the "book 12 passengers onto a 16-passenger boat" case: a party of 12 arriving
      // here fits all three hulls on paper and can only be given Brew 2.
      { date: day(15), time: "13:30", customerName: "Priya Raman", partySize: 14, priceCents: 62900, phone: "216-555-0311", vesselId: "vessel-brew-1" },

      // day(15) 15:30 — a 14 and a 16 sold in the SAME departure. Only the 12 is left, so a
      // party of 13+ sees a departure that is genuinely too big for what remains.
      { date: day(15), time: "15:30", customerName: "Tom Alderman", partySize: 14, priceCents: 62900, phone: "440-555-0177", vesselId: "vessel-brew-1" },
      { date: day(15), time: "15:30", customerName: "Renata Vaz", partySize: 16, priceCents: 70900, phone: "216-555-0422", vesselId: "vessel-brew-2" },

      // day(15) 17:30 — a single 12, on the boat whose cap it exactly is. A full small boat.
      { date: day(15), time: "17:30", customerName: "Owen Brady", partySize: 12, priceCents: 57900, phone: "440-555-0288", vesselId: "vessel-brew-3" },

      // day(12) — a 14 on its own, plus mid-size parties on the boats that fit them loosely.
      { date: day(12), time: "17:30", customerName: "Sasha Nolan", partySize: 14, priceCents: 62900, phone: "216-555-0195", vesselId: "vessel-brew-1" },
      { date: day(12), time: "13:30", customerName: "Iris Kwon", partySize: 8, priceCents: 54900, phone: "440-555-0233", vesselId: "vessel-brew-2" },
      { date: day(12), time: "15:30", customerName: "Hector Mena", partySize: 10, priceCents: 54900, phone: "216-555-0266", vesselId: "vessel-brew-1" },
    ],
    vesselBlockWindow: { start: day(10), end: day(13) }, // the 11th … the 14th
    locationBlockWindow: { date: day(11), startTime: "13:00", endTime: "16:00" },
  };
}

export interface SeededReservationWorld {
  location: Location;
  offering: Offering;
  events: Event[];
  reservations: Reservation[];
}

/** Build the demo world. `createdAt` and `demo` are injected to keep the builder clock-free. */
export function buildSeededReservationWorld(
  createdAt: string,
  demo: ReservationDemo,
): SeededReservationWorld {
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
    vesselIds: demo.fleet.map((f) => asId<"VesselId">(f.vesselId)),
    locationId: location.id,
    schedule: {
      seasonStart: demo.season.start,
      seasonEnd: demo.season.end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      departureTimes: [...demo.departureTimes],
    },
    // 100 minutes is not new behaviour — it is the number `deriveVirtualAvailability` has been
    // silently assuming all along via `XOLA_TRIP_MINUTES` (hull-busy.ts) whenever an offering
    // leaves this unset. Stating it changes no arithmetic; it just stops the customer hero
    // dropping its duration line, which `formatDuration(undefined)` returns null for.
    tripLengthMinutes: 100,
    basePriceCents: 49900,
    priceVariations: [],
    // Test data (operator, 2026-08-16). WITHOUT `includedGuestCount` the extra-guest price is
    // unreachable: `guestPricing` falls back to `included = the boat's cap`, and the guest count
    // is clamped to that same cap, so `extraGuests` is structurally always 0 and the per-head
    // charge below can never fire. 10 included makes DEC-124's extras path something a hand-test
    // can actually see — a party of 12 on Brew 3 quotes $499 + 2 × $40.
    includedGuestCount: 10,
    extraGuestPriceCents: 4000,
  };

  const capByVessel = new Map(demo.fleet.map((f) => [f.vesselId, f.coiMaxPax]));

  const events: Event[] = [];
  const reservations: Reservation[] = [];
  for (const b of demo.bookings) {
    // Per-booking hull since #715 — two boats can be sold in one departure, which is the whole
    // point of the big-party fixtures. `capacity` follows the boat rather than the flat 12 it
    // used to be; a 16-guest booking on an Event capped at 12 is a fixture that contradicts
    // itself, and `canBook` enforces `partySize <= capacity`.
    const boat = b.vesselId ?? demo.vesselId;
    const V = asId<"VesselId">(boat);
    const eventId = eventIdForSlot(V, b.date, b.time);
    events.push({
      id: eventId,
      vesselId: V,
      date: b.date,
      time: b.time,
      capacity: capByVessel.get(boat) ?? 12,
      status: "scheduled",
      source: "muster",
      price: b.priceCents,
    });
    reservations.push({
      id: asId<"ReservationId">(demoReservationId(b.date, b.time, boat)),
      eventId,
      source: "muster",
      customerName: b.customerName,
      partySize: b.partySize,
      phone: b.phone,
      status: "booked",
      updatedAt: createdAt,
    });
  }

  return { location, offering, events, reservations };
}

/**
 * The seeded reservation's id for a slot. Exported because the e2e types these into URLs
 * (`/admin/calendar/<id>`, the manage link) and hand-spelling the format in six specs is how
 * it drifts — the dates inside it move now.
 */
export function demoReservationId(date: string, time: string, vesselId = "vessel-brew-3"): string {
  // The hull joined the id in #715, when the fixture started selling two boats in one departure
  // — date+time alone stopped being unique and two bookings would have collapsed onto one row.
  // Defaulted to the primary boat so the e2e call sites, all of which mean that boat, still read
  // as `demoReservationId(BOOKED.date, BOOKED.time)`.
  return `resv-demo-${date}-${time}-${vesselId}`;
}

/**
 * The seeded booking's manage code (#741) — DERIVED from its reservation id, so the seed writes
 * a code the specs and the hand-testing runbook can build without reading the database.
 *
 * A real code comes from `crypto.randomBytes` and is unguessable on purpose; this one is
 * deliberately not, because a fixture whose credential can only be discovered by querying is a
 * fixture nobody can start a test from. That trade is safe **only** because this function has one
 * caller shape — the dev seeds, behind their local-DB guard — and it never runs against a
 * database anyone books on.
 *
 * SHA-256 over the id, then the same `& 31` mapping `mintBookingCode` uses over the same
 * alphabet, so the output is a valid code by construction rather than by a hand-checked literal.
 */
export function demoBookingCode(reservationId: string): string {
  const digest = createHash("sha256").update(`booking-code-seed:${reservationId}`).digest();
  return mintBookingCode(() => digest);
}

/** A code the seed writes REVOKED, so the "this link was replaced" state has a starting URL.
 *  Belongs to the first booking; minted from a different tag so it can't collide with its live
 *  one. */
export function demoRevokedBookingCode(reservationId: string): string {
  const digest = createHash("sha256").update(`booking-code-seed-revoked:${reservationId}`).digest();
  return mintBookingCode(() => digest);
}
