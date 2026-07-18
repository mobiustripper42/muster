import { NextResponse } from "next/server";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { PaymentSignatureError } from "@core/ports/payment.js";
import { processBookingWebhook } from "@core/reservations/booking-webhook.js";
import { sendReservationConfirmation } from "../../../lib/booking-confirmation";
import { sendReservationSoldOutNotice } from "../../../lib/sold-out-notice";
import { getRepo } from "../../../lib/repo";

/**
 * Stripe `checkout.session.completed` webhook (DEC-107, 11.2) — the charge→booking spine.
 * Verifies the signature, writes the reservation under the atomic whole-boat claim
 * (12.1a `writeSlotBooking`, keyed on the session id), and records the `Payment`. On a
 * DEC-109 residual-race loss it AUTO-refunds (keyed-idempotent) + notifies the customer
 * (12.1b, DEC-107 amended); the loud manual-refund alert is the fallback only when the
 * auto-refund can't run.
 *
 * Rides `feature/reservations`; the public "Book Now" entry that produces these events is
 * gated behind the `RESERVATIONS` flag (DEC-111), so this route is inert until a checkout
 * is created. `nodejs` runtime — it writes through `pg`.
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
        now: () => new Date().toISOString(),
        alertPaidButUnbooked: async (message) => {
          // Loud in the function logs. TODO: fan out to all active admins over SMS (the
          // DEC-095 all-admins path, app/lib/alert.ts). Now the FALLBACK — only fires when
          // the residual-race auto-refund can't run (no payment_intent / refund threw).
          console.error(`[reservations] ${message}`);
        },
        // Best-effort email + SMS of the manage link on a fresh booking (11.4, DEC-122).
        sendConfirmation: sendReservationConfirmation,
        // Best-effort "sold out while you paid — fully refunded" on a residual-race loss (12.1b).
        notifyCustomerSoldOut: sendReservationSoldOutNotice,
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
