/**
 * `db:pay` — record a Payment against an existing reservation, so the cancel/refund surface
 * (#616) can be exercised by hand in dev.
 *
 *   npm run db:pay -- --reservation <reservationId>                  # full fare + tax
 *   npm run db:pay -- --reservation <reservationId> --amount 134.06  # dollars, e.g. a deposit
 *   npm run db:pay -- --reservation <reservationId> --kind deposit
 *
 * **Why this exists.** The reservation seed writes bookings with NO payments — every money
 * assertion in `calendar.spec.ts` reads off the pure fare+tax derivation, and adding a payment
 * to the seed would move those numbers under seven other specs. So #616's own test plan asked a
 * reviewer to check the refund box and the two cancellation quotes, on a booking where both are
 * necessarily `$0.00` and no command existed to change that. A verification step that cannot be
 * run is not a verification step.
 *
 * **What it does NOT let you do: a successful refund.** The `stripePaymentIntentId` written here
 * is synthetic (`pi_dev_*`), so `refundReservation` will reach Stripe and be refused — Stripe has
 * never heard of it. That is deliberate and it is the honest boundary of a dev fixture: what this
 * unlocks is the refund box appearing with the right ceiling and prefill, the two published-terms
 * quotes differing by the $50 fee, the compare-and-swap token, and the failure copy. An
 * end-to-end refund needs a real charge — book through `/book` with Stripe test keys.
 *
 * Money is integer CENTS internally (DEC-112); `--amount` is dollars, parsed by the SAME
 * `parseDollarsToCents` the operator's refund box uses rather than a second local parser.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { taxCentsFor } from "../src/reservations/payment-config.js";
import { parseDollarsToCents } from "../src/reservations/refund-payment.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const reservationArg = arg("--reservation");
if (!reservationArg) {
  console.error(
    "Usage: npm run db:pay -- --reservation <reservationId> [--amount <dollars>] [--kind full|deposit|balance]",
  );
  process.exit(1);
}
const kindArg = arg("--kind") ?? "full";
if (kindArg !== "full" && kindArg !== "deposit" && kindArg !== "balance") {
  console.error(`--kind must be full, deposit or balance (got "${kindArg}")`);
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(
  process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
);

try {
  const reservationId = asId<"ReservationId">(reservationArg);
  const reservation = await repo.getReservation(reservationId);
  if (!reservation) {
    console.error(`No reservation "${reservationArg}".`);
    process.exit(1);
  }
  if (reservation.source !== "muster") {
    console.error(`Reservation "${reservationArg}" is Xola's — its money lives in Xola (DEC-105).`);
    process.exit(1);
  }

  const event = await repo.getEvent(reservation.eventId);
  const config = await repo.getPaymentConfig();
  const fareCents = (event?.price ?? 0) + (reservation.extrasCents ?? 0);
  const taxCents = taxCentsFor(fareCents, config.taxRateBps);

  const amountArg = arg("--amount");
  let amountCents: number;
  if (amountArg === undefined) {
    amountCents = fareCents + taxCents;
    if (amountCents <= 0) {
      console.error(
        `Reservation "${reservationArg}" has no priced event, so there is no full amount to infer. Pass --amount <dollars>.`,
      );
      process.exit(1);
    }
  } else {
    const parsed = parseDollarsToCents(amountArg);
    if (parsed === null || parsed <= 0) {
      console.error(`--amount must be dollars like 536.25 (got "${amountArg}").`);
      process.exit(1);
    }
    amountCents = parsed;
  }

  // Deterministic id so re-running is a no-op rather than a second payment row — `savePayment`
  // is insert-only, mirroring the webhook's idempotent upsert.
  const suffix = `${String(reservationId)}_${kindArg}_${amountCents}`;
  await repo.savePayment({
    id: asId<"PaymentId">(`pay_dev_${suffix}`),
    reservationId,
    method: "stripe",
    kind: kindArg,
    amountCents,
    // Tax is only carried on the charge that collected it; a deposit/balance leg does not
    // re-declare it (the balance carries no tax — it was taken in full with the deposit).
    taxCents: kindArg === "full" ? taxCents : 0,
    currency: "usd",
    stripePaymentIntentId: `pi_dev_${suffix}`,
    status: "succeeded",
    createdAt: new Date().toISOString(),
  });

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  const all = await repo.listPaymentsForReservation(reservationId);
  const paid = all.reduce((s, p) => s + p.amountCents - (p.refundedCents ?? 0), 0);
  console.log(`Recorded a ${kindArg} payment of ${dollars(amountCents)} on ${reservationArg}.`);
  console.log(`  Payments on this booking: ${all.length}, ${dollars(paid)} net of refunds.`);
  console.log(
    `  The PaymentIntent is synthetic — a refund from Muster will be REFUSED by Stripe.\n` +
      `  Use this to check the refund ceiling, the prefill, and the two cancellation quotes.`,
  );
} finally {
  await repo.close();
}
