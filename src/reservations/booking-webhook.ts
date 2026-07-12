/**
 * Process a Stripe `checkout.session.completed` webhook (Phase 11.2, DEC-107) — the
 * charge→booking spine. Verifies the signature (via the port), then writes the reservation
 * under the atomic whole-boat claim (11.3 `writeBooking`, keyed on the session id) and
 * records the `Payment`.
 *
 * **On a paid-but-unbooked outcome (`lost` — a rival took the boat in the race window — or
 * a post-payment `unbookable`): record the payment and LOUDLY ALERT ALL ADMINS to refund
 * manually.** Refunds are always manual (Stripe dashboard); nothing here refunds
 * automatically. Provider-agnostic + fully testable via `FakePaymentPort`.
 */
import type { Payment } from "../domain/entities.js";
import { asId, type EventId, type ReservationId } from "../domain/ids.js";
import type { CheckoutCompleted, PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
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
  | { handled: true; outcome: "booked" | "already" | "lost" | "unbookable" };

export async function processBookingWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string,
): Promise<WebhookResult> {
  const completed = deps.payments.parseCheckoutCompleted(rawBody, signature); // throws on bad sig
  if (!completed) return { handled: false };

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
  await deps.alertPaidButUnbooked(
    `⚠️ Paid booking could NOT be placed (${result.outcome}) — Stripe session ${completed.sessionId}, ` +
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
