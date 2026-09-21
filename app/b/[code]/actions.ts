"use server";

/**
 * Manage-page actions (12.6, #459), both behind the booking code (re-resolved via the shared
 * `loadBookingByCode` — a form post is as untrusted as a page load, and a code revoked between
 * render and submit must fail here too):
 *  - `requestBookingChange` — option (b): email the operator inbox a cancel/change request,
 *    best-effort. Self-service cancel/refund is deferred (#472 + Flex wiring).
 */

import { randomUUID } from "node:crypto";
import { asId } from "@core/domain/ids.js";
import { recordTrail } from "@core/reservations/trail.js";
import { getRepo } from "../../lib/repo";
import { redirect } from "next/navigation";
import { EmailChannel } from "@core/adapters/email-channel.js";
import { bookingUrl } from "@core/reservations/booking-code.js";
import { bookingChangeRequestEmail, type ChangeRequestKind } from "@core/reservations/booking-change-request.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { readEmailEnv } from "../../lib/auth-delivery";
import { loadBookingByCode } from "./load";
import { appBaseUrl } from "../../lib/base-url";

/** Stay on the same booking across a redirect. The code is the path now, not a query pair. */
function manageHref(code: string, extra?: Record<string, string>): string {
  const q = extra ? `?${new URLSearchParams(extra).toString()}` : "";
  return `/b/${encodeURIComponent(code)}${q}`;
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
