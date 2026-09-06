import { NextResponse } from "next/server";
import { bookingDeps } from "../../../lib/booking-deps";
import { PaymentSignatureError } from "@core/ports/payment.js";
import { processBookingWebhook } from "@core/reservations/booking-webhook.js";

/**
 * Stripe payment webhook (DEC-107, 11.2; event union 12.5, DEC-134) — the charge→booking
 * spine. Handles `checkout.session.completed` (hosted: balance + post-gratuity) AND
 * `payment_intent.succeeded` (inline Elements bookings — the Stripe dashboard endpoint must
 * subscribe to BOTH event types). Verifies the signature, writes the reservation under the
 * atomic whole-boat claim (14.5 `confirmPendingRow` flips the pending row, keyed on the intent id),
 * and records the `Payment`. On a
 * DEC-109 residual-race loss it AUTO-refunds (keyed-idempotent) + notifies the customer
 * (12.1b, DEC-107 amended); the loud manual-refund alert is the fallback only when the
 * auto-refund can't run.
 *
 * **Gated on `RESERVATIONS` (DEC-111) explicitly**, checked inside `processBookingWebhook`
 * immediately after signature verification (#588): a verified event arriving with the flag off
 * is alerted and acked, never booked. It used to be inert only *by consequence* — the sole live
 * intent-creating path is gated, so nothing upstream could fire — which held, but rested on a
 * Stripe dashboard nobody can read from the repo (#544) and on that other gate never moving.
 * `nodejs` runtime — it writes through `pg`.
 */
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const rawBody = await req.text(); // raw body required for signature verification

  try {
    const result = await processBookingWebhook(
      bookingDeps(secretKey, webhookSecret),
      rawBody,
      signature,
    );
    return NextResponse.json({ received: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "webhook error";
    if (e instanceof PaymentSignatureError) {
      // Bad/forged signature → 400 (a client error; Stripe won't retry a forged event).
      console.error(`Stripe webhook signature rejected: ${message}`);
      return NextResponse.json({ error: message }, { status: 400 });
    }
    // Infra failure (DB, etc.) after a VALID signature → 500 so Stripe RETRIES; a 4xx here
    // would drop a paid event and silently lose the booking.
    console.error(`Stripe webhook processing failed: ${message}`);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
