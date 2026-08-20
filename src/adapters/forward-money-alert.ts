/**
 * Money alerts to the office (issue #723) — the delivery half of the posture #613 set for
 * paid-but-unbooked: **money problems are LOUD before they are fatal.**
 *
 * Sibling of `forward-board-alerts.ts`, and deliberately a separate function rather than a
 * generalization of it. The board alert composes a body FROM domain state (shifts, vessels,
 * reasons) and links to a standing surface that shows the same thing. A money alert carries a
 * body the caller already wrote, because the thing that went wrong — a chargeback on a payment
 * intent Muster has never seen, a refund that reconciles against nothing — often has no domain
 * state to compose from. Merging the two would mean one function with two unrelated jobs.
 *
 * NOT a new outbound lane (the DEC-095 reasoning applies unchanged): no port, no entity, no
 * table. The durable record is the `payments` row the caller just wrote; the recipients ARE the
 * operator; the payload rides `ChannelPort` as `admin_alert`.
 *
 * **Write the bodies in plain ASCII** (issue #777). One emoji or one em dash forces the whole
 * message to UCS-2: 70 characters per segment instead of 160, so a decorative glyph doubles the
 * bill and moves the notification preview's truncation point 90 characters left — eating the
 * payment-intent id off the end, which is the one part nobody can reconstruct.
 */
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { listActiveAdminRecipients } from "./forward-board-alerts.js";
import { outbound } from "./message-opener.js";

/**
 * Text every active admin about money that moved without anyone deciding it should.
 *
 * Best-effort per recipient — one dead number cannot mute the rest — and returns how many
 * actually sent, so the caller can log the difference between "nobody to tell" and "told".
 * No recipients (or a Twilio-dark deploy, which the edge resolves before calling) ⇒ 0.
 *
 * **Never throws.** Every caller is a Stripe webhook, where an exception is a 500 and a 500 is
 * a redelivery loop. An alert that fails must degrade to the caller's log line, not take the
 * ledger write down with it.
 */
export async function forwardMoneyAlert(
  repo: Repository,
  channel: ChannelPort,
  body: string,
  link: string,
): Promise<number> {
  let recipients;
  try {
    recipients = await listActiveAdminRecipients(repo);
  } catch {
    return 0; // a repo outage must not 500 the webhook — the caller's log line stands
  }
  if (recipients.length === 0) return 0;

  const composed = outbound("admin", body);
  let sent = 0;
  for (const r of recipients) {
    try {
      await channel.send({
        to: { crewMemberId: r.crewMemberId, phone: r.phone },
        kind: "admin_alert",
        body: composed,
        link,
      });
      sent++;
    } catch {
      // best-effort: keep going so one bad number can't mute the rest
    }
  }
  return sent;
}
