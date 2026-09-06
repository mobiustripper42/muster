/**
 * `db:paid-unbooked` — drive a **paid-but-unbooked** charge through the real webhook handler
 * against the local DB, and print what the safety net did (#613).
 *
 * The two ways a customer's card is charged and no booking exists:
 *
 *   --lost        the residual race (DEC-109): their 15-minute hold expired mid-payment, a rival
 *                 took the freed slot and paid first, then their payment landed. Expected:
 *                 AUTO-REFUND + a "sold out while you were paying" notice to the customer, and
 *                 NO operator alert — nothing needs a human.
 *   --unbookable  the anomaly (default): the charge names an event that isn't there. Deliberately
 *                 NOT auto-refunded — expected: a loud REFUND MANUALLY alert for the operator.
 *
 * **Why this script exists — and what it does NOT prove.** Both states are absolutely reachable
 * through the app, by clicking; that is the whole problem, and real customers get here. What is
 * hard is reaching them ON DEMAND: the race needs two buyers colliding inside one 15-minute hold
 * window, and the anomaly needs a trip to vanish mid-checkout.
 *
 * So this script does not create a race. It forces the claim to fail, which is what LOSING one
 * looks like to this code, and then shows what the handler does about it. That the losing branch
 * refunds, notifies and writes no orphan row is proven here and in `postgres-repository.test.ts`.
 * That a real concurrent collision actually produces that losing branch is a separate claim, and
 * it is proven separately — "two buyers, one seat, concurrently" in the same Postgres suite runs
 * two genuine simultaneous bookings and asserts the boat is sold exactly once.
 *
 * Before #613 both states crashed on the `payments`→`reservations` foreign key, which took out the
 * refund, the customer notice AND the operator alert — charged, unbooked, unrefunded, unreported.
 *
 * Uses `FakePaymentPort`, so **no Stripe keys and no network** — the refund is recorded in-process
 * and printed. For the real-Stripe path see `npm run db:checkout`.
 *
 *   npm run db:paid-unbooked                # the unbookable anomaly → expect an operator alert
 *   npm run db:paid-unbooked -- --lost      # the residual race     → expect refund + customer notice
 *   npm run db:paid-unbooked -- --force     # bypass the local-DB guard
 *
 * Idempotent: it truncates nothing and uses ids derived from the run, so it can be re-run and
 * composed with `npm run db:seed:reservation` in either order.
 */
import { existsSync } from "node:fs";
import { FAKE_SIGNATURE, FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import {
  processBookingWebhook,
  paymentIdFor,
  type WebhookDeps,
} from "../src/reservations/booking-webhook.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const lost = args.includes("--lost");
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard (mirrors db:seed:reservation): this writes synthetic rows.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const repo = PostgresRepository.fromConnectionString(url);
const payments = new FakePaymentPort();

const alerts: string[] = [];
const notices: string[] = [];

const paymentIntentId = `pi_${stamp}`;

try {
  // 14.5: booking is a FLIP of the pending row checkout wrote (§2.8.6), keyed on the PaymentIntent
  // id. Both scenarios run the inline-Elements `payment_intent.succeeded` path.
  if (lost) {
    // The residual race: checkout wrote a pending row, but between our checks and our write a
    // rival won the boat, so the flip loses. Seed the pending row so confirm FINDS it, then stub
    // the flip to `lost` — a real rival win cannot be produced by sequencing alone.
    await repo.saveReservation({
      id: asId<"ReservationId">(`resv-paid-unbooked-${stamp}`),
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "Test Customer",
      email: "test-customer@example.test",
      partySize: 6,
      vesselId: asId<"VesselId">("vessel-brew-2"),
      date,
      time: "17:00",
      offeringId: asId<"OfferingId">("offering-paid-unbooked"),
      reservedAt: new Date().toISOString(),
      holdMinutes: 120,
      tripMinutes: 100,
      paymentIntentId,
    });
  }
  // …and for --unbookable we send a purposed PI with NO pending row behind it — the
  // deterministic unconfirmable: a paid charge that resolves to no reservation (§2.8.6).

  // Losing the flip is what a rival winning the boat looks like to this code, and it cannot be
  // produced by sequencing alone. A Proxy rather than `Object.create`, because the repository
  // keeps its pool in a `#private` field that prototype delegation cannot carry. `getReservation
  // ByPaymentIntentId` stays real, so confirm still FINDS the seeded pending row before the flip.
  const target: PostgresRepository = lost
    ? (new Proxy(repo, {
        get(t, prop) {
          if (prop === "bookPendingIfHullFree") return async () => ({ result: "lost" });
          const v = Reflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }) as PostgresRepository)
    : repo;

  const deps: WebhookDeps = {
    repo: target,
    reservationsEnabled: true,
    payments,
    now: () => new Date().toISOString(),
    alertPaidButUnbooked: async (m) => void alerts.push(m),
    sendConfirmation: async () => {},
    notifyCustomerSoldOut: async (c) => void notices.push(String(c.metadata.email ?? "(no email)")),
  };

  const body = JSON.stringify({
    type: "payment_succeeded",
    data: {
      paymentIntentId,
      amountReceivedCents: 53625,
      currency: "usd",
      metadata: {
        purpose: "booking",
        offeringId: "offering-paid-unbooked",
        vesselId: "vessel-brew-2",
        date,
        time: "17:00",
        guestCount: "6",
        priceCents: "50000",
        kind: "full",
        taxCents: "3625",
        customerName: "Test Customer",
        email: "test-customer@example.test",
      },
    },
  });

  const result = await processBookingWebhook(deps, body, FAKE_SIGNATURE);
  const orphan = await repo.getPayment(paymentIdFor(paymentIntentId));

  console.log(`\n  scenario         ${lost ? "--lost (residual race)" : "--unbookable (anomaly)"}`);
  console.log(`  webhook outcome  ${JSON.stringify(result)}`);
  console.log(`  auto-refunds     ${payments.refunds.length}`);
  console.log(`  customer told    ${notices.length ? notices.join(", ") : "no"}`);
  console.log(`  operator alerts  ${alerts.length}`);
  for (const a of alerts) console.log(`                   ${a}`);
  console.log(`  orphan payment   ${orphan ? "YES — BUG" : "none (correct)"}`);

  const ok = lost
    ? payments.refunds.length === 1 && notices.length === 1 && alerts.length === 0 && !orphan
    : alerts.length === 1 && !orphan;
  console.log(
    ok
      ? `\n  ✓ the safety net ran. Before #613 this threw on the payments→reservations FK and\n` +
          `    none of the above happened — charged, unbooked, unrefunded, unreported.\n`
      : `\n  ✗ unexpected — the safety net did NOT behave as documented above.\n`,
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await repo.close();
}
