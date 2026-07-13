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
import type { Payment, Reservation } from "../domain/entities.js";
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
  /**
   * Email + SMS the customer their booking-management link (11.4, DEC-119). Fires ONLY on a
   * fresh `booked` outcome — never on the idempotent `already` (Stripe redelivers
   * `checkout.session.completed`; each redelivery resolves to `already`, and re-sending would
   * re-notify the customer every retry). MUST be best-effort — a confirmation failure never
   * throws here, so a committed booking never 500s the webhook (which would trigger a retry).
   */
  sendConfirmation: (reservation: Reservation) => Promise<void>;
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
    // Confirm ONLY the fresh booking — never the idempotent `already` (a Stripe
    // redelivery), or the customer gets re-texted on every retry (DEC-119).
    if (result.outcome === "booked") {
      // Structurally best-effort: the booking is committed, so a confirmation
      // failure — from a channel OR from anything upstream in the injected dep —
      // must never bubble to a 500 (Stripe would retry the whole webhook). The
      // dep owns surfacing its own failure detail (DEC-119); here we only ensure
      // it can't break the booking, whatever dep is wired in.
      try {
        await deps.sendConfirmation(result.reservation);
      } catch {
        // swallowed by contract — see above
      }
    }
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
