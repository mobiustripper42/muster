import { randomUUID } from "node:crypto";
import { EmailChannel } from "@core/adapters/email-channel.js";
import type { Reservation } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { paymentLinkUrl, signPaymentLink, verifyPaymentLink, type PaymentLinkCheck } from "@core/reservations/payment-link.js";
import { sendPaymentLink } from "@core/reservations/send-payment-link.js";
import { recordTrail } from "@core/reservations/trail.js";
import { signingSecret } from "./auth";
import { readEmailEnv } from "./auth-delivery";
import { appBaseUrl } from "./base-url";
import type { ResendOutcome } from "./booking-confirmation";
import { getRepo } from "./repo";
import { makeSmsChannel } from "./sms";
import { TENANT_NAME } from "./tenant";

/**
 * The payment link's edge (issue #1082 part B): sign it on the trusted origin, verify one that
 * came back, and send one to the customer with each channel reported.
 *
 * Signed with `SESSION_SECRET`, like the session cookie; nothing is stored (`payment-link.ts`).
 */

/** A fresh link for this booking, good for 72 hours from now. Signing writes nothing, so the
 *  operator's pane can mint one on every render that asks for it. */
export function mintPaymentLinkUrl(reservationId: string): string {
  return paymentLinkUrl(appBaseUrl(), signPaymentLink(reservationId, new Date(), signingSecret()));
}

export function checkPaymentLink(token: string): PaymentLinkCheck {
  return verifyPaymentLink(token, signingSecret(), new Date());
}

/**
 * Text and email a fresh link to the booking's contact, and record that it went (the trail's
 * `payment_link_sent`, the only record — the link itself is stored nowhere). The link is minted
 * per send, so each one sent works for the full 72 hours.
 *
 * `skipped` when this deployment has no live channel at all, the same rule as the booking link's
 * resend (DEC-170): a message written to a log is not a message sent, and the operator is told so.
 * Throws only if the deploy cannot build a link (`appBaseUrl`); the callers catch it.
 */
export async function deliverPaymentLink(
  reservation: Reservation,
  actor: { kind: "admin"; id: string },
): Promise<ResendOutcome> {
  const linkBase = appBaseUrl();
  const emailEnv = readEmailEnv();
  const email = emailEnv ? new EmailChannel(emailEnv) : undefined;
  const { channel: sms, live } = makeSmsChannel(linkBase);

  const result = await sendPaymentLink(
    {
      tenantName: TENANT_NAME,
      ...(email ? { email } : {}),
      sms,
      onFailure: (detail) => console.error(`[reservations] ${detail}`),
    },
    reservation,
    mintPaymentLinkUrl(String(reservation.id)),
  );
  // Only when something actually went out, like `link_resent`: a row reading "sent" over a send
  // that reached nobody is the one wrong thing this record could say.
  if (result.email !== "sent" && result.sms !== "sent") {
    return !email && !live ? { kind: "skipped", reason: "no_channels" } : { kind: "attempted", result };
  }
  await recordTrail(
    { repo: getRepo(), now: () => new Date().toISOString() },
    {
      id: asId<"TrailEventId">(`payment_link_sent:${randomUUID()}`),
      reservationId: reservation.id,
      actorKind: actor.kind,
      actorId: actor.id,
      type: "payment_link_sent",
      // Per channel, never the URL: it is a bearer link to a charge, and the trail is read on an
      // operator screen.
      metadata: { reason: `email=${result.email} sms=${result.sms}` },
    },
  );
  return { kind: "attempted", result };
}
