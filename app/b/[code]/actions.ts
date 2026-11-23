"use server";

/**
 * Manage-page actions (12.6, #459; 16.9, #1074), both behind the booking code (re-resolved via the
 * shared `loadBookingByCode` — a form post is as untrusted as a page load, and a code revoked
 * between render and submit must fail here too):
 *  - `requestBookingChange` — email the operator inbox a cancel/change request, best-effort. A date
 *    or time change is only ever a request; a cancel is a request too when the terms owe no refund.
 *  - `cancelFromManagePage` — the customer cancels a booking the terms refund, and gets the refund.
 *  - `payBalanceFromManagePage` — the customer starts paying the balance with any card (issue #1254).
 */

import { randomUUID } from "node:crypto";
import { asId } from "@core/domain/ids.js";
import { recordTrail } from "@core/reservations/trail.js";
import { getRepo } from "../../lib/repo";
import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { startBalancePayment } from "@core/reservations/balance-charge.js";
import { alertThatNeverThrows } from "@core/reservations/booking-webhook.js";
import { balanceRefusalMessage } from "@core/reservations/manage-view.js";
import { bookingUrl } from "@core/reservations/booking-code.js";
import {
  bookingChangeRequestEmail,
  customerCancelledEmail,
  type ChangeRequestKind,
} from "@core/reservations/booking-change-request.js";
import {
  cancelByCustomer,
  manageHref,
  manageRedirectFor,
  type CancelRefund,
  type CustomerCancelOutcome,
} from "@core/reservations/customer-cancel.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { alertMoneyProblem } from "../../lib/alert";
import { tellCustomerOfCancel } from "../../lib/cancel-notice";
import { forwardFormNotices } from "../../lib/channel";
import { logSwallowed } from "../../lib/swallowed";
import { loadBookingByCode, type LoadedBooking } from "./load";
import { appBaseUrl } from "../../lib/base-url";

/** "Wed, Oct 21 · 3:30 PM · Reservation Demo Cruise" — the trip an operator email is about. */
function tripLabelOf(booking: LoadedBooking): string {
  return [formatShortDay(booking.event.date), formatClock(booking.event.time), booking.offering?.name]
    .filter(Boolean)
    .join(" · ");
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
    const base = appBaseUrl();
    if (emailEnv && to) {
      const mail = bookingChangeRequestEmail({
        kind,
        reservationId: String(booking.reservation.id),
        customerName: booking.reservation.customerName,
        tripLabel: tripLabelOf(booking),
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

  // The customer asked for a cancel or a change, and the operator handles it by hand from an
  // inbox (issue #1052). The email is best-effort — the catch above swallows a send failure and
  // the customer still sees "requested" — so this row is the only thing that survives a lost
  // email, on the one path where the customer believes they have been heard.
  await recordTrail(
    { repo: getRepo(), now: () => new Date().toISOString() },
    {
      id: asId<"TrailEventId">(`change_requested:${randomUUID()}`),
      reservationId: booking.reservation.id,
      actorKind: "customer",
      type: "change_requested",
      metadata: { reason: kind },
    },
  );
  redirect(manageHref(code, { requested: kind }));
}

/** A posted cents field as a number — anything but plain digits is NaN, which the core refuses. */
function postedCents(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "");
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * The customer cancels their own booking from the manage page (16.9, issue #1074) and gets back what
 * the published terms owe. The confirm posts the figure it showed (`quotedCents`) and the
 * refunded-so-far token (`expectedRefunded`); `cancelByCustomer` recomputes both and refuses by name
 * if either moved, so a page left open across the window line cancels nothing.
 *
 * Outcomes go back as codes in the URL, never a figure (`manageRedirectFor`); the page reads the
 * figure for its notice from the cancelled trail row.
 */
export async function cancelFromManagePage(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "");
  const load = await loadBookingByCode(code);
  if (load.kind !== "ok") redirect(manageHref(code, { error: "link" }));
  const booking = load.booking;

  // Refused BEFORE anything is cancelled, as the operator's refund button is: a cancel the deploy
  // cannot refund would be the one outcome the customer was promised against.
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(manageHref(code, { error: "cancel_failed" }));

  let outcome: CustomerCancelOutcome;
  try {
    outcome = await cancelByCustomer(
      {
        repo: getRepo(),
        now: () => new Date().toISOString(),
        payments: new StripePaymentPort(secretKey, webhookSecret),
        // A cancel collapses the shift, and the crew on it have to be told (DEC-084/#244).
        relayFormNotices: forwardFormNotices,
        // Tell the customer it is cancelled and what is coming back (issue #1212).
        tellCustomer: tellCustomerOfCancel,
      },
      booking.reservation.id,
      { quotedCents: postedCents(formData, "quotedCents"), expectedRefundedCents: postedCents(formData, "expectedRefunded") },
    );
  } catch (e) {
    // `cancelByCustomer` rethrows only when a re-read finds the booking still booked, so nothing changed
    // (the cancel and the boat's release are one write), and the refund leg never throws out.
    logSwallowed("b/cancelFromManagePage", e, "the customer's cancel did not complete");
    redirect(manageHref(code, { error: "cancel_failed" }));
  }

  // Before the redirect, which throws. Only when THIS press cancelled it.
  if (outcome.ok) await emailOperatorOfCancel(booking, outcome.refund);
  redirect(manageRedirectFor(code, outcome));
}

/** Best-effort, like the change request's: the cancel stands whether or not the inbox hears. */
async function emailOperatorOfCancel(booking: LoadedBooking, refund: CancelRefund): Promise<void> {
  try {
    const emailEnv = readEmailEnv();
    const to = process.env.OPERATOR_NOTIFY_EMAIL;
    if (!emailEnv || !to) {
      if (process.env.NODE_ENV === "production") {
        console.error("[reservations] customer cancel not emailed — set OPERATOR_NOTIFY_EMAIL + email env");
      }
      return;
    }
    const r = booking.reservation;
    const mail = customerCancelledEmail({
      reservationId: String(r.id),
      customerName: r.customerName,
      tripLabel: tripLabelOf(booking),
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.email ? { email: r.email } : {}),
      paneUrl: `${appBaseUrl()}/admin/calendar/${encodeURIComponent(String(r.id))}`,
      refund,
    });
    await new EmailChannel(emailEnv).send({
      to: { email: to },
      kind: "booking_request",
      body: `${mail.subject}\n\n${mail.text}`,
    });
  } catch (e) {
    logSwallowed("b/cancelFromManagePage", e, "the operator was not emailed about the customer's cancel");
  }
}

/**
 * The manage page's `Pay balance` press (issue #1254): starts the balance payment on the booking's one
 * balance intent and hands the card form its client secret and the amount set on it, or the refusal
 * line. No logic past `startBalancePayment`, which carries the tests; the booking is re-resolved from
 * the code like every action here (a revoked link fails here too).
 *
 * A `"use server"` export is a public endpoint: everything this does is gated by the code and by
 * `balancePayable`. Never throws, per the forward guidance for new actions — a failure is a line the
 * form shows.
 */
export async function payBalanceFromManagePage(
  code: string,
): Promise<{ clientSecret: string; amountCents: number } | { error: string }> {
  const load = await loadBookingByCode(code);
  if (load.kind !== "ok") return { error: "That didn’t work — please reopen your booking link." };
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { error: "Payments aren’t available right now — please try again later." };
  try {
    const repo = getRepo();
    const r = await startBalancePayment(
      {
        repo,
        payments: new StripePaymentPort(secretKey, process.env.STRIPE_WEBHOOK_SECRET ?? ""),
        now: () => new Date().toISOString(),
        alertPaidButUnbooked: alertThatNeverThrows(alertMoneyProblem),
      },
      load.booking.reservation.id,
    );
    if (r.ok) return { clientSecret: r.clientSecret, amountCents: r.amountCents };
    return { error: balanceRefusalMessage(r.reason, await repo.getContactPhone()) };
  } catch (e) {
    logSwallowed("b/payBalanceFromManagePage", e, "the customer's balance payment did not start");
    return { error: "Couldn’t start your payment just now. You have not been charged — try again in a moment." };
  }
}
