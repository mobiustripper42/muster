"use server";

import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { WAIVER_TERMS_VERSION } from "@core/config/tenant.js";
import { asId } from "@core/domain/ids.js";
import { createDeparturePaymentIntent } from "@core/reservations/create-departure-payment-intent.js";
import { canonicalizePhone } from "@core/customers/identity.js";
import { getRepo } from "../../../lib/repo";

/**
 * Start an inline-Elements checkout (12.5, DEC-134): gates → 15-min hold →
 * `paymentIntents.create` with the frozen slot + money metadata → return the clientSecret
 * the island confirms against. Replaces the 11.6 harness `startBooking` (hosted redirect).
 * **Writes no reservation** — the `payment_intent.succeeded` webhook books (DEC-107/109).
 *
 * Returns a result object (never redirects): the island surfaces the message inline, which
 * is the whole point of moving off hosted Checkout.
 */

export interface StartElementsCheckoutInput {
  offeringId: string;
  date: string;
  time: string;
  guests: number;
  gratuityBps: number;
  customerName: string;
  email: string;
  phone: string;
  waiverConsent: boolean;
  /** Collected in the form; NOT yet persisted — no Customer field exists for it. Wired
   *  through here so the storage lands in one place when it does. */
  marketingOptIn: boolean;
}

export type StartElementsCheckoutResult =
  | { ok: true; clientSecret: string }
  | { ok: false; message: string };

const REASON_MESSAGES: Record<string, string> = {
  offering_missing: "That cruise isn't bookable anymore. Head back and pick another.",
  not_live: "That cruise isn't bookable anymore. Head back and pick another.",
  invalid_guest_count: "That guest count doesn't fit this departure — go back and adjust it.",
  sold_out:
    "That departure was just taken while you were checking out. You have not been charged — pick another time.",
  waiver_required: "Please agree to the liability waiver to continue.",
  gratuity_required: "Please pick a crew tip to continue.",
};

export async function startElementsCheckout(
  input: StartElementsCheckoutInput,
): Promise<StartElementsCheckoutResult> {
  if (process.env.RESERVATIONS !== "true") {
    return { ok: false, message: "Reservations are currently off." };
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return { ok: false, message: "Checkout isn't configured on this deployment. Nothing was charged." };
  }

  const customerName = input.customerName.trim();
  if (!customerName) return { ok: false, message: "Please enter the booking guest's full name." };

  // Waiver consent is enforced HERE and again in the engine (DEC-110) — the checkbox can't
  // be spoofed past the charge. Version is server-authoritative; the timestamp is now.
  if (!input.waiverConsent) {
    return { ok: false, message: REASON_MESSAGES.waiver_required! };
  }

  // Phone is REQUIRED and must be canonicalizable (12.12b, DEC-132) — it's the customer
  // identity key, and this is the last point a human can fix a typo BEFORE money moves.
  // Server-side always (the input's `required` is courtesy; a raw POST bypasses it).
  const canonicalPhone = canonicalizePhone(input.phone);
  if (!canonicalPhone.ok) {
    return {
      ok: false,
      message:
        "That mobile number doesn't look right — use a 10-digit US number, or start with + and your country code.",
    };
  }

  const email = input.email.trim();
  const result = await createDeparturePaymentIntent(
    getRepo(),
    new StripePaymentPort(secretKey, webhookSecret),
    {
      offeringId: asId<"OfferingId">(input.offeringId),
      date: input.date,
      time: input.time,
      guestCount: input.guests,
      gratuityBps: input.gratuityBps,
      customerName,
      ...(email ? { email } : {}),
      // Store the CANONICAL form so the reservation's phone and the customer's identity key
      // are the same string — no second normalization downstream to drift from this one.
      phone: canonicalPhone.phone,
      waiverConsentAt: new Date().toISOString(),
      waiverVersion: WAIVER_TERMS_VERSION,
    },
    () => new Date().toISOString(),
  );

  if (!result.ok) {
    return {
      ok: false,
      message: REASON_MESSAGES[result.reason] ?? "Something went wrong — you have not been charged.",
    };
  }
  return { ok: true, clientSecret: result.clientSecret };
}
