/**
 * Booking confirmation emit (11.4, DEC-122) — email + SMS to the customer, each
 * carrying the "manage my booking" capability URL, on a fresh booking.
 *
 * Two properties the webhook depends on:
 *  - **Best-effort, never throws.** A confirmation send failure must not 500 the
 *    Stripe webhook (a 500 → Stripe retries → the booking is re-processed). Each
 *    channel is tried independently and its failure is swallowed *and surfaced*
 *    via `onFailure` — NOT dropped silently, and NOT escalated to the urgent
 *    `alertPaidButUnbooked` money path (this is "resend when convenient", a
 *    different severity: the booking succeeded, only the notice failed).
 *  - **Send to whichever channels exist.** A booking may be email-only or
 *    phone-only; each side fires iff both the contact field and the channel are
 *    present. Missing both ⇒ nothing to do.
 *
 * The confirmation SMS is TRANSACTIONAL (the customer just paid), not marketing —
 * it does NOT route through the crew `SmsConsent` gate.
 *
 * Copy here is deliberately rough; polish + the manage page are P12.
 */

import type { Reservation } from "../domain/entities.js";
import type { ChannelPort } from "../ports/channel.js";
import { reservationManageUrl } from "./booking-link.js";

export interface ConfirmationDeps {
  /** Email channel, when configured (Resend). Absent ⇒ no email side. */
  email?: ChannelPort;
  /** SMS channel, when configured (Twilio). Absent ⇒ no SMS side. */
  sms?: ChannelPort;
  /** Trusted public origin for the link (APP_BASE_URL at the edge). */
  linkBase: string;
  /** The dedicated RESERVATION_LINK_SECRET (DEC-122). */
  linkSecret: string;
  /**
   * Low-severity observer for a failed send — a durable log / admin notice so the
   * operator can resend, distinct from the urgent refund alert. Optional; a
   * missing observer means the failure is only swallowed (test convenience).
   */
  onFailure?: (detail: string) => void;
}

/** The confirmation body — the manage URL inline, so BOTH email (which sends the
 *  body verbatim) and SMS (receipt kind, body verbatim) carry the link without a
 *  separate `link` field that only SMS would append. */
export function bookingConfirmationBody(
  reservation: Reservation,
  manageUrl: string,
): string {
  const who = reservation.customerName?.trim() || "there";
  return (
    `Hi ${who}, your Muster booking is confirmed for a party of ${reservation.partySize}.\n\n` +
    `Manage your booking: ${manageUrl}\n\n` +
    `— Muster`
  );
}

/**
 * Email + SMS the customer their confirmation. Best-effort per channel; never
 * throws. Call ONLY on a fresh `booked` outcome (never on an idempotent `already`
 * — Stripe redeliveries resolve to `already`, and re-sending would re-text the
 * customer on every retry; DEC-122).
 */
export async function sendBookingConfirmation(
  deps: ConfirmationDeps,
  reservation: Reservation,
): Promise<void> {
  const url = reservationManageUrl(deps.linkBase, reservation.id, deps.linkSecret);
  const body = bookingConfirmationBody(reservation, url);

  if (reservation.email && deps.email) {
    try {
      await deps.email.send({
        to: { email: reservation.email },
        kind: "receipt",
        body,
      });
    } catch (e) {
      deps.onFailure?.(
        `email confirmation to reservation ${reservation.id} failed: ${errText(e)}`,
      );
    }
  }

  if (reservation.phone && deps.sms) {
    try {
      await deps.sms.send({
        to: { phone: reservation.phone },
        kind: "receipt",
        body,
      });
    } catch (e) {
      deps.onFailure?.(
        `SMS confirmation to reservation ${reservation.id} failed: ${errText(e)}`,
      );
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
