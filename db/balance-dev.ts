/**
 * `db:balance` — collect the remaining BALANCE on a deposit booking (11.2b), on demand.
 * Opens a Stripe Checkout for the outstanding balance of an existing reservation and prints
 * the URL (the "balance link"). Pay with card 4242 4242 4242 4242 and — with `stripe listen`
 * forwarding to the webhook — a `Payment{kind:'balance'}` is recorded against the reservation.
 *
 *   npm run db:balance -- --reservation <reservationId>              # real Stripe (test keys in .env.local)
 *   npm run db:balance -- --reservation <reservationId> --dry-run    # FakePaymentPort, no Stripe
 *
 * The real customer-facing "email the balance link" surface is P12; this is the throwaway
 * operator trigger, sibling to `db:checkout`.
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { StripePaymentPort } from "../src/adapters/stripe-payment.js";
import { asId } from "../src/domain/ids.js";
import type { PaymentPort } from "../src/ports/payment.js";
import { createBalanceCheckout } from "../src/reservations/create-balance-checkout.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const dryRun = process.argv.includes("--dry-run");
const flagIdx = process.argv.indexOf("--reservation");
const reservationArg = flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined;
if (!reservationArg) {
  console.error("Usage: npm run db:balance -- --reservation <reservationId> [--dry-run]");
  process.exit(1);
}

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

let payments: PaymentPort;
if (dryRun) {
  payments = new FakePaymentPort();
} else {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (test keys) in .env.local, or pass --dry-run.");
    process.exit(1);
  }
  payments = new StripePaymentPort(secretKey, webhookSecret);
}

const repo = PostgresRepository.fromConnectionString(url);
try {
  const result = await createBalanceCheckout(
    repo,
    payments,
    asId<"ReservationId">(reservationArg),
    { successUrl: `${base}/book/success`, cancelUrl: `${base}/book/cancel` },
  );

  if (!result.ok) {
    console.error(`\nBalance checkout NOT created: ${result.reason}`);
    process.exitCode = 1;
  } else {
    console.log(`\nOutstanding balance: $${(result.amountCents / 100).toFixed(2)} (db: ${new URL(url).host}).`);
    console.log(`Stripe session: ${result.sessionId}`);
    console.log("Open this Checkout URL and pay with card 4242 4242 4242 4242:\n");
    console.log(`  ${result.url}\n`);
    if (dryRun) {
      console.log("(--dry-run: fake URL; no real charge.)");
    } else {
      console.log("Ensure `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running so the webhook records the balance.");
    }
  }
} finally {
  await repo.close();
}
