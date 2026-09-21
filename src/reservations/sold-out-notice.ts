/**
 * Sold-out notice emit (12.1b, DEC-109 residual race) — email + SMS to a customer whose
 * departure sold out WHILE they were paying (a hold expired mid-payment, another buyer took
 * the freed slot and paid first). Their payment was auto-refunded (DEC-107 amended); this
 * tells them so, apologetically. Mirrors `booking-confirmation.ts`:
 *  - **Best-effort, never throws** — the refund already succeeded; a notice failure must not
 *    500 the Stripe webhook (a 500 → retry → needless re-processing).
 *  - **Whichever channels exist** — email-only or phone-only both work; missing both = no-op.
 *  - Transactional (they just paid + were refunded), NOT marketing — no `SmsConsent` gate.
 */

import { randomUUID } from "node:crypto";
import { asId } from "../domain/ids.js";
import { recordTrail, type TrailDeps } from "./trail.js";
import type { ChannelPort } from "../ports/channel.js";

export interface SoldOutContact {
  customerName: string;
  email?: string;
  phone?: string;
}

export interface SoldOutNoticeDeps {
  email?: ChannelPort;
  sms?: ChannelPort;
  /** Low-severity observer for a failed send (log / admin notice), distinct from the urgent
   *  refund alert. Optional. */
  onFailure?: (detail: string) => void;
  /**
   * The trail (issue #1052). **Optional, because this module is called from a path that has
   * already lost its reservation** — the residual-race loser, whose row was never written —
   * and the pure-function tests construct deps without a repository. Absent means no row, not
   * a failure.
   */
  trail?: TrailDeps;
}

/**
 * The notice body.
 *
 * **It used to open with "You have NOT been charged", and that was false (15.5).** The payment
 * has already succeeded by the time this path runs — the money really is captured, and the
 * refund that follows takes days to settle. So for those days the customer's statement showed a
 * charge from us directly contradicting the one sentence they were most likely to act on. It now
 * says charged and refunded in the same breath, which is what actually happened.
 *
 * **No amount, deliberately.** §2.8.7 asked for one; the operator's call is that the figure adds
 * nothing to a message whose whole point is that the money is coming back in full, and the spec
 * was amended to match rather than left saying something we do not do.
 *
 * **Stays inside GSM-7**, like `bookingConfirmationBody` — this ships verbatim as SMS and one
 * character outside that alphabet re-encodes the WHOLE message as UCS-2, 67 chars per
 * concatenated segment instead of 153. Two em dashes did exactly that until #685. The shared
 * guard in `sms-alphabet.ts` is asserted over this body by its own test.
 */
export function soldOutNoticeBody(customerName: string): string {
  const who = customerName?.trim() || "there";
  return (
    `Hi ${who}, your departure sold out while your payment was going through, so the booking ` +
    `could not be completed. Your card was charged and refunded in full right away. Refunds ` +
    `take a few days to show on a statement. Sorry for any confusion.\n\n` +
    `- Muster`
  );
}

/**
 * Email + SMS the sold-out + refunded notice. Best-effort per channel; never throws. Call
 * ONLY on a residual-race `lost` outcome AFTER the auto-refund succeeded.
 */
export async function sendSoldOutNotice(
  deps: SoldOutNoticeDeps,
  contact: SoldOutContact,
): Promise<void> {
  const body = soldOutNoticeBody(contact.customerName);

  if (contact.email && deps.email) {
    try {
      await deps.email.send({ to: { email: contact.email }, kind: "receipt", body });
      await note(deps, "sold_out_notice_sent", "email");
    } catch (e) {
      deps.onFailure?.(`sold-out email to ${contact.email} failed: ${errText(e)}`);
      await note(deps, "sold_out_notice_failed", `email: ${errText(e)}`);
    }
  }

  if (contact.phone && deps.sms) {
    try {
      await deps.sms.send({ to: { phone: contact.phone }, kind: "receipt", body });
      await note(deps, "sold_out_notice_sent", "sms");
    } catch (e) {
      deps.onFailure?.(`sold-out SMS to ${contact.phone} failed: ${errText(e)}`);
      await note(deps, "sold_out_notice_failed", `sms: ${errText(e)}`);
    }
  }
}

/**
 * One row per channel attempt (issue #1052).
 *
 * **This whole module is best-effort and never throws**, which is what makes a customer who
 * was charged, auto-refunded, and never told silent by construction. `onFailure` is an
 * observer the caller may not even pass. These rows are the durable half.
 *
 * Per channel rather than per notice, because an email-only contact, a Twilio outage and a
 * two-channel success are three different answers to "was the customer told" and a single row
 * would flatten them.
 *
 * No `reservationId`: this runs for the residual-race loser, whose reservation was never
 * written. A row with neither key is legal and this is the case it was made legal for.
 */
async function note(
  deps: SoldOutNoticeDeps,
  type: "sold_out_notice_sent" | "sold_out_notice_failed",
  detail: string,
): Promise<void> {
  if (!deps.trail) return;
  await recordTrail(deps.trail, {
    id: asId<"TrailEventId">(`${type}:${randomUUID()}`),
    actorKind: "engine",
    type,
    metadata: { reason: detail },
  });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
