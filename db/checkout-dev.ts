/**
 * `db:checkout` — a throwaway smoke test for the 11.2a charge spine, BEFORE the 11.6
 * booking form exists. Seeds one Muster-native event (source='muster', priced) and opens a
 * Stripe Checkout for it, printing the URL. Pay with card 4242 4242 4242 4242 and — with
 * `stripe listen` forwarding to the webhook — the reservation + payment get written.
 *
 *   npm run db:checkout                # real Stripe (needs test keys in .env.local)
 *   npm run db:checkout -- --dry-run   # FakePaymentPort — proves the seed + checkout path, no Stripe
 *
 * Full loop (real):
 *   1. npm run db:migrate                                             # apply the reservations migrations
 *   2. put STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (test) in .env.local
 *   3. npm run dev                                                    # the webhook route must be up
 *   4. stripe listen --forward-to localhost:3000/api/webhooks/stripe  # in another terminal
 *   5. npm run db:checkout   → open the URL, pay with 4242…           # webhook writes the booking
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { StripePaymentPort } from "../src/adapters/stripe-payment.js";
import type { Event } from "../src/domain/entities.js";
import { asId } from "../src/domain/ids.js";
import type { PaymentPort } from "../src/ports/payment.js";
import { createBookingCheckout } from "../src/reservations/create-booking-checkout.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const dryRun = process.argv.includes("--dry-run");
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

// A near-future vessel-day to book (7 days out).
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const event: Event = {
  id: asId<"EventId">("evt-muster-test"),
  vesselId: asId<"VesselId">("vessel-brew-2"),
  date,
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000, // $500.00 in cents
};

const repo = PostgresRepository.fromConnectionString(url);
try {
  await repo.saveEvent(event); // idempotent upsert
  const cfg = await repo.getPaymentConfig();
  console.log(`Seeded Muster event ${event.id} — ${date} 17:00, $500.00, cap 12 (db: ${new URL(url).host}).`);
  console.log(`Payment config: ${cfg.depositMode}${cfg.depositMode === "deposit" ? ` ${cfg.depositPercent}%` : ""}, tax ${cfg.taxRateBps}bps.`);

  const result = await createBookingCheckout(
    repo,
    payments,
    { eventId: event.id, customerName: "Test Booker", partySize: 6, email: "test@example.com" },
    { successUrl: `${base}/book/success`, cancelUrl: `${base}/book/cancel` },
  );

  if (!result.ok) {
    console.error(`\nCheckout NOT created: ${result.reason}`);
    process.exitCode = 1;
  } else {
    console.log(`\nStripe session: ${result.sessionId}`);
    console.log("Open this Checkout URL and pay with card 4242 4242 4242 4242:\n");
    console.log(`  ${result.url}\n`);
    if (dryRun) {
      console.log("(--dry-run: fake URL; no real charge. Drop --dry-run with test keys set for a real session.)");
    } else {
      console.log("Ensure `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running so the webhook writes the booking.");
    }
  }
} finally {
  await repo.close();
}
