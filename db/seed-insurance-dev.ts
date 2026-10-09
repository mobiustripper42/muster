/**
 * `db:seed:insurance` — two bookings with cancellation insurance (16.8, issue #683), so every surface
 * that shows it has a state to open without clicking through a booking first.
 *
 *   - **Paid, five days out.** Inside the 14-day window, outside 72 hours: the one place insurance
 *     changes the refund. Its manage page shows the insurance row and the 72-hour terms; its pane's
 *     "Customer cancelled" quote is what they paid minus the $30 — no $50 fee — where an uninsured
 *     booking quotes $0.
 *   - **Unpaid phone booking, six days out.** Its pane shows the insurance row on the quote, and the
 *     payment link it copies shows the row and the 72-hour terms.
 *
 * Both go through the real paths, not hand-written rows: `bookForCustomer` with the box ticked (the
 * operator's phone booking), and for the paid one the real confirm on a payment for exactly what
 * the row froze — so the payment's insurance carve-out is the webhook's own, not this script's.
 * `FakePaymentPort`, so no Stripe keys and no network.
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering these book.
 * Re-running is safe: a slot already held refuses as `busy`, which is printed and skipped.
 *
 *   npm run db:seed:reservation && npm run db:seed:insurance
 *   npm run db:seed:insurance -- --force   # bypass the local-DB guard
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import type { Reservation } from "../src/domain/entities.js";
import { confirmBookingFromIntent } from "../src/reservations/confirm-booking.js";
import { bookForCustomer } from "../src/reservations/operator-booking.js";
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

/** The operator books it on the phone, insurance ticked. */
async function phoneBook(date: string, customerName: string, phone: string): Promise<Reservation | null> {
  const res = await bookForCustomer(
    repo,
    {
      offeringId: asId<"OfferingId">(demo.offeringId),
      vesselId: asId<"VesselId">(demo.vesselId),
      date,
      time: "17:30",
      guestCount: 6,
      gratuityBps: 2000,
      customerName,
      phone,
      hasFlex: true,
    },
    now,
  );
  if (!res.ok) {
    console.log(`  skipped   ${date} 17:30  ${customerName} — ${res.reason} (already seeded, or the slot is taken)`);
    return null;
  }
  return res.reservation;
}

try {
  if (!(await repo.getOffering(asId<"OfferingId">(demo.offeringId)))) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  console.log(`✓ Cancellation insurance (db: ${new URL(url).host}).`);

  // ── Paid, five days out ────────────────────────────────────────────────────
  const paidDate = addDays(today, 5);
  const row = await phoneBook(paidDate, "Quint Harlan", "216-555-0683");
  if (row) {
    // A payment for exactly what the row froze, confirmed the way a paid link confirms it.
    const pi = `pi_seed_insurance_${row.id}`;
    await repo.saveReservation({ ...row, paymentIntentIds: [pi] });
    const outcome = await confirmBookingFromIntent(
      {
        repo,
        payments: new FakePaymentPort(),
        now,
        alertPaidButUnbooked: async (m) => void console.error(`  ALERT     ${m}`),
        notifyCustomerSoldOut: async () => {},
        // Nobody is texted from a seed; the row says nobody was told, which is true.
        sendConfirmation: async () => false,
      },
      { paymentIntentId: pi, amountReceivedCents: row.invoice!.amountDueNowCents, currency: "usd", metadata: {} },
    );
    const code = demoBookingCode(String(row.id));
    if (!(await repo.getBookingCode(code))) {
      await repo.saveBookingCode({ code, reservationId: row.id, createdAt: now() });
    }
    console.log(`  paid      ${paidDate} 17:30  ${demo.vesselName}  6 guests  Quint Harlan — ${JSON.stringify(outcome)}`);
    console.log(`            /b/${code}   insurance row, 72-hour terms`);
    console.log(`            /admin/calendar/${String(row.id)}   insurance row; "Customer cancelled" quotes paid − $30, no $50`);
  }

  // ── Unpaid phone booking, six days out ─────────────────────────────────────
  const unpaidDate = addDays(today, 6);
  const unpaid = await phoneBook(unpaidDate, "Ellen Brody", "440-555-0683");
  if (unpaid) {
    console.log(`  unpaid    ${unpaidDate} 17:30  ${demo.vesselName}  6 guests  Ellen Brody`);
    console.log(`            /admin/calendar/${String(unpaid.id)}   insurance row on the quote; Copy link → /p shows it`);
  }
} finally {
  await repo.close();
}
