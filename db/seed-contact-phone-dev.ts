/**
 * `db:seed:contact-phone` — set the operator's contact phone (issue #1159) so the hand-test pass can
 * see the number in the "call us" sentences. Writes ONE `app_settings` row, `booking.contact_phone`;
 * composes with any other seed.
 *
 *   npm run db:seed:reservation
 *   npm run db:seed:booking-cutoff
 *   npm run db:seed:contact-phone                    # stores (216) 555-0100
 *   npm run db:seed:contact-phone -- "(330) 555-0199"  # or a number you pass
 *   npm run db:seed:contact-phone -- clear           # the reset: a blank row reads as no number
 *
 * No screen edits this yet — the settings page is issue #1166.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { parseContactPhone } from "../src/reservations/contact-phone.js";
import { vesselDateOf } from "../src/config/tenant.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed changes what the public site tells customers — run it against a local DB, or pass --force.`,
  );
  process.exit(1);
}

const rest = args.filter((a) => a !== "--force");
const clear = rest.includes("clear");
const raw = clear ? "" : (rest[0] ?? "(216) 555-0100");

if (!clear && parseContactPhone(raw) === null) {
  console.error(`Refusing: ${JSON.stringify(raw)} is not a phone number the site could show.`);
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
try {
  await repo.setContactPhone(raw, new Date().toISOString());
} finally {
  await repo.close();
}

console.log(`✓ booking.contact_phone = ${JSON.stringify(raw)} (db: ${new URL(url).host}).`);
if (clear) {
  console.log("  No number — the \"call us\" sentences read as plain \"call us\".");
} else {
  const today = vesselDateOf(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  console.log(`  → /book?date=${tomorrow}   (after db:seed:booking-cutoff) the notice carries the number`);
  console.log("  → /b/find?sent=1           the line under the notice carries the number");
  console.log("  → npm run db:seed:contact-phone -- clear    to clear it");
}
process.exit(0);
