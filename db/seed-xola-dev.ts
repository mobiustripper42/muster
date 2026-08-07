/**
 * `db:seed:xola` — write the SYNTHETIC Xola import (`src/reservations/seed-xola.ts`).
 *
 * No API, no network, no pull. This is the fixture CI and the e2e run against; `db:seed:overlap`
 * is the separate tool for exploring a REAL import against the operator's own data.
 *
 *   npm run db:seed:reservation    # the live offering these trips interact with
 *   npm run db:seed:xola           # then the imported trips
 *
 * Order matters: the fixture's dates and boat come from `reservationDemo`, so seeding this alone
 * writes trips no offering sells and nothing interesting happens.
 *
 * Customers are resolved the same way the booking path does, deliberately — the repeat-guest rows
 * share one phone spelled two ways, and the whole point is to watch them collapse to a single
 * customer. NB the real importer does NOT do this yet (#701); this seed is showing what the
 * imported world should look like once it does, not what it looks like today.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { resolveCustomerId } from "../src/customers/resolve.js";
import { vesselDateOf } from "../src/config/tenant.js";
import { buildSeededXolaWorld, xolaFixture } from "../src/reservations/seed-xola.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
const now = new Date().toISOString();
// `SEED_TODAY` pins the day for the e2e harness, exactly as the reservation seed does — the
// seeded DB and the specs' expectations must come from ONE clock read, not two that can
// disagree across a midnight.
const fx = xolaFixture(process.env.SEED_TODAY ?? vesselDateOf(new Date()));
const world = buildSeededXolaWorld(now, fx);

// The uncovered boat has to exist as a vessel, or its trips have nowhere to hang — that vessel
// being INVISIBLE on the calendar is the point (#700), and a missing row would look the same
// while proving something else entirely.
await repo.saveVessel(world.extraVessel);

for (const e of world.events) await repo.saveEvent(e);
for (const r of world.reservations) {
  const customerId = await resolveCustomerId(
    repo,
    { customerName: r.customerName, ...(r.phone !== undefined ? { phone: r.phone } : {}) },
    () => r.updatedAt ?? now,
  );
  await repo.saveReservation({ ...r, ...(customerId !== undefined ? { customerId } : {}) });
}

console.log(`✓ Seeded a synthetic Xola import (db: ${new URL(url).host}).`);
console.log(`  ${world.events.length} trips on ${fx.days.onGrid} … ${fx.days.clean}, + vessel "${world.extraVessel.name}"`);
console.log("");
console.log("  What each day is for:");
console.log(`    ${fx.days.onGrid}  on-grid 13:30 → that slot must read sold out (#615)`);
console.log(`    ${fx.days.onGrid}  09:00 + "${world.extraVessel.name}" 13:00 → invisible to the calendar (#700)`);
console.log(`    ${fx.days.overlapping}  14:00 → takes out BOTH 13:30 and 15:30, neither its own identity (#691)`);
console.log(`    ${fx.days.repeatGuest}  Nora Blake ×2, one phone spelled two ways → ONE customer`);
console.log(`    ${fx.days.cancelled}  a CANCELLED 15:30 → must NOT block`);
console.log(`    ${fx.days.clean}  nothing at all → the control, everything open`);
console.log("");
console.log(`  → /admin/calendar?date=${fx.days.onGrid}`);
process.exit(0);
