/**
 * Resend a booking's manage link to the customer (#686).
 *
 * The confirmation emit (`booking-confirmation.ts`) fires once, from the Stripe webhook, on a
 * fresh booking. It is the only thing in the product that has ever put a manage URL in front of
 * a customer — so a customer who loses the text has had no path back to their booking, and
 * nobody has been able to reach the page for testing without hand-running an HMAC.
 *
 * **Why this is not just a second call to `sendBookingConfirmation`.** That function returns
 * `void`, which is right where it is used: a webhook, nobody watching, and a failed send must
 * never 500 (Stripe would retry and re-process the booking). Here an operator has pressed a
 * button and is standing at the screen. The one unacceptable outcome is a green "sent" over a
 * send that did not happen — so this reports per channel, and the caller renders what it says.
 *
 * Shared with the confirmation: best-effort per channel, never throws, and each side fires only
 * if the reservation HAS that contact and the channel is configured. A booking may be
 * email-only or phone-only, and "the reservation has no email" is a different fact from "the
 * email failed" — the operator reads the difference to decide whether to pick up the phone.
 *
 * **A resend REUSES the live code, it does not mint one** (#741, DEC-154). The caller passes the
 * code from `ensureBookingCode`, which returns the existing one when there is one. That keeps the
 * two operator affordances meaningfully different: a *resend* puts the same credential back where
 * it already was — the customer's own inbox — while a *reissue* mints a new code and revokes this
 * one. Minting here would silently make every resend a reissue, breaking the customer's saved
 * link every time the operator was being helpful.
 */

import type { Reservation } from "../domain/entities.js";
import type { ChannelPort } from "../ports/channel.js";
import { bookingUrl } from "./booking-code.js";

/**
 * What happened on one channel. `absent` is deliberately distinct from both others: it means
 * there was nothing to try, which is neither a success to report nor a failure to chase.
 */
export type ChannelOutcome = "sent" | "failed" | "absent";

export interface ResendResult {
  email: ChannelOutcome;
  sms: ChannelOutcome;
}

export interface ResendDeps {
  email?: ChannelPort;
  sms?: ChannelPort;
  /** Trusted public origin for the link (APP_BASE_URL at the edge). */
  linkBase: string;
  /** Durable observer for a failed send; the operator already sees the outcome on screen. */
  onFailure?: (detail: string) => void;
}

/**
 * The resend body.
 *
 * **Every character must stay inside GSM-7** — this ships verbatim as SMS, and one character
 * outside that alphabet re-encodes the whole message as UCS-2 (67 chars per segment instead of
 * 153). An em dash did exactly that at #619, which is why the sign-off below is a plain hyphen.
 *
 * It does not say "confirmed" or "just booked": the customer may be reading this weeks after
 * the fact, having asked for their link back.
 */
export function resendBookingLinkBody(reservation: Reservation, manageUrl: string): string {
  const who = reservation.customerName?.split(" ")[0] ?? "there";
  return (
    `Hi ${who}, here is the link to your Muster booking.\n\n` +
    `${manageUrl}\n\n` +
    `Save it - it is how you manage your trip.\n\n` +
    `- Muster`
  );
}

export async function resendBookingLink(
  deps: ResendDeps,
  reservation: Reservation,
  bookingCode: string,
): Promise<ResendResult> {
  const url = bookingUrl(deps.linkBase, bookingCode);
  const body = resendBookingLinkBody(reservation, url);

  // Sequential rather than Promise.all: two sends to one customer, and the ordering keeps the
  // failure messages deterministic. Neither side can prevent the other from being attempted.
  const email = await tryChannel(deps.email, reservation.email, "email", { body, deps, reservation });
  const sms = await tryChannel(deps.sms, reservation.phone, "SMS", { body, deps, reservation });
  return { email, sms };
}

async function tryChannel(
  channel: ChannelPort | undefined,
  contact: string | undefined | null,
  label: string,
  ctx: { body: string; deps: ResendDeps; reservation: Reservation },
): Promise<ChannelOutcome> {
  if (!channel || !contact) return "absent";
  try {
    await channel.send({
      to: label === "email" ? { email: contact } : { phone: contact },
      kind: "receipt",
      body: ctx.body,
    });
    return "sent";
  } catch (e) {
    ctx.deps.onFailure?.(
      `${label} booking-link resend to reservation ${ctx.reservation.id} failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return "failed";
  }
}
