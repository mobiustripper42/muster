/**
 * `db:seed:refund-states` — cancelled bookings with a refund record in each state (issue #1278), so the
 * job and the pane have something to read without cancelling a booking in Stripe first. Three PAID,
 * UNINSURED phone bookings on the demo offering, 30, 31 and 32 days out, each cancelled by its customer
 * in the cancel's own write, which is what also inserts the refund it owes:
 *
 *   - **Odalys Ferrante, 30 days out at 10:30** — her refund record is **unfinished and fresh**: written
 *     now, no legs yet, a break right after step 1. The job leaves it alone for five minutes and then
 *     plans, sends and finishes it. Against Stripe test mode that finds no such PaymentIntent, so this
 *     one is for watching the takeover age, not for a refund that goes through.
 *   - **Tobias Renfro, 31 days out at 10:30** — his record is **finished short**: the provider refused
 *     the only leg (`card_declined`), nothing moved. The pane reads the refund as short and the history
 *     carries a failed-refund row.
 *   - **Marguerite Anselm, 32 days out at 10:30** — her record is **unfinished for 25 hours**, past the
 *     24 hours Stripe keeps an idempotency key. The next tick gives it up without a port call: it is
 *     finished short for the whole amount, the admins are texted (its console line, when texts are
 *     dark) and the history gains a failed-refund row. This is the state AC27 starts from.
 *
 * Every booking goes through the real paths, not hand-written rows: `bookForCustomer`, then
 * `confirmBookingFromIntent` on a payment for exactly what the row froze — the self-cancel seed's route
 * — and the cancel is the repository's one write, `cancelBookingAndRelease`, given the record. Times
 * differ from `db:seed:self-cancel`'s (it uses 11:30–15:30 on other days), so the two compose.
 * `FakePaymentPort`, so no Stripe keys and no network.
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering these book:
 *
 *   npm run db:seed:reservation && npm run db:seed:refund-states
 *   npm run db:seed:refund-states -- --force   # bypass the local-DB guard
 *
 * Re-running is safe. A cancel frees its slot, so a re-run books each one again and writes a fresh
 * record: the records' ids are taken from their booking's id, so they never collide. The reset is
 * `npm run db:reset:dev`, then this seed.
 */
import { existsSync } from "node:fs";
import { FakePaymentPort } from "../src/adapters/fake-payment.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import type { NewRefundRecord, Reservation } from "../src/domain/entities.js";
import { demoBookingCode, reservationDemo } from "../src/reservations/seed-reservation.js";
import { confirmBookingFromIntent } from "../src/reservations/confirm-booking.js";
import { customerCancelQuote } from "../src/reservations/customer-cancel.js";
import { bookForCustomer } from "../src/reservations/operator-booking.js";
import { planRefund, REFUND_GIVE_UP_AFTER_MS } from "../src/reservations/refund-payment.js";
import { recordTrail } from "../src/reservations/trail.js";
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

/** Book it and pay it, as a paid link confirms it: a payment for exactly what the row froze. */
async function bookPaid(
  date: string,
  time: string,
  customerName: string,
  phone: string,
): Promise<{ row: Reservation; code: string } | null> {
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
  const row = res.reservation;
  const pi = `pi_seed_refund_states_${row.id}`;
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

/**
 * The customer cancels: the reservation, its boat and the refund it owes, in the repository's one write.
 * `createdAt` is when the record was written — the age the job's takeover and give-up are measured from.
 */
async function cancelOwing(
  booked: { row: Reservation; code: string },
  createdAt: string,
): Promise<{ record: NewRefundRecord; cents: number } | null> {
  const reservation = (await repo.getReservation(booked.row.id))!;
  const event = reservation.eventId ? await repo.getEvent(reservation.eventId) : null;
  const paid = await repo.listPaymentsForReservation(booked.row.id);
  const quote = customerCancelQuote({ reservation, event, payments: paid, now: new Date() });
  if (!quote || !reservation.eventId) {
    console.error(`  ALERT     ${reservation.customerName}'s booking is not cancellable by the customer — nothing to seed`);
    return null;
  }
  const record: NewRefundRecord = {
    id: asId<"RefundRecordId">(`rr_seed_${booked.row.id}`),
    reservationId: booked.row.id,
    reason: "customer_cancel",
    actorKind: "customer",
    askedCents: quote.refundCents,
    expectedRefundedCents: quote.expectedRefundedCents,
    createdAt,
  };
  const written = await repo.cancelBookingAndRelease(booked.row.id, reservation.eventId, "customer", createdAt, record);
  if (!written.cancelled) {
    console.error(`  ALERT     ${reservation.customerName}'s booking was not cancelled (${written.refused ?? "already cancelled"})`);
    return null;
  }
  await recordTrail(
    { repo, now },
    {
      id: asId<"TrailEventId">(`cancelled:${record.id}`),
      reservationId: booked.row.id,
      actorKind: "customer",
      type: "cancelled",
      metadata: { reason: "cancelled by the customer from the booking page", quotedCents: quote.refundCents },
    },
  );
  return { record, cents: quote.refundCents };
}

try {
  if (!(await repo.getOffering(asId<"OfferingId">(demo.offeringId)))) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  console.log(`✓ Refund records in each state (db: ${new URL(url).host}).`);

  // ── Unfinished and fresh: a break right after step 1 ───────────────────────
  const fresh = await bookPaid(addDays(today, 30), "10:30", "Odalys Ferrante", "216-555-1278");
  if (fresh) {
    const owed = await cancelOwing(fresh, now());
    if (owed) {
      console.log(
        `  unfinished ${owed.record.id}  /admin/calendar/${fresh.row.id}   the refund of ${owed.cents}c is written, no legs, ` +
          `claimed just now: the job leaves it for five minutes, then sends it`,
      );
    }
  }

  // ── Finished short: the provider refused the only leg ──────────────────────
  const short = await bookPaid(addDays(today, 31), "10:30", "Tobias Renfro", "330-555-1278");
  if (short) {
    const owed = await cancelOwing(short, now());
    if (owed) {
      const plan = planRefund(await repo.listPaymentsForReservation(short.row.id), owed.cents, owed.record.expectedRefundedCents ?? 0);
      if (plan.ok && plan.legs[0]) {
        await repo.saveRefundLegs(owed.record.id, plan.legs);
        await repo.finishRefundLeg({ recordId: owed.record.id, paymentIntentId: plan.legs[0].paymentIntentId, outcome: "refused" });
        await repo.finishRefundRecord({
          id: owed.record.id,
          state: "short",
          movedCents: 0,
          shortReason: "card_declined",
          at: now(),
        });
        await recordTrail(
          { repo, now },
          {
            id: asId<"TrailEventId">(`refund_failed:${owed.record.id}`),
            reservationId: short.row.id,
            actorKind: "customer",
            type: "refund_failed",
            metadata: { actualCents: 0, reason: "card_declined" },
          },
        );
        console.log(
          `  short      ${owed.record.id}  /admin/calendar/${short.row.id}   ${owed.cents}c asked, 0c moved, refused ("card_declined"); ` +
            `the history carries a failed-refund row`,
        );
      }
    }
  }

  // ── Unfinished for 25 hours: the catch-all's input (AC27) ───────────────────
  const old = await bookPaid(addDays(today, 32), "10:30", "Marguerite Anselm", "440-555-1278");
  if (old) {
    const wroteAt = new Date(Date.now() - REFUND_GIVE_UP_AFTER_MS - 60 * 60_000).toISOString();
    const owed = await cancelOwing(old, wroteAt);
    if (owed) {
      console.log(
        `  gave up    ${owed.record.id}  /admin/calendar/${old.row.id}   written 25 hours ago: the next tick finishes it short ` +
          `for ${owed.cents}c with no Stripe call, texts every active admin, and adds a failed-refund row to the history`,
      );
    }
  }
} finally {
  await repo.close();
}
