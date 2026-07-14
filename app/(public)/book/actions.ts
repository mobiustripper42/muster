"use server";

import { redirect } from "next/navigation";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { WAIVER_TERMS_VERSION } from "@core/config/tenant.js";
import { asId } from "@core/domain/ids.js";
import { createBookingCheckout } from "@core/reservations/create-booking-checkout.js";
import { getRepo } from "../../lib/repo";

/**
 * Start a booking from the throwaway harness (11.6): build a checkout via
 * `createBookingCheckout` (11.2) and redirect the customer to Stripe. Writes nothing —
 * the reservation + payment are written by the webhook on payment (DEC-107/109). Gated
 * behind `RESERVATIONS` (DEC-111).
 */
export async function startBooking(formData: FormData): Promise<void> {
  if (process.env.RESERVATIONS !== "true") redirect("/book?err=disabled");

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect("/book?err=stripe_not_configured");

  const eventId = asId<"EventId">(String(formData.get("eventId") ?? ""));
  const customerName = String(formData.get("customerName") ?? "").trim();
  const partySize = Number(formData.get("partySize") ?? 0);
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  // Waiver consent (11.5, DEC-110): the box must be checked. Enforced here AND at
  // the engine (createBookingCheckout rejects without it) — the box can't be spoofed
  // past the charge. The version is server-authoritative (config), never from the form;
  // the timestamp is the agreement instant (now — this submit).
  const waiverConsent = formData.get("waiverConsent") === "yes";
  if (!waiverConsent) redirect("/book?err=waiver_required");
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  const result = await createBookingCheckout(
    getRepo(),
    new StripePaymentPort(secretKey, webhookSecret),
    {
      eventId,
      customerName,
      partySize,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      waiverConsentAt: new Date().toISOString(),
      waiverVersion: WAIVER_TERMS_VERSION,
    },
    { successUrl: `${base}/book/success`, cancelUrl: `${base}/book/cancel` },
  );

  if (!result.ok) redirect(`/book?err=${result.reason}`);
  redirect(result.url); // → Stripe hosted Checkout
}
