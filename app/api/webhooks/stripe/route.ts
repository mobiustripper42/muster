import { NextResponse } from "next/server";
import { alertMoneyProblem } from "../../../lib/alert";
import { forwardFormNotices } from "../../../lib/channel";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { PaymentSignatureError } from "@core/ports/payment.js";
import { processBookingWebhook } from "@core/reservations/booking-webhook.js";
import { sendReservationConfirmation } from "../../../lib/booking-confirmation";
import { sendReservationSoldOutNotice } from "../../../lib/sold-out-notice";
import { getRepo } from "../../../lib/repo";
import { reservationsEnabled } from "../../../lib/flags";

/**
 * Stripe payment webhook (DEC-107, 11.2; event union 12.5, DEC-134) — the charge→booking
 * spine. Handles `checkout.session.completed` (hosted: balance + post-gratuity) AND
 * `payment_intent.succeeded` (inline Elements bookings — the Stripe dashboard endpoint must
 * subscribe to BOTH event types). Verifies the signature, writes the reservation under the
 * atomic whole-boat claim (12.1a `writeSlotBooking`, keyed on the session/intent id), and
 * records the `Payment`. On a
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
      {
        repo: getRepo(),
        payments: new StripePaymentPort(secretKey, webhookSecret),
        reservationsEnabled: reservationsEnabled(),
        now: () => new Date().toISOString(),
        // Texts every active admin AND logs (issue #723). This was a `console.error` carrying a
        // TODO to fan out over SMS — which meant every money alert this webhook can raise
        // (paid-but-unbooked, a refund reconciling against nothing, and now a chargeback)
        // reached exactly nobody who wasn't reading Vercel logs. Never throws: a failed alert
        // must not 500 the webhook into a Stripe redelivery loop.
        alertPaidButUnbooked: alertMoneyProblem,
        // Best-effort email + SMS of the manage link on a fresh booking (11.4, DEC-122).
        sendConfirmation: sendReservationConfirmation,
        // Best-effort "sold out while you paid — fully refunded" on a residual-race loss (12.1b).
        notifyCustomerSoldOut: sendReservationSoldOutNotice,
        // A booking re-forms shifts (#614), and that re-form can be the first to observe a shift
        // collapsing or resurrecting anywhere on the calendar. `cancelledCrew`/`restoredCrew`
        // fire regardless of `notifyTripChanges`, and after DEC-126 turns off the Xola pull this
        // webhook is one of only two `formShifts` triggers left in production — so without this
        // wire, a crew member dropped from a shift is simply never told (DEC-084, #244).
        relayFormNotices: forwardFormNotices,
      },
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
