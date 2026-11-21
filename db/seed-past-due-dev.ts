/**
 * `db:seed:past-due` — a past-due deposit booking for `/admin/purchases` (issue #1142), so the
 * **Balance due** chip and the Owed column's `past due · card_declined` have a row to show without
 * waiting a day for a real balance to fall due.
 *
 *   - **Odell Pruitt, 12 days out at 11:30** — a $100 deposit paid, the balance's due date
 *     yesterday, and one balance attempt that `declined` with `card_declined`. Under **Balance due**
 *     from any window, and in the window of its trip day with the Owed cell reading
 *     `past due · card_declined` in the bad tone.
 *
 * The booking goes through the real paths — `bookForCustomer`, then `confirmBookingFromIntent` on a
 * payment for the deposit — as `db:seed:self-cancel` books its deposit rows; only the due date is
 * moved to yesterday and the declined attempt row written, since no tick has run here.
 *
 * It is not in `db:seed:reservation`: `resetAndSeed("reservation")` runs that file for 19 e2e specs,
 * and `e2e/purchases.spec.ts` asserts every badge reads `unpaid`.
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering this books:
 *
 *   npm run db:seed:reservation && npm run db:seed:past-due
 *   npm run db:seed:past-due -- --force   # bypass the local-DB guard
 *
 * For a balance due today instead, `npm run db:balance-due -- <booking code>`. Re-running is safe: a
 * slot already held refuses as `busy`, which is printed and skipped, so no second attempt row is
 * written.
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { balanceDates } from "../src/reservations/availability.js";
import { confirmBookingFromIntent } from "../src/reservations/confirm-booking.js";
import { bookForCustomer } from "../src/reservations/operator-booking.js";
import { dueNowCents } from "../src/reservations/payment-config.js";
import { demoBookingCode, reservationDemo } from "../src/reservations/seed-reservation.js";
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

const today = vesselDateOf(new Date());
const demo = reservationDemo(today);
const now = () => new Date().toISOString();
const repo = PostgresRepository.fromConnectionString(url);
const payments = new FakePaymentPort();

const DATE = addDays(today, 12);
const TIME = "11:30";
const NAME = "Odell Pruitt";

try {
  if (!(await repo.getOffering(asId<"OfferingId">(demo.offeringId)))) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  console.log(`✓ Past-due balance (db: ${new URL(url).host}).`);

  const res = await bookForCustomer(
    repo,
    {
      offeringId: asId<"OfferingId">(demo.offeringId),
      vesselId: asId<"VesselId">(demo.vesselId),
      date: DATE,
      time: TIME,
      guestCount: 6,
      gratuityBps: 2000,
      customerName: NAME,
      phone: "216-555-1142",
      hasFlex: false,
    },
    now,
  );
  if (!res.ok) {
    console.log(`  skipped   ${DATE} ${TIME}  ${NAME} — ${res.reason} (already seeded, or the slot is taken)`);
  } else {
    // Only the deposit is paid, and its balance fell due yesterday.
    const config = await repo.getPaymentConfig();
    const dates = balanceDates(DATE, TIME, config);
    const dueAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const invoice = {
      ...res.reservation.invoice!,
      amountDueNowCents: dueNowCents(res.reservation.invoice!.totalCents, config.depositCents),
    };
    const pi = `pi_seed_past_due_${res.reservation.id}`;
    await repo.saveReservation({
      ...res.reservation,
      invoice,
      balanceDueAt: dueAt,
      balanceReleaseAt: dates.releaseAt,
      paymentIntentIds: [pi],
    });
    const outcome = await confirmBookingFromIntent(
      {
        repo,
        payments,
        now,
        alertPaidButUnbooked: async (m) => void console.error(`  ALERT     ${m}`),
        notifyCustomerSoldOut: async () => {},
        // Nobody is texted from a seed; the row says nobody was told, which is true.
        sendConfirmation: async () => false,
      },
      { paymentIntentId: pi, amountReceivedCents: invoice.amountDueNowCents, currency: "usd", metadata: {} },
    );
    const code = demoBookingCode(String(res.reservation.id));
    if (!(await repo.getBookingCode(code))) {
      await repo.saveBookingCode({ code, reservationId: res.reservation.id, createdAt: now() });
    }
    // The charge run's first try, declined — what the Owed cell reads after `past due · `.
    await repo.claimBalanceAttempt({ reservationId: res.reservation.id, attempt: 0, at: now() });
    await repo.finishBalanceAttempt({
      reservationId: res.reservation.id,
      attempt: 0,
      outcome: "declined",
      declineCode: "card_declined",
    });
    console.log(`  past due  ${DATE} ${TIME}  ${demo.vesselName}  6 guests  ${NAME} — ${JSON.stringify(outcome)}`);
    console.log(
      `            /admin/purchases?state=balance_due   the row, from any window; Owed reads "past due · card_declined"; /b/${code}`,
    );
  }
} finally {
  await repo.close();
}
