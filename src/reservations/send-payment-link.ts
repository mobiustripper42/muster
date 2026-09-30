/**
 * Send the payment link to the customer (issue #1082 part B) — by text and by email, to the
 * contact the operator took on the phone.
 *
 * It goes out automatically when the operator books, and again whenever they press **Send payment
 * link**. Each channel is reported on its own (`ResendResult`), the same contract as the booking
 * link's resend (#686, #955): the operator is often still on the phone, and "texted (216) 555-0199"
 * versus "the text failed" decides whether they read the link out instead.
 *
 * Best-effort per channel, never throws: a failed send must not undo a booking that is written.
 */
import type { Reservation } from "../domain/entities.js";
import type { ChannelPort } from "../ports/channel.js";
import { formatClock, formatShortDay } from "./availability-screen.js";
import { PAYMENT_LINK_HOURS } from "./payment-link.js";
import { tryChannel, type ResendResult } from "./resend-booking-link.js";

export interface PaymentLinkSendDeps {
  /** The business's name as the customer knows it (`TENANT_NAME` at the edge). */
  tenantName: string;
  email?: ChannelPort | undefined;
  sms?: ChannelPort | undefined;
  /** Durable observer for a failed send; the operator already sees the outcome on screen. */
  onFailure?: ((detail: string) => void) | undefined;
}

/**
 * The message. **GSM-7 only** — it ships verbatim as SMS, and one character outside that alphabet
 * re-encodes the whole text as UCS-2 (see `resendBookingLinkBody`). Hence "at", not "·", and a
 * plain hyphen before the sign-off.
 */
export function paymentLinkBody(reservation: Reservation, url: string, tenantName: string): string {
  const who = reservation.customerName?.split(" ")[0] || "there";
  const when =
    reservation.date && reservation.time
      ? ` on ${formatShortDay(reservation.date)} at ${formatClock(reservation.time)}`
      : "";
  return (
    `Hi ${who}, here is the link to pay for your ${tenantName} trip${when}.\n\n` +
    `${url}\n\n` +
    `The link works for ${PAYMENT_LINK_HOURS} hours.\n\n` +
    `- ${tenantName}`
  );
}

export async function sendPaymentLink(
  deps: PaymentLinkSendDeps,
  reservation: Reservation,
  url: string,
): Promise<ResendResult> {
  const ctx = { body: paymentLinkBody(reservation, url, deps.tenantName), what: "payment link", onFailure: deps.onFailure, reservation };
  // Sequential, like the resend: two sends to one customer, deterministic failure order, and
  // neither side can stop the other being attempted.
  const email = await tryChannel(deps.email, reservation.email, "email", ctx);
  const sms = await tryChannel(deps.sms, reservation.phone, "SMS", ctx);
  return { email, sms };
}
