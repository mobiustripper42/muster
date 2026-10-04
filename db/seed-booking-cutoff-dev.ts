/**
 * `db:seed:booking-cutoff` — set the booking cutoff (DEC-193, issue #1071) so the hand-test pass
 * can see it. Writes ONE `app_settings` row, `booking.cutoff_hours`; composes with any other seed.
 *
 *   npm run db:seed:reservation          # the live offering, departures 13:30/15:30/17:30 daily
 *   npm run db:seed:booking-cutoff       # cover all of TOMORROW's departures (the default)
 *   npm run db:seed:booking-cutoff -- 6  # or a number of hours you pick
 *   npm run db:seed:booking-cutoff -- 0  # the reset: 0 is no cutoff, the code's fallback
 *
 * The default is computed rather than fixed because a fixed number lands somewhere different
 * depending on the time of day you run it: 24 hours at 10am misses tomorrow's 13:30 entirely.
 * Covering tomorrow's last departure, rounded up to the hour, always puts the whole of tomorrow
 * inside and never reaches the day after's first trip, twenty hours later.
 *
 * No screen edits this yet — the settings page is issue #1166.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { vesselDateOf, zonedWallClockToInstant } from "../src/config/tenant.js";
import { reservationDemo } from "../src/reservations/seed-reservation.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed changes what the public site sells — run it against a local DB, or pass --force.`,
  );
  process.exit(1);
}

const today = vesselDateOf(new Date());
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const times = reservationDemo(today).departureTimes;
const last = times[times.length - 1]!;

const asked = args.find((a) => /^\d+$/.test(a));
const hours =
  asked !== undefined
    ? Number(asked)
    : Math.ceil((zonedWallClockToInstant(tomorrow, last).getTime() - Date.now()) / 3_600_000);

const repo = PostgresRepository.fromConnectionString(url);
try {
  await repo.setBookingCutoffHours(hours, new Date().toISOString());
} finally {
  await repo.close();
}

console.log(`✓ booking.cutoff_hours = ${hours} (db: ${new URL(url).host}).`);
if (hours === 0) {
  console.log("  No cutoff — the public site sells right up to departure.");
} else {
  console.log(`  Every departure leaving within ${hours} hours of now is phone-only.`);
  console.log("");
  // Tomorrow is only guaranteed to be inside on the computed default; a picked number may not reach it.
  const day = asked === undefined ? tomorrow : today;
  console.log(`  → /book?date=${day}                 "Call to book" rows, the notice`);
  console.log(`  → /admin/calendar?date=${day}       open · … · phone only`);
  console.log(`  → npm run db:seed:booking-cutoff -- 0    to clear it`);
}
process.exit(0);
