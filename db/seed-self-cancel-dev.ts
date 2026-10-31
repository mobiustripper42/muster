/**
 * `db:seed:self-cancel` — the self-service cancellation states (16.9, issue #1074), so the manage
 * page's Cancel has a booking to open without clicking through a booking first. Three PAID,
 * UNINSURED phone bookings on the demo offering:
 *
 *   - **Rhea Tallis, 20 days out at 15:30** — Cancel is offered, on the `fee` basis: the confirm
 *     reads paid minus the $50.
 *   - **Gil Moreau, 5 days out at 13:30** — inside the 14-day window. The page shows the "Request
 *     cancellation" form and no Cancel.
 *   - **Pell Ostrander, 20 days out at 13:30** — then cancelled through `cancelByCustomer`, on
 *     `FakePaymentPort`, so it carries the customer's `cancelled` trail row and a real `issued`
 *     refund. Open it at `?cancelled=1&refund=issued` to see the notice with its trail figure.
 *
 * Every booking goes through the real paths, not hand-written rows: `bookForCustomer` with
 * `hasFlex: false`, then `confirmBookingFromIntent` on a payment for exactly what the row froze —
 * the insurance seed's route. Times differ from its 17:30 so the two compose. `FakePaymentPort`, so
 * no Stripe keys and no network. (Pressing Cancel booking in the browser on Rhea's booking is not
 * the same: the app uses the real Stripe port, and test-mode Stripe has never seen this seed's
 * PaymentIntent id, so it refuses the refund — the page lands on the `failed` notice.)
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering these book:
 *
 *   npm run db:seed:reservation && npm run db:seed:insurance && npm run db:seed:self-cancel
 *   npm run db:seed:self-cancel -- --force   # bypass the local-DB guard
 *
 * Re-running is safe. A slot already held refuses as `busy`, which is printed and skipped. A
 * cancelled booking frees its slot, so it is skipped by finding the cancelled booking for that
 * customer and date instead. A cancel frees the hull: re-running books that slot again and prints a
 * fresh `/b/` link.
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import type { Reservation } from "../src/domain/entities.js";
import { formatCents } from "../src/reservations/calendar-detail.js";
import { confirmBookingFromIntent } from "../src/reservations/confirm-booking.js";
import { cancelByCustomer, customerCancelQuote } from "../src/reservations/customer-cancel.js";
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
const payments = new FakePaymentPort();

/** The operator books it on the phone, no insurance. */
async function phoneBook(date: string, time: string, customerName: string, phone: string): Promise<Reservation | null> {
  const res = await bookForCustomer(
    repo,
    {
      offeringId: asId<"OfferingId">(demo.offeringId),
      vesselId: asId<"VesselId">(demo.vesselId),
      date,
      time,
      guestCount: 6,
      gratuityBps: 2000,
      customerName,
      phone,
      hasFlex: false,
    },
    now,
  );
  if (!res.ok) {
    console.log(`  skipped   ${date} ${time}  ${customerName} — ${res.reason} (already seeded, or the slot is taken)`);
    return null;
  }
  return res.reservation;
}

/** Book it and pay it: a payment for exactly what the row froze, confirmed as a paid link confirms it. */
async function bookPaid(date: string, time: string, customerName: string, phone: string): Promise<{ row: Reservation; code: string } | null> {
  const row = await phoneBook(date, time, customerName, phone);
  if (!row) return null;
  const pi = `pi_seed_self_cancel_${row.id}`;
  await repo.saveReservation({ ...row, paymentIntentIds: [pi] });
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
    { paymentIntentId: pi, amountReceivedCents: row.invoice!.amountDueNowCents, currency: "usd", metadata: {} },
  );
  const code = demoBookingCode(String(row.id));
  if (!(await repo.getBookingCode(code))) {
    await repo.saveBookingCode({ code, reservationId: row.id, createdAt: now() });
  }
  console.log(`  paid      ${date} ${time}  ${demo.vesselName}  6 guests  ${customerName} — ${JSON.stringify(outcome)}`);
  return { row, code };
}

try {
  if (!(await repo.getOffering(asId<"OfferingId">(demo.offeringId)))) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  console.log(`✓ Self-service cancellation (db: ${new URL(url).host}).`);

  // ── 20 days out: Cancel offered, the $50 fee ───────────────────────────────
  const farDate = addDays(today, 20);
  const rhea = await bookPaid(farDate, "15:30", "Rhea Tallis", "216-555-1074");
  if (rhea) {
    console.log(`            /b/${rhea.code}   Manage → "✕ Cancel booking"; the confirm reads paid − $50`);
  }

  // ── 5 days out: inside the window, the request form ────────────────────────
  const nearDate = addDays(today, 5);
  const gil = await bookPaid(nearDate, "13:30", "Gil Moreau", "440-555-1074");
  if (gil) {
    console.log(`            /b/${gil.code}   Manage → "✕ Request cancellation", no Cancel`);
  }

  // ── 20 days out, then cancelled by the customer ────────────────────────────
  // A cancelled booking frees its slot, so a re-run would book it again: skip on the cancelled row.
  const already = (await repo.listAllReservations()).some(
    (r) => r.customerName === "Pell Ostrander" && r.status === "cancelled" && r.date === farDate,
  );
  if (already) {
    console.log(`  skipped   ${farDate} 13:30  Pell Ostrander — already cancelled`);
  } else {
    const pell = await bookPaid(farDate, "13:30", "Pell Ostrander", "330-555-1074");
    if (pell) {
      const reservation = (await repo.getReservation(pell.row.id))!;
      const event = reservation.eventId ? await repo.getEvent(reservation.eventId) : null;
      const quote = customerCancelQuote({
        reservation,
        event,
        payments: await repo.listPaymentsForReservation(pell.row.id),
        now: new Date(),
      });
      if (!quote) {
        console.error("  ALERT     Pell Ostrander's booking is not cancellable by the customer — nothing to seed");
      } else {
        const outcome = await cancelByCustomer({ repo, now, payments }, pell.row.id, {
          quotedCents: quote.refundCents,
          expectedRefundedCents: quote.expectedRefundedCents,
        });
        console.log(`  cancelled ${farDate} 13:30  Pell Ostrander — ${JSON.stringify(outcome)}`);
        console.log(
          `            /b/${pell.code}?cancelled=1&refund=issued   the issued notice: ${formatCents(quote.refundCents)}, ` +
            `above the Cancelled badge and a "Refunded −${formatCents(quote.refundCents)}" row`,
        );
      }
    }
  }
} finally {
  await repo.close();
}
