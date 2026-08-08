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
import type { Event } from "../src/domain/entities.js";
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
const sessionId = `cs_paidunbooked_${stamp}`;
const eventId = asId<"EventId">(`evt-paid-unbooked-${stamp}`);
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const repo = PostgresRepository.fromConnectionString(url);
const payments = new FakePaymentPort();

const alerts: string[] = [];
const notices: string[] = [];

try {
  if (lost) {
    // A real event to buy — the race is about losing the CLAIM, not a missing trip.
    const event: Event = {
      id: eventId,
      vesselId: asId<"VesselId">("vessel-brew-2"),
      date,
      time: "17:00",
      capacity: 12,
      status: "scheduled",
      source: "muster",
      price: 50000,
    };
    await repo.saveEvent(event);
  }
  // …and for --unbookable we deliberately send a SLOTLESS session, which #693 made the
  // deterministic unbookable. It used to be `event_missing` — a charge naming an event that does
  // not exist — but a slot booking materializes its own event, so a missing one is no longer a
  // failure. See the metadata below, which drops the slot fields in that mode.

  // Losing the CAS is what a rival winning the boat looks like to this code, and it cannot be
  // produced by sequencing alone. A Proxy rather than `Object.create`, because the repository
  // keeps its pool in a `#private` field that prototype delegation cannot carry.
  const target: PostgresRepository = lost
    ? (new Proxy(repo, {
        get(t, prop) {
          // `saveBookingIfSlotFree` since #693 retired the row-lock claim. Stubbing the method
          // nothing calls any more would have left this script printing a PASS while simulating
          // nothing — the exact failure it exists to catch elsewhere.
          if (prop === "saveBookingIfSlotFree") return async () => ({ result: "lost" });
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
    sessionId,
    paymentIntentId: `pi_${stamp}`,
    amountTotalCents: 53625,
    currency: "usd",
    // Slot-shaped for --lost (the only booking shape the webhook accepts since #693); slotless
    // for --unbookable, which is now what "deterministically cannot be booked" means.
    metadata: {
      ...(lost
        ? {
            offeringId: "offering-paid-unbooked",
            vesselId: "vessel-brew-2",
            date,
            time: "17:00",
            guestCount: "6",
            priceCents: "50000",
          }
        : { eventId: String(eventId), partySize: "6" }),
      kind: "full",
      taxCents: "3625",
      customerName: "Test Customer",
      email: "test-customer@example.test",
    },
  });

  const result = await processBookingWebhook(deps, body, FAKE_SIGNATURE);
  const orphan = await repo.getPayment(paymentIdFor(sessionId));

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
