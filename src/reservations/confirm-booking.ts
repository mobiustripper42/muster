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
import { processBookingCharge, type WebhookDeps, type WebhookResult } from "./booking-webhook.js";

/**
 * Book from an already-verified PaymentIntent.
 *
 * Shared by the webhook (which gets the intent from a signed event) and the success page (which
 * gets it from {@link confirmBookingByPaymentIntent}, having asked Stripe).
 *
 * **The `purpose` gate is DEC-134's double-write guard and it earns its keep on both paths.**
 * Every hosted Checkout session has an underlying PaymentIntent that also succeeds and carries no
 * metadata, because the adapter never sets `payment_intent_data.metadata`. On the webhook that is
 * an extra event to ignore; on the success page it is sharper, because `/book/success` is *also*
 * the hosted-checkout landing for the balance flow — so the metadata-less intent behind a balance
 * top-up arrives here with a real customer looking at it. Booking from it would sell a second
 * reservation for a payment against one that already exists.
 */
export async function confirmBookingFromIntent(
  deps: WebhookDeps,
  pi: PaymentSucceeded,
): Promise<WebhookResult> {
  const purpose = pi.metadata.purpose;
  if (purpose === undefined) return { handled: false };
  if (purpose !== "booking") {
    await deps.alertPaidButUnbooked(
      `Stripe payment intent with unknown purpose="${purpose}" - ${pi.paymentIntentId}. ` +
        `NOT auto-processed; investigate (money may have moved).`,
    );
    return { handled: true, outcome: "ignored" };
  }
  return processBookingCharge(deps, {
    key: pi.paymentIntentId,
    paymentIntentId: pi.paymentIntentId,
    amountCents: pi.amountReceivedCents,
    currency: pi.currency,
    metadata: pi.metadata,
  });
}

/**
 * Confirm from an id alone — the success-page entry point.
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
  return confirmBookingFromIntent(deps, pi);
}
