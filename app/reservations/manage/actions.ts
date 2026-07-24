"use server";

/**
 * Manage-page actions (12.6, #459), both behind the capability token (re-verified via the
 * shared `loadVerifiedBooking` — a form post is as untrusted as a page load):
 *  - `addPostTip` — the DEC-124 POST gratuity: recompute the tier amount SERVER-SIDE (never
 *    trust a posted cents value), open a hosted gratuity Checkout (`createGratuityCheckout`).
 *  - `requestBookingChange` — option (b): email the operator inbox a cancel/change request,
 *    best-effort. Self-service cancel/refund is deferred (#472 + Flex wiring).
 */

import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { reservationManageUrl } from "@core/reservations/booking-link.js";
import { bookingChangeRequestEmail, type ChangeRequestKind } from "@core/reservations/booking-change-request.js";
import { createGratuityCheckout } from "@core/reservations/create-gratuity-checkout.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { gratuityCentsFor } from "@core/reservations/pricing.js";
import { postTipTiersFor } from "@core/reservations/manage-view.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { getRepo } from "../../lib/repo";
import { loadVerifiedBooking } from "./load";

/** Preserve the capability params so a redirect stays on the same verified booking. */
function manageHref(r: string, t: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ r, t, ...(extra ?? {}) });
  return `/reservations/manage?${q.toString()}`;
}

export async function addPostTip(formData: FormData): Promise<void> {
  const r = String(formData.get("r") ?? "");
  const t = String(formData.get("t") ?? "");
  const bps = Number(formData.get("bps") ?? 0);

  const booking = await loadVerifiedBooking(r, t);
  if (!booking) redirect(manageHref(r, t, { error: "link" }));

  // Recompute the fare + tier amount server-side; a posted amount is never trusted.
  const fareCents = (booking.event.price ?? 0) + (booking.reservation.extrasCents ?? 0);
  const tiers = postTipTiersFor(booking.offering, fareCents);
  const tier = tiers.find((x) => x.bps === bps);
  if (!tier || tier.amountCents <= 0) redirect(manageHref(r, t, { error: "tip" }));

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(manageHref(r, t, { error: "pay" }));

  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  // `.catch(null)` — a transient Stripe outage degrades to the friendly `error=tip` Notice, not
  // Next's raw error boundary (the guard the admin gratuity action has). Redirects stay OUTSIDE
  // any try/catch (they throw NEXT_REDIRECT, which a catch would swallow).
  const result = await createGratuityCheckout(
    getRepo(),
    new StripePaymentPort(secretKey, webhookSecret),
    booking.reservation.id,
    tier.amountCents,
    { successUrl: `${base}${manageHref(r, t, { tipped: "1" })}`, cancelUrl: `${base}${manageHref(r, t)}` },
  ).catch(() => null);
  if (!result || !result.ok) redirect(manageHref(r, t, { error: "tip" }));
  redirect(result.url); // → Stripe hosted Checkout for the tip
}

export async function requestBookingChange(formData: FormData): Promise<void> {
  const r = String(formData.get("r") ?? "");
  const t = String(formData.get("t") ?? "");
  const kind: ChangeRequestKind = formData.get("kind") === "cancel" ? "cancel" : "change";
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  const booking = await loadVerifiedBooking(r, t);
  if (!booking) redirect(manageHref(r, t, { error: "link" }));

  // Best-effort operator email (option b). NOTHING here throws back to the customer — the
  // request is acknowledged regardless; a dark inbox just means the operator relies on the
  // follow-up. Delivery needs OPERATOR_NOTIFY_EMAIL + a configured email channel.
  try {
    const emailEnv = readEmailEnv();
    const to = process.env.OPERATOR_NOTIFY_EMAIL;
    const secret = process.env.RESERVATION_LINK_SECRET;
    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
    if (emailEnv && to && secret) {
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
        manageUrl: reservationManageUrl(base, booking.reservation.id, secret),
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

  redirect(manageHref(r, t, { requested: kind }));
}
