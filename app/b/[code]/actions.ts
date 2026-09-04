"use server";

/**
 * Manage-page actions (12.6, #459), both behind the booking code (re-resolved via the shared
 * `loadBookingByCode` — a form post is as untrusted as a page load, and a code revoked between
 * render and submit must fail here too):
 *  - `addPostTip` — the DEC-124 POST gratuity: recompute the tier amount SERVER-SIDE (never
 *    trust a posted cents value), open a hosted gratuity Checkout (`createGratuityCheckout`).
 *  - `requestBookingChange` — option (b): email the operator inbox a cancel/change request,
 *    best-effort. Self-service cancel/refund is deferred (#472 + Flex wiring).
 */

import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { bookingUrl } from "@core/reservations/booking-code.js";
import { bookingChangeRequestEmail, type ChangeRequestKind } from "@core/reservations/booking-change-request.js";
import { createGratuityCheckout } from "@core/reservations/create-gratuity-checkout.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { gratuityCentsFor } from "@core/reservations/pricing.js";
import { postTipTiersFor } from "@core/reservations/manage-view.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { getRepo } from "../../lib/repo";
import { loadBookingByCode } from "./load";
import { stripTrailingSlashes } from "@core/config/base-url.js";

/** Stay on the same booking across a redirect. The code is the path now, not a query pair. */
function manageHref(code: string, extra?: Record<string, string>): string {
  const q = extra ? `?${new URLSearchParams(extra).toString()}` : "";
  return `/b/${encodeURIComponent(code)}${q}`;
}

export async function addPostTip(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "");
  const bps = Number(formData.get("bps") ?? 0);

  const load = await loadBookingByCode(code);
  if (load.kind !== "ok") redirect(manageHref(code, { error: "link" }));
  const booking = load.booking;

  // Recompute the fare + tier amount server-side; a posted amount is never trusted.
  const fareCents = (booking.event.price ?? 0) + (booking.reservation.extrasCents ?? 0);
  const tiers = postTipTiersFor(booking.offering, fareCents);
  const tier = tiers.find((x) => x.bps === bps);
  if (!tier || tier.amountCents <= 0) redirect(manageHref(code, { error: "tip" }));

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(manageHref(code, { error: "pay" }));

  const base = stripTrailingSlashes(process.env.APP_BASE_URL || "http://localhost:3000");
  // `.catch(null)` — a transient Stripe outage degrades to the friendly `error=tip` Notice, not
  // Next's raw error boundary (the guard the admin gratuity action has). Redirects stay OUTSIDE
  // any try/catch (they throw NEXT_REDIRECT, which a catch would swallow).
  const result = await createGratuityCheckout(
    getRepo(),
    new StripePaymentPort(secretKey, webhookSecret),
    booking.reservation.id,
    tier.amountCents,
    { successUrl: `${base}${manageHref(code, { tipped: "1" })}`, cancelUrl: `${base}${manageHref(code)}` },
  ).catch(() => null);
  if (!result || !result.ok) redirect(manageHref(code, { error: "tip" }));
  redirect(result.url); // → Stripe hosted Checkout for the tip
}

export async function requestBookingChange(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "");
  const kind: ChangeRequestKind = formData.get("kind") === "cancel" ? "cancel" : "change";
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  const load = await loadBookingByCode(code);
  if (load.kind !== "ok") redirect(manageHref(code, { error: "link" }));
  const booking = load.booking;

  // Best-effort operator email (option b). NOTHING here throws back to the customer — the
  // request is acknowledged regardless; a dark inbox just means the operator relies on the
  // follow-up. Delivery needs OPERATOR_NOTIFY_EMAIL + a configured email channel.
  try {
    const emailEnv = readEmailEnv();
    const to = process.env.OPERATOR_NOTIFY_EMAIL;
    const base = stripTrailingSlashes(process.env.APP_BASE_URL || "http://localhost:3000");
    if (emailEnv && to) {
      const tripLabel = [
        formatShortDay(booking.event.date),
        formatClock(booking.event.time),
        booking.offering?.name,
      ]
        .filter(Boolean)
        .join(" · ");
      const mail = bookingChangeRequestEmail({
        kind,
        reservationId: String(booking.reservation.id),
        customerName: booking.reservation.customerName,
        tripLabel,
        ...(booking.reservation.phone ? { phone: booking.reservation.phone } : {}),
        ...(booking.reservation.email ? { email: booking.reservation.email } : {}),
        ...(note ? { note } : {}),
        // The operator's copy of the customer's own link — the SAME code, so opening it shows
        // exactly what the customer is looking at.
        manageUrl: bookingUrl(base, code),
      });
      await new EmailChannel(emailEnv).send({
        to: { email: to },
        kind: "booking_request",
        body: `${mail.subject}\n\n${mail.text}`,
      });
    } else if (process.env.NODE_ENV === "production") {
      console.error("[reservations] change request not emailed — set OPERATOR_NOTIFY_EMAIL + email env");
    }
  } catch (e) {
    console.error(`[reservations] change-request email failed — ${e instanceof Error ? e.message : e}`);
  }

  redirect(manageHref(code, { requested: kind }));
}
