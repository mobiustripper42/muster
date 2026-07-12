import { NextResponse } from "next/server";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { processBookingWebhook } from "@core/reservations/booking-webhook.js";
import { getRepo } from "../../../lib/repo";

/**
 * Stripe `checkout.session.completed` webhook (DEC-107, 11.2) — the charge→booking spine.
 * Verifies the signature, writes the reservation under the atomic whole-boat claim
 * (11.3 `writeBooking`, keyed on the session id), and records the `Payment`. On a
 * paid-but-unbooked outcome it logs LOUDLY for a MANUAL refund — refunds are always
 * manual (Stripe dashboard); nothing here refunds automatically.
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
          // DEC-095 all-admins path, app/lib/alert.ts) — the refund itself stays manual.
          console.error(`[reservations] ${message}`);
        },
      },
      rawBody,
      signature,
    );
    return NextResponse.json({ received: true, ...result });
  } catch (e) {
    // Signature verification failed → 400 (Stripe backs off on a 4xx).
    const message = e instanceof Error ? e.message : "webhook error";
    console.error(`Stripe webhook rejected: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
