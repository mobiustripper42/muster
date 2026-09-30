"use server";

/**
 * The payment link's two actions (issue #1082 part B): pay, and "Can't make it? Cancel this
 * booking". Both are public — the link is the only credential — so each re-verifies it: a form post
 * is as untrusted as the page load, and a link that ran out between render and submit must fail
 * here too.
 */
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { asId, type ReservationId } from "@core/domain/ids.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { customerCancelledUnpaidEmail } from "@core/reservations/booking-change-request.js";
import { cancelUnpaidPhoneBooking } from "@core/reservations/cancel-reservation.js";
import { startPayByLink } from "@core/reservations/pay-by-link.js";
import { recordTrail } from "@core/reservations/trail.js";
import { readEmailEnv } from "../../../lib/auth-delivery";
import { appBaseUrl } from "../../../lib/base-url";
import { checkPaymentLink } from "../../../lib/payment-link";
import { getRepo } from "../../../lib/repo";
import { TENANT_NAME } from "../../../lib/tenant";
import { logSwallowed } from "../../../lib/swallowed";
import type { StartElementsCheckoutResult } from "../../book/checkout/actions";
import { neverRejects } from "../../book/checkout/never-rejects";

export interface StartPaymentLinkInput {
  token: string;
  /** The cancellation-terms box (DEC-188), gated here as at checkout. Stored nowhere. */
  agreedToTerms: boolean;
}

const EXPIRED = `This payment link has expired. Ask ${TENANT_NAME} for a new one.`;

const REFUSAL: Record<"missing" | "paid" | "cancelled" | "already_paid", string> = {
  missing: EXPIRED,
  paid: "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  already_paid:
    "This trip is already paid — check your texts and email for the confirmation. You have not been charged twice.",
  cancelled: "This booking was cancelled, so there’s nothing to pay.",
};

/**
 * Put a payable intent on the operator's row and hand back its client secret — the pay page's
 * `startElementsCheckout`. Gates first, in the checkout's order; an expired or tampered link is
 * refused before anything reaches Stripe, so it can never create an intent.
 */
export async function startPaymentLinkCheckout(input: StartPaymentLinkInput): Promise<StartElementsCheckoutResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return { ok: false, message: "Checkout isn't configured on this deployment. Nothing was charged." };
  }
  if (!input.agreedToTerms) {
    return { ok: false, message: "Please agree to the cancellation terms to continue." };
  }
  const link = checkPaymentLink(input.token);
  if (!link.ok) return { ok: false, message: EXPIRED };

  // Everything past here can throw (Stripe, the database), and must not (issue #773).
  return neverRejects(async () => {
    const res = await startPayByLink(
      { repo: getRepo(), payments: new StripePaymentPort(secretKey, webhookSecret), now: () => new Date().toISOString() },
      link.reservationId,
    );
    return res.ok ? { ok: true, clientSecret: res.clientSecret } : { ok: false, message: REFUSAL[res.reason] };
  });
}

/**
 * The customer can't make it (issue #1082 part B). Nothing has been charged, so this ends the
 * booking outright — `cancelUnpaidPhoneBooking`, whose write is guarded against the customer paying
 * mid-press — and tells the operator by email, the way a manage-page change request does. The
 * booking's history records the customer as cancelling.
 */
export async function cancelFromPaymentLink(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  // Encoded: the token is whatever was posted, and it goes into a redirect. A real one is all
  // unreserved characters and comes through unchanged.
  const here = `/p/${encodeURIComponent(token)}`;
  const link = checkPaymentLink(token);
  // The page renders the expired state; nothing is cancelled on a link that no longer works.
  if (!link.ok) redirect(here);

  let cancelled = false;
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const res = await cancelUnpaidPhoneBooking(
      {
        repo: getRepo(),
        now: () => new Date().toISOString(),
        // So a payment already started in another tab can't still go through (issue #1082 part C).
        ...(secretKey && webhookSecret ? { payments: new StripePaymentPort(secretKey, webhookSecret) } : {}),
      },
      link.reservationId,
      "customer",
    );
    cancelled = res.ok && !res.alreadyCancelled;
  } catch (e) {
    logSwallowed("pay:cancelFromPaymentLink", e, "the customer's cancel did not complete");
    redirect(`${here}?cancelErr=1`);
  }
  if (cancelled) {
    // Before the redirect, which throws. Only when THIS press cancelled it.
    await recordTrail(
      { repo: getRepo(), now: () => new Date().toISOString() },
      {
        id: asId<"TrailEventId">(`cancelled:${randomUUID()}`),
        reservationId: link.reservationId,
        actorKind: "customer",
        type: "cancelled",
        metadata: { reason: "unpaid phone booking, cancelled by the customer from the payment link" },
      },
    );
    await emailOperator(link.reservationId);
  }
  // Cancelled now or already, or paid in between: the page says which.
  redirect(here);
}

/** Best-effort, like the change request's: the cancel stands whether or not the inbox hears. */
async function emailOperator(reservationId: ReservationId): Promise<void> {
  try {
    const emailEnv = readEmailEnv();
    const to = process.env.OPERATOR_NOTIFY_EMAIL;
    if (!emailEnv || !to) {
      if (process.env.NODE_ENV === "production") {
        console.error("[reservations] customer cancel not emailed — set OPERATOR_NOTIFY_EMAIL + email env");
      }
      return;
    }
    const repo = getRepo();
    const r = await repo.getReservation(reservationId);
    if (!r) return;
    const offering = r.offeringId ? await repo.getOffering(r.offeringId) : null;
    const tripLabel = [r.date ? formatShortDay(r.date) : "", r.time ? formatClock(r.time) : "", offering?.name]
      .filter(Boolean)
      .join(" · ");
    const mail = customerCancelledUnpaidEmail({
      reservationId: String(r.id),
      customerName: r.customerName,
      tripLabel,
      phone: r.phone,
      email: r.email,
      paneUrl: `${appBaseUrl()}/admin/calendar/${encodeURIComponent(String(r.id))}`,
    });
    await new EmailChannel(emailEnv).send({
      to: { email: to },
      kind: "booking_request",
      body: `${mail.subject}\n\n${mail.text}`,
    });
  } catch (e) {
    logSwallowed("pay:cancelFromPaymentLink", e, "the operator was not emailed about the customer's cancel");
  }
}
