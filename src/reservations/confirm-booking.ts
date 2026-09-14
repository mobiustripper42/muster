/**
 * Confirm a booking from a PaymentIntent id, with no webhook involved (issue #827).
 *
 * `SPEC.md` §2.8 acceptance criterion 13: *"Killing the webhook entirely still produces a booking
 * for a customer who reaches the success page."* Before this, `payment_intent.succeeded` was the
 * only path that ever booked — so a delayed endpoint, a misconfigured one, or a deploy mid-swap
 * meant the customer had paid and nothing had happened, with no bound on when anyone would
 * notice.
 *
 * Stripe's own fulfillment guidance is to trigger from both places: webhooks can be delayed, so
 * fulfil from the landing page as well, where the customer is standing right in front of you.
 *
 * **One function, both callers.** §2.8.6 requires the success page, the webhook and (later) the
 * reconciler to run the SAME idempotent confirm. Stripe re-delivers events that were processed
 * elsewhere, so a second path that books its own way books the same sale twice. This module is
 * that function; `processBookingWebhook` calls it too.
 */
import type { PaymentSucceeded } from "../ports/payment.js";
import {
  processBookingCharge,
  type ConfirmOptions,
  type WebhookDeps,
  type WebhookResult,
} from "./booking-webhook.js";

/**
 * Book from an already-verified PaymentIntent.
 *
 * Shared by the webhook (which gets the intent from a signed event) and the success page (which
 * gets it from {@link confirmBookingByPaymentIntent}, having asked Stripe).
 *
 * **The `purpose` gate is gone (15.6), and the row replaced it.** The booking charge sends no
 * metadata now, so a gate reading `metadata.purpose` would reject every real booking. What tells
 * our payments apart instead is the pending row: the checkout writes it BEFORE calling Stripe,
 * so an intent that is ours resolves to a row, and one that is not resolves to nothing.
 *
 * The bare PaymentIntent under a hosted balance session therefore lands on `unconfirmable` /
 * `no_row` rather than being filtered out up here, and still books nothing.
 */
export async function confirmBookingFromIntent(
  deps: WebhookDeps,
  pi: PaymentSucceeded,
  opts: ConfirmOptions = {},
): Promise<WebhookResult> {
  return processBookingCharge(deps, {
    key: pi.paymentIntentId,
    paymentIntentId: pi.paymentIntentId,
    amountCents: pi.amountReceivedCents,
    currency: pi.currency,
    metadata: pi.metadata,
  }, opts);
}

/**
 * Confirm from an id alone — the success-page entry point.
 *
 * **This path does NOT run the residual-race compensation** (the auto-refund and the "sold out
 * while you were paying" notice). Those belong to the signed webhook, because this entry point is
 * public, unauthenticated and repeatable: `/book/success?payment_intent=<id>` is a GET anyone can
 * issue in a loop, and a residual-race loss is a *stable* outcome — the reservation row was never
 * written, so every replay re-derives it. Running the compensation here would re-send that SMS
 * and email to a real customer on every request, and would re-attempt a refund whose Stripe
 * idempotency key expires after a day, at which point the failure alert texts every admin instead.
 *
 * The loser is still refunded and still told, once, by the webhook. Nothing is lost by deferring
 * it — this page is the fast path, not the guarantee.
 *
 * **The redirect is not proof of payment.** Stripe appends `payment_intent` and `redirect_status`
 * to the `return_url`, and both are text in an address bar. So the id is resolved against the
 * provider before anything is written: an unknown id, an unpaid intent, or a retrieve that fails
 * all return `null` and book nothing.
 *
 * A `null` here is deliberately quiet rather than an alert. The ordinary cause is somebody
 * reloading the page with a stale URL, and the money path already has a loud channel for a
 * payment that genuinely cannot be placed — the webhook's paid-but-unbooked alert, which is still
 * coming for any real charge this refuses.
 */
export async function confirmBookingByPaymentIntent(
  deps: WebhookDeps,
  paymentIntentId: string,
): Promise<WebhookResult> {
  const pi = await deps.payments.getSucceededPaymentIntent(paymentIntentId);
  if (!pi) return { handled: true, outcome: "ignored" };
  // `notifyOnResidualRaceLoss: false` — see the doc comment above. The refund and the sold-out
  // notice belong to the signed webhook only.
  return confirmBookingFromIntent(deps, pi, { notifyOnResidualRaceLoss: false });
}
