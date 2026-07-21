/**
 * `db:seed:reservation` — seed a self-contained reservation world so the /admin/blocks impact
 * numbers are real when hand-testing (task 12.10, DEC-125). It materializes:
 *   - the crewed fleet (seedFleet — so vessel-brew-3 exists), a demo Location + a LIVE Offering
 *     (3 daily departures, full-year season) and the owned-day mask that lets its slots emit;
 *   - two MATERIALIZED bookings (Event + booked Reservation) at known slots inside that window.
 *
 * Then a Vessel block over Aug 11–14, or a Location block on Aug 12 13:00–16:00, shows a
 * non-zero "removes N" AND a booked-trip conflict.
 *
 *   npm run db:seed:reservation           # local/preview DB
 *   npm run db:seed:reservation --force   # bypass the local-DB guard
 *
 * Idempotent: deterministic ids ⇒ re-running upserts, never double-writes.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { seedFleet } from "../src/import/resource-map.js";
import { RESERVATION_DEMO, buildSeededReservationWorld } from "../src/reservations/seed-reservation.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard (mirrors db:seed:gratuity / db:seed:split): this writes synthetic rows — never
// a shared/prod or preview DB by accident.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
try {
  await seedFleet(repo); // vessels + role types — vessel-brew-3 must exist for the offering
  const world = buildSeededReservationWorld(new Date().toISOString());

  await repo.saveLocation(world.location);
  await repo.saveOffering(world.offering);
  for (const o of world.ownedDays) {
    await repo.markVesselDayMusterOwned(o.vesselId, o.date, new Date().toISOString());
  }
  for (const e of world.events) await repo.saveEvent(e);
  for (const r of world.reservations) await repo.saveReservation(r);

  console.log(`✓ Seeded reservation demo world (db: ${new URL(url).host}).`);
  console.log(`  offering  ${world.offering.id}  (LIVE, ${RESERVATION_DEMO.departureTimes.join("/")}, ${RESERVATION_DEMO.vesselName})`);
  console.log(`  owned     ${RESERVATION_DEMO.vesselName}  ${RESERVATION_DEMO.ownedRange.start} … ${RESERVATION_DEMO.ownedRange.end}`);
  for (const b of RESERVATION_DEMO.bookings) {
    console.log(`  booked    ${b.date} ${b.time}  ${b.customerName} · ${b.partySize} guests · $${(b.priceCents / 100).toFixed(2)}`);
  }
  console.log("");
  console.log("Try it at /admin/blocks:");
  console.log(`  • Vessel block ${RESERVATION_DEMO.vesselName}  ${RESERVATION_DEMO.vesselBlockWindow.start} → ${RESERVATION_DEMO.vesselBlockWindow.end}  → removes slots + 2 booked ($988) conflict`);
  console.log(`  • Location block Reservation Demo Dock  ${RESERVATION_DEMO.locationBlockWindow.date} ${RESERVATION_DEMO.locationBlockWindow.startTime}–${RESERVATION_DEMO.locationBlockWindow.endTime}  → removes 1 + 1 booked ($549) conflict`);
} finally {
  await repo.close();
}
