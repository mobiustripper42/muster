/**
 * `db:paid-unbooked` — drive a **paid-but-unbooked** charge through the real webhook handler
 * against the local DB, and print what the safety net did (#613).
 *
 * The two ways a customer's card is charged and no booking exists:
 *
 *   --lost        the residual race (`docs/SPEC.md` §2.8.7): their 15-minute hold expired
 *                 mid-payment, a rival took the freed slot and paid first, then their payment
 *                 landed. Expected: AUTO-REFUND + a "sold out while you were paying" notice to
 *                 the customer, and ONE operator alert that does NOT ask for a manual refund
 *                 (15.5 — nothing needs a human, but a customer was charged for a trip they did
 *                 not get, and how often that happens is the evidence deciding issue #1012).
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
import { soldOutNoticeBody } from "../src/reservations/sold-out-notice.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const lost = args.includes("--lost");
/** `--name "<whatever>"` — the booking name. Free text at the real checkout, which is only
 *  trimmed and checked non-empty, so this is what an attacker can actually send. Exists so the
 *  operator can see for themselves that a name shaped like an instruction cannot forge the
 *  operator alert (15.5, `/security-review`). */
const nameFlag = args.indexOf("--name");
const customerName = nameFlag >= 0 ? (args[nameFlag + 1] ?? "Test Customer") : "Test Customer";
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
const noticeBodies: string[] = [];

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
      customerName,
      email: "test-customer@example.test",
      partySize: 6,
      vesselId: asId<"VesselId">("vessel-brew-2"),
      date,
      time: "17:00",
      offeringId: asId<"OfferingId">("offering-paid-unbooked"),
      reservedAt: new Date().toISOString(),
      holdMinutes: 120,
      tripMinutes: 100,
      // Plural since the pending-slot migration — a pending row accumulates a PI per
      // checkout attempt. This script still wrote the old singular field, and nothing
      // read it: `Reservation` has no `paymentIntentId`, so the object literal simply
      // carried a stray key and the seeded row had no PI at all (#904 rule 7).
      paymentIntentIds: [paymentIntentId],
      // Confirm reads the money off the row as of 15.6 — a pending row without an invoice cannot
      // be flipped, so it would refuse before ever reaching the residual-race branch this script
      // exists to demonstrate. `typecheck:db` cannot catch that; only running it can.
      invoice: {
        fareCents: 50000,
        extrasCents: 0,
        taxCents: 3625,
        taxRateBps: 725,
        serviceFeeCents: 1500,
        serviceFeeBps: 300,
        gratuityCents: 10000,
        gratuityBps: 2000,
        totalCents: 65125,
        amountDueNowCents: 65125,
      },
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
    // `true` = "the customer was told" (15.3). This script exercises the paid-but-unbooked
    // alert, not the confirmation, so reporting success keeps the claim on the row and stops the
    // seeded booking from looking like one nobody was told about.
    sendConfirmation: async () => true,
    // The contact comes off the reservation row now (15.5), not the charge metadata. The BODY is
    // composed here rather than only the recipient recorded: this script is how a person checks
    // the customer-facing copy, and printing an email address proves the plumbing while showing
    // nothing of what the customer actually reads.
    notifyCustomerSoldOut: async (c) => {
      notices.push(c.contact.email ?? "(no email)");
      noticeBodies.push(soldOutNoticeBody(c.contact.customerName));
    },
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
        customerName,
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
  // The message a HUMAN reads, printed verbatim after the summary — the only way to check the
  // copy without producing a real race. This is the one that used to claim "You have NOT been
  // charged" while the customer's statement said otherwise for days (15.5).
  for (const b of noticeBodies) {
    console.log(`\n  --- what the customer is sent ---`);
    for (const line of b.split("\n")) console.log(`  ${line}`);
  }

  // On `--lost` the operator IS alerted now (15.5) — one informational alert, which must NOT ask
  // for a manual refund, because the auto-refund already ran. This assertion read
  // `alerts.length === 0` until 15.5 and would have reported the new behaviour as a failure; the
  // script is outside `verify`, so nothing but running it would have said so.
  const informationalAlert =
    alerts.length === 1 && !alerts[0]!.includes("REFUND MANUALLY");
  const ok = lost
    ? payments.refunds.length === 1 && notices.length === 1 && informationalAlert && !orphan
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
