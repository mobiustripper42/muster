/**
 * `db:seed:overlap` — manufacture the hull-overlap scenarios on top of REAL imported Xola data,
 * so the cases that keep biting can be reproduced in one command instead of rebuilt by hand.
 *
 * Making a Muster booking through the product means the whole Stripe loop: `stripe listen`
 * running, a hold that expires in a minute, card entry, a webhook. Several minutes and several
 * ways to fail — which is exactly why the overlap cases got tested by hand, badly, for hours.
 * This writes bookings straight through the repository instead. No Stripe, no webhook, no holds.
 *
 *   npm run db:seed:overlap              # after an import, on top of whatever is there
 *   npm run db:seed:overlap -- --dry-run # report the landscape, write nothing
 *
 * **It is RELATIVE, not fixed.** Imported data differs every pull, so nothing here hard-codes a
 * date or a boat. It scans the derived availability for the next few weeks, picks the first
 * qualifying slot in sorted order (deterministic — same DB in, same choice out), and prints what
 * it chose. If a scenario has no candidate it says so rather than silently doing nothing, which
 * is the failure mode that makes a fixture worse than useless.
 *
 * Bookings go through `saveBookingIfSlotFree` — the real CAS, hull guard included (#615/#691).
 * A seed that bypassed the guard could manufacture a state the product cannot reach, and then
 * everything downstream would be testing a fiction.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { deriveVirtualAvailability, eventIdForSlot } from "../src/reservations/availability.js";
import { XOLA_TRIP_MINUTES, busyIntervalsFor, hullIsBusy, minutesOfDay } from "../src/reservations/hull-busy.js";
import { resolveCustomerId } from "../src/customers/resolve.js";
import { vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import type { Event, Offering, Reservation } from "../src/domain/entities.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic bookings — run it against a local DB, or pass --force.`,
  );
  process.exit(1);
}

/** Inclusive day list, `yyyy-mm-dd`. */
function eachDay(start: string, days: number): string[] {
  const out: string[] = [];
  let ms = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86_400_000;
  }
  return out;
}

const repo = PostgresRepository.fromConnectionString(url);

const today = vesselDateOf(new Date());
// 90 days, not a month: an offering's season can start well ahead of today (the demo world runs
// the 10th–16th of NEXT month), and a window that ends before the season starts finds nothing
// and reports "no candidates" — indistinguishable from data that genuinely has none.
const window = eachDay(today, 90);
const [offerings, vessels, blocks] = await Promise.all([
  repo.listOfferings(),
  repo.listVessels(),
  repo.listBlocks(),
]);
const live = offerings.filter((o) => o.status === "live");

if (live.length === 0) {
  console.error("No live offering — nothing schedules anything, so there is nothing to overlap.");
  process.exit(1);
}

/** Re-derive from scratch; the seed writes as it goes, so state must be re-read each pass. */
async function derive(dates: string[]) {
  const [events, reservations] = await Promise.all([repo.listEvents(), repo.listAllReservations()]);
  const slots = deriveVirtualAvailability({
    offerings: live,
    vessels,
    dateRange: { start: dates[0]!, end: dates[dates.length - 1]! },
    blocks,
    events,
    reservations,
  }).filter((s) => dates.includes(s.date));
  return { events, reservations, slots };
}

const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
const offeringById = new Map(live.map((o) => [String(o.id), o]));
const sortKey = (s: { date: string; vesselId: unknown; time: string }) =>
  `${s.date}|${String(s.vesselId)}|${s.time}`;

// ── The landscape, before anything is written ──────────────────────────────
const before = await derive(window);
const xolaTrips = before.events.filter((e) => e.source === "xola" && e.status === "scheduled");
const coveredVessels = new Set(live.flatMap((o) => o.vesselIds.map(String)));
const invisible = xolaTrips.filter((e) => {
  if (!coveredVessels.has(String(e.vesselId))) return true;
  return !live.some(
    (o) => o.vesselIds.some((v) => String(v) === String(e.vesselId)) && o.schedule.departureTimes.includes(e.time),
  );
});

console.log(`Window: ${window[0]} … ${window[window.length - 1]}  (${window.length} days)`);
console.log(`Live offerings: ${live.map((o) => o.name).join(", ")}`);
console.log(`Xola trips in the DB: ${xolaTrips.length}   invisible to the calendar's grid: ${invisible.length}`);
if (invisible.length > 0) {
  for (const e of invisible.slice(0, 5)) {
    console.log(`  · ${e.date} ${e.time} ${String(e.vesselId)} — no offering schedules this boat at this time (#700)`);
  }
  if (invisible.length > 5) console.log(`  · …and ${invisible.length - 5} more`);
}

// ── Scenario A: a Muster slot already blocked by an imported Xola trip ──────
// Nothing to write — if the import overlaps the offering grid this already exists, and it is
// the #615 case. Report the first one so there is a concrete URL to look at.
const blockedByXola = before.slots
  .filter((s) => s.status === "unavailable")
  .filter((s) => {
    const busy = busyIntervalsFor(xolaTrips, s.vesselId, s.date);
    const o = offeringById.get(String(s.offeringId));
    return hullIsBusy(busy, minutesOfDay(s.time), o?.tripLengthMinutes ?? XOLA_TRIP_MINUTES);
  })
  .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

console.log(`\nA. Muster slots blocked by an imported Xola trip: ${blockedByXola.length}`);
if (blockedByXola[0]) {
  const s = blockedByXola[0];
  console.log(`   first: ${s.date} ${s.time} ${vesselById.get(String(s.vesselId))?.name ?? String(s.vesselId)}`);
  console.log(`   → /book?offering=${encodeURIComponent(String(s.offeringId))}&date=${s.date}  (should read sold out)`);
} else {
  console.log("   NONE — the import doesn't overlap the offering grid anywhere in this window.");
  console.log("   That is not nothing: it means #615 cannot be exercised against this data by hand.");
}

// ── Scenario B: manufacture a Muster-vs-Muster overlap ─────────────────────
// Book an available slot, then find a DIFFERENT time on that same boat whose window the new
// booking now covers. That pair is #691 — two slot identities, one hull.
const candidates = before.slots
  .filter((s) => s.status === "available")
  .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// Idempotence is a claim this tool makes, so it has to be true: once a fixture booking exists in
// the window, picking a NEW candidate would book a second one on every run — the opposite of the
// determinism promised above, since each run changes the DB the next run reads.
const existingFixture = before.reservations.find((r) => r.customerName === "Overlap Fixture");
if (existingFixture) {
  const ev = before.events.find((e) => String(e.id) === String(existingFixture.eventId));
  console.log(`\nB. Already manufactured — ${ev?.date ?? "?"} ${ev?.time ?? "?"} on ${
    ev ? (vesselById.get(String(ev.vesselId))?.name ?? String(ev.vesselId)) : "?"
  }`);
  console.log("   Nothing written. Reset the DB to start over.");
  process.exit(0);
}

let booked: { date: string; time: string; vessel: string; offering: Offering } | null = null;
for (const s of candidates) {
  const o = offeringById.get(String(s.offeringId));
  if (!o) continue;
  const trip = o.tripLengthMinutes ?? XOLA_TRIP_MINUTES;
  // Is there another scheduled departure on this boat/day that this booking would cover?
  const sibling = before.slots.find(
    (x) =>
      String(x.vesselId) === String(s.vesselId) &&
      x.date === s.date &&
      x.time !== s.time &&
      hullIsBusy([{ start: minutesOfDay(s.time), end: minutesOfDay(s.time) + trip }], minutesOfDay(x.time),
        offeringById.get(String(x.offeringId))?.tripLengthMinutes ?? XOLA_TRIP_MINUTES),
  );
  if (!sibling) continue;

  const vessel = vesselById.get(String(s.vesselId));
  if (!vessel) continue;

  console.log(`\nB. Manufacturing a Muster-vs-Muster overlap`);
  console.log(`   booking ${s.date} ${s.time} on ${vessel.name} (${trip}min → covers ${sibling.time})`);
  if (dryRun) {
    console.log("   --dry-run: nothing written.");
    booked = { date: s.date, time: s.time, vessel: vessel.name, offering: o };
    break;
  }

  const now = new Date().toISOString();
  const eventId = eventIdForSlot(s.vesselId, s.date, s.time);
  const phone = "216-555-0199";
  const customerId = await resolveCustomerId(repo, { customerName: "Overlap Fixture", phone }, () => now);
  const event: Event = {
    id: eventId,
    vesselId: s.vesselId,
    date: s.date,
    time: s.time,
    capacity: vessel.coiMaxPax,
    status: "scheduled",
    source: "muster",
    price: s.priceCents,
    ...(o.tripLengthMinutes !== undefined ? { durationMinutes: o.tripLengthMinutes } : {}),
  };
  const reservation: Reservation = {
    id: asId<"ReservationId">(`resv-overlap-${s.date}-${s.time.replace(":", "")}`),
    eventId,
    source: "muster",
    customerName: "Overlap Fixture",
    partySize: Math.min(4, vessel.coiMaxPax),
    phone,
    status: "booked",
    updatedAt: now,
    ...(customerId !== undefined ? { customerId } : {}),
  };
  const res = await repo.saveBookingIfSlotFree(event, reservation);
  console.log(`   saveBookingIfSlotFree → ${res.result}`);
  if (res.result === "lost") {
    console.log("   The guard refused. That is a real answer, not a seed failure — the hull was taken.");
  }
  booked = { date: s.date, time: s.time, vessel: vessel.name, offering: o };
  break;
}

if (!booked) {
  console.log("\nB. NONE — no available slot has another departure inside its own trip length.");
  console.log("   Add a second departure time closer than the trip length to any offering, and re-run.");
}

// ── What it looks like now ─────────────────────────────────────────────────
if (booked && !dryRun) {
  const after = await derive([booked.date]);
  const onHull = after.slots
    .filter((s) => vesselById.get(String(s.vesselId))?.name === booked!.vessel)
    .sort((a, b) => a.time.localeCompare(b.time));
  console.log(`\n${booked.date} · ${booked.vessel} — after:`);
  for (const s of onHull) {
    console.log(`   ${s.time}  ${s.status}`);
  }
  console.log(`\n   → /admin/calendar?date=${booked.date}`);
  console.log(`   → /book?offering=${encodeURIComponent(String(booked.offering.id))}&date=${booked.date}`);
}

console.log("\nRe-run any time; it is idempotent on the reservation id.");
process.exit(0);
