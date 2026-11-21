/**
 * `db:balance-due` — make a booking's balance due NOW, so the scheduled balance charge picks it up
 * on the next tick (issue #1254; replaces `db:balance`, which minted the hosted balance link).
 *
 *   npm run db:balance-due -- <booking code>            # sets balance_due_at to now
 *   npm run db:balance-due -- <booking code> --force    # bypass the local-DB guard
 *
 * The sandbox check (`docs/SPEC.md §2.8.4d`): book a deposit through the real checkout with a Stripe
 * test card, run this with the booking's code, then call the tick route with the cron secret:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
 *
 * The response's `balancesCharged` reads 1, the booking's `/b/<code>` page reads "Paid in full", and
 * the PaymentIntent `balance_payment_intent_id` on the row reads succeeded in Stripe's test dashboard.
 * Only `balance_due_at` moves: the release date stays where checkout froze it, and a booking whose
 * release date has already passed is not charged (the script says so).
 *
 * Writes the one column on a local database; the guard mirrors `db:paid-unbooked`.
 */
import { existsSync } from "node:fs";
import pg from "pg";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { pgConnectionConfig } from "../src/config/db-ssl.js";
import { normalizeBookingCode } from "../src/reservations/booking-code.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const codeArg = args.find((a) => !a.startsWith("--"));
if (!codeArg) {
  console.error("Usage: npm run db:balance-due -- <booking code> [--force]");
  process.exit(1);
}
const code = normalizeBookingCode(codeArg);
if (!code) {
  console.error(`"${codeArg}" is not a booking code.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This edits a booking's due date — run it against a local DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
const client = new pg.Client(pgConnectionConfig(url));
try {
  const codeRow = await repo.getBookingCode(code);
  const reservation = codeRow ? await repo.getReservation(codeRow.reservationId) : null;
  if (!reservation) {
    console.error(`No booking has the code ${code}.`);
    process.exitCode = 1;
  } else {
    const now = new Date().toISOString();
    await client.connect();
    await client.query("update reservations set balance_due_at = $2 where id = $1", [reservation.id, now]);
    console.log(`\n${reservation.customerName} (${reservation.id}): balance_due_at = ${now} (db: ${new URL(url).host}).`);
    if (reservation.status !== "booked") console.log(`  Note: the booking is ${reservation.status}; only a booked one is charged.`);
    if (!reservation.stripePaymentMethodId) console.log("  Note: no saved card on this booking; the job skips it.");
    if (!reservation.balanceReleaseAt || reservation.balanceReleaseAt <= now) {
      console.log(`  Note: balance_release_at is ${reservation.balanceReleaseAt ?? "unset"}, not in the future; the job skips it.`);
    }
    console.log("\nNow call the tick route: curl -H \"Authorization: Bearer $CRON_SECRET\" <base>/api/cron/tick\n");
  }
} finally {
  await client.end().catch(() => {});
  await repo.close();
}
