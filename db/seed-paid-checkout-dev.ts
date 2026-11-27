/**
 * `db:seed:paid-checkout` — a public checkout that timed out 20 minutes ago and was paid for real in
 * Stripe's test mode (issue #1236), so the reconciler has a customer to find without anyone paying
 * and closing a tab by hand.
 *
 * The checkout goes through the real path, `createDeparturePaymentIntent`, written as if it began
 * 20 minutes past the payment window — a `pending` row with its payment's id on it — and the
 * PaymentIntent is then confirmed with Stripe's test card, the way the sandbox test pays
 * (`src/adapters/stripe-payment.sandbox.ts`). Nothing books it: with `stripe listen` off and nobody on
 * the success page, it is the paid, unbooked checkout the reconciler exists for.
 *
 * It prints the customer's name and the booking's address, and refuses a live key. It needs a test-mode
 * `STRIPE_SECRET_KEY` in `.env.local`. Each run makes one real test-mode payment, which stays in the
 * Stripe test dashboard, and writes a new checkout.
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering this books:
 *
 *   npm run db:seed:reservation && npm run db:seed:paid-checkout
 *   npm run db:seed:paid-checkout -- --force   # bypass the local-DB guard
 *
 * Then, with `stripe listen` off, run one tick (`docs/RUNNING.md`, "Run one tick by hand"): the
 * booking reads booked, and its history shows it was booked by the reconciler.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Stripe from "stripe";
import { StripePaymentPort } from "../src/adapters/stripe-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { createDeparturePaymentIntent } from "../src/reservations/create-departure-payment-intent.js";
import { PAYMENT_WINDOW_MINUTES } from "../src/reservations/pending.js";
import { reservationDemo } from "../src/reservations/seed-reservation.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard (mirrors db:seed:reservation): this writes synthetic rows.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

// This seed pays for real. The key itself is never printed — only whether its prefix is the safe one.
const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
if (!secretKey.startsWith("sk_test_")) {
  console.error(
    'Refusing: STRIPE_SECRET_KEY is missing or does not start with "sk_test_". This seed creates and ' +
      "confirms a real PaymentIntent — point .env.local at your Stripe test-mode key.",
  );
  process.exit(1);
}

const today = vesselDateOf(new Date());
const demo = reservationDemo(today);
const repo = PostgresRepository.fromConnectionString(url);

const DATE = addDays(today, 14);
const TIME = "11:30";
const NAME = "Reconciler Test";
/** The checkout began 20 minutes past its payment window: timed out, and not yet 2 hours late. */
const reservedAt = new Date(Date.now() - (PAYMENT_WINDOW_MINUTES + 20) * 60_000).toISOString();

try {
  if (!(await repo.getOffering(asId<"OfferingId">(demo.offeringId)))) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  const start = await createDeparturePaymentIntent(
    repo,
    new StripePaymentPort(secretKey, ""),
    {
      offeringId: asId<"OfferingId">(demo.offeringId),
      date: DATE,
      time: TIME,
      guestCount: 4,
      gratuityBps: 2000,
      customerName: NAME,
      phone: "216-555-1236",
      // A fresh holder per run: each run writes a new checkout.
      holderToken: randomUUID().replaceAll("-", ""),
    },
    () => reservedAt,
  );
  if (!start.ok) {
    console.error(`Checkout refused: ${start.reason} (${DATE} ${TIME}) — reseed \`npm run db:seed:reservation\` first.`);
    process.exit(1);
  }

  // Pay it the way the sandbox test does, minus the browser. A test card never redirects.
  const paid = await new Stripe(secretKey).paymentIntents.confirm(start.paymentIntentId, {
    payment_method: "pm_card_visa",
    return_url: "https://example.invalid/return",
  });
  if (paid.status !== "succeeded") throw new Error(`The test payment did not succeed: ${paid.status}`);

  const row = await repo.getReservationByPaymentIntentId(start.paymentIntentId);
  if (!row) throw new Error("The checkout's row is gone.");
  console.log(`✓ A paid, timed-out checkout (db: ${new URL(url).host}, Stripe test mode).`);
  console.log(`  customer   ${NAME}  ${DATE} ${TIME}  ${demo.vesselName}  4 guests`);
  console.log(`  payment    ${start.paymentIntentId}   (Stripe test dashboard: Payments)`);
  console.log(`  address    /admin/calendar/${row.id}   not found until a tick books it; then reads Booked, "via reconciler"`);
} finally {
  await repo.close();
}
