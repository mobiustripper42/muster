/**
 * Booking confirmation emit (11.4, DEC-122) — email + SMS to the customer, each
 * carrying the "manage my booking" capability URL, on a fresh booking.
 *
 * The URL is now `<base>/b/<code>` against a stored code the CALLER ensured (#741, DEC-154),
 * not a token this module derives. That is why `bookingCode` is a parameter rather than a
 * secret in `deps`: minting touches the repository, and this module stays a pure composer of
 * copy over injected channels.
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
import { bookingUrl } from "./booking-code.js";
import { CANCELLATION_TERMS_SHORT } from "./refund-terms.js";

export interface ConfirmationDeps {
  /** Email channel, when configured (Resend). Absent ⇒ no email side. */
  email?: ChannelPort;
  /** SMS channel, when configured (Twilio). Absent ⇒ no SMS side. */
  sms?: ChannelPort;
  /** Trusted public origin for the link (APP_BASE_URL at the edge). */
  linkBase: string;
  /**
   * Low-severity observer for a failed send — a durable log / admin notice so the
   * operator can resend, distinct from the urgent refund alert. Optional; a
   * missing observer means the failure is only swallowed (test convenience).
   */
  onFailure?: (detail: string) => void;
}

/** The confirmation body — the manage URL inline, so BOTH email (which sends the
 *  body verbatim) and SMS (receipt kind, body verbatim) carry the link without a
 *  separate `link` field that only SMS would append.
 *
 *  **Every character here must stay inside GSM-7.** The body ships verbatim as SMS, and a
 *  single character outside that alphabet re-encodes the WHOLE message as UCS-2 — 67 chars
 *  per concatenated segment instead of 153, better than doubling the segment count and the
 *  cost of every confirmation sent. The sign-off used an em dash and did exactly that until
 *  #619. Curly quotes, en/em dashes, and ellipsis characters are the usual offenders; a
 *  plain ASCII hyphen and straight quotes are safe. (A customer's own name can still force
 *  UCS-2 — that one is not ours to control.) */
export function bookingConfirmationBody(
  reservation: Reservation,
  manageUrl: string,
): string {
  const who = reservation.customerName?.trim() || "there";
  return (
    `Hi ${who}, your Muster booking is confirmed for a party of ${reservation.partySize}.\n\n` +
    `${CANCELLATION_TERMS_SHORT}\n\n` +
    `Manage your booking: ${manageUrl}\n\n` +
    `- Muster`
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
  bookingCode: string,
): Promise<void> {
  const url = bookingUrl(deps.linkBase, bookingCode);
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
