/**
 * Process a Stripe `checkout.session.completed` webhook (Phase 11.2, DEC-107).
 *
 * Dispatches on `metadata.purpose` (11.2b): `"balance"` → record a `Payment{kind:'balance'}`
 * against the already-claimed reservation (no re-booking); absent/`"booking"` → the
 * charge→booking spine (verify sig, `writeBooking` under the atomic whole-boat claim, record
 * the `Payment`). Any OTHER purpose is loudly flagged, never silently booked (a non-booking
 * session has no `eventId` and would orphan a reservation).
 *
 * **On a paid-but-unbooked outcome (`lost`/`unbookable`) or an OVERPAID balance: record the
 * payment and LOUDLY ALERT ALL ADMINS to refund manually.** Refunds are always manual (Stripe
 * dashboard); nothing here refunds automatically. Provider-agnostic + `FakePaymentPort`-testable.
 */
import type { Payment } from "../domain/entities.js";
import { asId, type EventId, type ReservationId } from "../domain/ids.js";
import type { CheckoutCompleted, PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceOwedCents } from "./payment-config.js";
import { reservationIdFor, writeBooking } from "./write-booking.js";

export interface WebhookDeps {
  repo: Repository;
  payments: PaymentPort;
  now: () => string;
  /**
   * Loudly notify all active admins that a PAID customer has no booking and needs a manual
   * refund (lost the boat, or a post-payment un-bookable). This is the alert, NOT the
   * refund — refunds are always manual in the Stripe dashboard.
   */
  alertPaidButUnbooked: (message: string) => Promise<void>;
}

export type WebhookResult =
  | { handled: false } // verified but not a checkout.session.completed event → ack + ignore
  | {
      handled: true;
      outcome: "booked" | "already" | "lost" | "unbookable" | "balance_paid" | "ignored";
    };

export async function processBookingWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string,
): Promise<WebhookResult> {
  const completed = deps.payments.parseCheckoutCompleted(rawBody, signature); // throws on bad sig
  if (!completed) return { handled: false };

  // Dispatch on purpose (11.2b). A balance payment records against the existing reservation;
  // it must NEVER reach the booking path (no eventId → an orphan reservation).
  const purpose = completed.metadata.purpose;
  if (purpose === "balance") return recordBalancePayment(deps, completed);
  if (purpose !== undefined && purpose !== "booking") {
    await deps.alertPaidButUnbooked(
      `⚠️ Stripe checkout with unknown purpose="${purpose}" — session ${completed.sessionId}. ` +
        `NOT auto-processed; investigate (money may have moved).`,
    );
    return { handled: true, outcome: "ignored" };
  }

  const m = completed.metadata;
  const idempotencyKey = completed.sessionId; // Stripe's session id keys the booking
  const kind = m.kind === "deposit" ? "deposit" : "full";
  const partySize = Number(m.partySize);
  const reservationId = reservationIdFor(idempotencyKey);

  const result = await writeBooking(
    deps.repo,
    {
      eventId: asId<"EventId">(m.eventId ?? ""),
      customerName: m.customerName ?? "",
      partySize,
      ...(m.email ? { email: m.email } : {}),
      ...(m.phone ? { phone: m.phone } : {}),
      idempotencyKey,
    },
    deps.now,
  );

  // The money moved — record the Payment against the (would-be) reservation either way.
  await recordPayment(deps, completed, kind, reservationId);

  if (result.outcome === "booked" || result.outcome === "already") {
    return { handled: true, outcome: result.outcome };
  }

  // Paid but no booking (lost the race, or the event changed post-payment) → manual-refund alert.
  const detail = result.outcome === "unbookable" ? `${result.outcome}/${result.reason}` : result.outcome;
  await deps.alertPaidButUnbooked(
    `⚠️ Paid booking could NOT be placed (${detail}) — Stripe session ${completed.sessionId}, ` +
      `${m.customerName || "customer"} party of ${partySize}. REFUND MANUALLY in Stripe.`,
  );
  return { handled: true, outcome: result.outcome };
}

async function recordPayment(
  deps: WebhookDeps,
  completed: CheckoutCompleted,
  kind: "full" | "deposit",
  reservationId: ReservationId,
): Promise<void> {
  const payment: Payment = {
    id: asId<"PaymentId">(`pay_${completed.sessionId}`), // deterministic ⇒ idempotent upsert
    reservationId,
    method: "stripe",
    kind,
    amountCents: completed.amountTotalCents,
    taxCents: Number(completed.metadata.taxCents ?? 0),
    currency: completed.currency,
    stripeCheckoutSessionId: completed.sessionId,
    ...(completed.paymentIntentId ? { stripePaymentIntentId: completed.paymentIntentId } : {}),
    status: "succeeded",
    createdAt: deps.now(),
  };
  await deps.repo.savePayment(payment);
}

/**
 * Record an on-demand BALANCE payment (11.2b) against an already-claimed reservation. No
 * `writeBooking` (the boat was won at deposit, DEC-109), no confirmation emit. The Payment
 * id is deterministic from the balance session id, so a re-delivery is idempotent.
 *
 * Overpay guard: a two-session race (two balance checkouts, both paid) over-collects. The
 * append log must reflect the money that moved, so we record then — if the derived balance
 * has gone NEGATIVE — loudly flag the excess for a MANUAL refund (DEC-107 posture).
 */
async function recordBalancePayment(
  deps: WebhookDeps,
  completed: CheckoutCompleted,
): Promise<WebhookResult> {
  const reservationId = asId<"ReservationId">(completed.metadata.reservationId ?? "");
  const payment: Payment = {
    id: asId<"PaymentId">(`pay_${completed.sessionId}`),
    reservationId,
    method: "stripe",
    kind: "balance",
    amountCents: completed.amountTotalCents,
    taxCents: 0, // the balance carries no tax — it was collected in full with the deposit
    currency: completed.currency,
    stripeCheckoutSessionId: completed.sessionId,
    ...(completed.paymentIntentId ? { stripePaymentIntentId: completed.paymentIntentId } : {}),
    status: "succeeded",
    createdAt: deps.now(),
  };
  await deps.repo.savePayment(payment);

  const reservation = await deps.repo.getReservation(reservationId);
  const event = reservation ? await deps.repo.getEvent(reservation.eventId) : null;
  if (reservation && event?.price !== undefined) {
    const config = await deps.repo.getPaymentConfig();
    const payments = await deps.repo.listPaymentsForReservation(reservationId);
    const owed = balanceOwedCents(event.price, config.taxRateBps, payments);
    if (owed < 0) {
      await deps.alertPaidButUnbooked(
        `⚠️ Reservation ${reservationId} OVERPAID by ${-owed} cents — a balance was likely paid ` +
          `twice (two checkout sessions raced). REFUND the excess MANUALLY in Stripe.`,
      );
    }
  }
  return { handled: true, outcome: "balance_paid" };
}
