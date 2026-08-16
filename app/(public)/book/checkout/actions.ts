"use server";

import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { WAIVER_TERMS_VERSION } from "@core/config/tenant.js";
import { asId } from "@core/domain/ids.js";
import { createDeparturePaymentIntent } from "@core/reservations/create-departure-payment-intent.js";
import { canonicalizePhone } from "@core/customers/identity.js";
import { isHolderToken, mintHolderToken } from "@core/reservations/holder-token.js";
import { cookies } from "next/headers";
import { getRepo } from "../../../lib/repo";
import { isProdDeploy, reservationsEnabled } from "../../../lib/flags";

/**
 * Start an inline-Elements checkout (12.5, DEC-134): gates → hold (15 min in production; `CHECKOUT_HOLD_MINUTES` shortens it locally) →
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

/** The cookie carrying the checkout session's holder token (#575). */
const HOLDER_COOKIE = "muster_checkout";

/**
 * The caller's holder token, minting and setting one if absent — or `undefined` when the cookie
 * cannot be written (which degrades to pre-#575 behaviour rather than failing the checkout).
 *
 * `httpOnly` so no script can read it, `sameSite: "lax"` so it survives the return trip from
 * Stripe, and a lifetime a little over the hold's own — a token that outlives every hold it could
 * name is just a longer-lived identifier for no benefit.
 *
 * An existing cookie is validated by SHAPE before it is trusted as a match key. A crafted value
 * can't collide with a real token (32 CSPRNG bytes), but refusing malformed input at the door is
 * cheaper than reasoning about what a 4KB cookie does to a `.find()`.
 */
async function readOrMintHolderToken(): Promise<string | undefined> {
  try {
    const jar = await cookies();
    const existing = jar.get(HOLDER_COOKIE)?.value;
    if (isHolderToken(existing)) return existing;

    const minted = mintHolderToken();
    jar.set(HOLDER_COOKIE, minted, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProdDeploy(),
      path: "/",
      maxAge: 30 * 60,
    });
    return minted;
  } catch {
    // A server action CAN set cookies; a render cannot. If this ever moves, the checkout must
    // keep working — an absent token means "mint a fresh hold", which is exactly what happened
    // before this feature existed.
    return undefined;
  }
}

export async function startElementsCheckout(
  input: StartElementsCheckoutInput,
): Promise<StartElementsCheckoutResult> {
  if (!reservationsEnabled()) {
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

  // The checkout session's holder token (#575). Read from an httpOnly cookie, minted on first
  // submit — it is what lets a retry after a declined card reuse ITS OWN hold instead of taking
  // a second boat and eventually reporting a false sold_out.
  //
  // POSSESSION, not identity: keying this on the customer's email (the first attempt) meant
  // anyone who knew an address could be handed that person's hold, or delete it. A cookie can't
  // be guessed from public information.
  //
  // A client that refuses cookies simply gets the old behaviour — a fresh hold per submit — so
  // this degrades to the bug rather than to a broken checkout.
  const holderToken = await readOrMintHolderToken();

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
      ...(holderToken ? { holderToken } : {}),
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
