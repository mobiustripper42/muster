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
}

/** The notice body. States plainly that they were NOT charged (fully refunded) so the
 *  customer isn't left thinking money is stuck. */
export function soldOutNoticeBody(customerName: string): string {
  const who = customerName?.trim() || "there";
  return (
    `Hi ${who}, we're sorry — your departure sold out while your payment was processing, ` +
    `so the booking couldn't be completed. You have NOT been charged: we've issued a full ` +
    `refund, which may take a few days to appear on your statement. Please try another time.\n\n` +
    `— Muster`
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
    } catch (e) {
      deps.onFailure?.(`sold-out email to ${contact.email} failed: ${errText(e)}`);
    }
  }

  if (contact.phone && deps.sms) {
    try {
      await deps.sms.send({ to: { phone: contact.phone }, kind: "receipt", body });
    } catch (e) {
      deps.onFailure?.(`sold-out SMS to ${contact.phone} failed: ${errText(e)}`);
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
