/**
 * The channel that writes what it would have sent (#934, tracking #901).
 *
 * This is what stands where the three outbox adapters stood. When no Twilio key is
 * configured, an ask, an assignment notice or a doorbell ring used to become a row in
 * one of three tables, rendered on `/admin/outbox` as an `sms:` deep link the operator
 * tapped to send from their own phone. That screen is gone. This logs the message
 * instead, link included, so a dev can read it — and click it — in the terminal.
 *
 * **One `send` for all three ports**, discriminated by payload shape exactly as
 * `TwilioChannel` does: `threadId` ⇒ doorbell ring, `action` ⇒ assignment notice, else
 * ask. Keeping the same shape is what makes this a drop-in at all three fallback sites.
 *
 * **The crew link is the same plain one `TwilioChannel` sends** — `/crew`, or the thread
 * for a ring — and since issue #1030 it carries no secret, so it is safe in any log. Until
 * then this class minted a live magic link, and production had to mint nothing because the
 * line was an admin credential for `OPERATOR_CREW_MEMBER_ID`. That whole posture went with
 * the magic link.
 *
 * **One secret can still arrive in a line: a booking code** in a composed customer body —
 * see {@link redactBookingCodes}. `revealBookingCodes` defaults to **false**: the safe value
 * is the one you get by forgetting.
 *
 * **This is not a delivery, and the `SendResult` says only that the line was written.**
 * The crew forwarders are best-effort and return `void`, so nothing renders a "Sent" off
 * the back of it — which is the distinction `app/lib/booking-confirmation.ts` protects
 * on the reservations side by returning `skipped` rather than passing a fake channel.
 *
 * Clockless and sink-injected like the rest of the core: the app decides severity
 * (`console.error` in prod so sheepdog sees it, `console.log` in dev where you are
 * already watching), and the tests pass a recorder.
 */

import {
  type ChannelPort,
  type OutboundMessage,
  requireCrewId,
  type SendResult,
} from "../ports/channel.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";
import type { NotificationMessage, NotificationPort } from "../ports/notification.js";
import { stripTrailingSlashes } from "../config/base-url.js";
import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
} from "../reservations/booking-code.js";

export interface LogChannelOptions {
  /** The externally-reachable origin links are built on. Must be a trusted config value. */
  linkBase: string;
  /** Injected clock — defaults to the wall clock. */
  now?: () => Date;
  /** Where the line goes. Defaults to `console.error`; the app picks by environment. */
  sink?: (line: string) => void;
  /**
   * Leave a `/b/<code>` in the line intact. **Defaults to false** — see
   * {@link redactBookingCodes}. Set it only where the log is not a production stream.
   */
  revealBookingCodes?: boolean;
}

/**
 * Strip a live `/b/<code>` out of a line bound for a production log (#955).
 *
 * **Why the old `mintLink` guard did not already cover this.** That flag governed the CREW magic
 * link this class minted until issue #1030, and a customer receipt arrives with its link already
 * composed into `body` — so the guard never looked at it. The two are the same kind of secret: `booking-code.ts` calls a
 * booking code a CREDENTIAL rather than an identifier, `app/b/[code]` resolves it with no session,
 * and it never expires.
 *
 * **What changed to make it matter.** Before #955 a customer receipt reached this sink only when
 * BOTH email and SMS were unconfigured. The deleted `app/lib/unsent.ts` weighed that and accepted
 * it because the path was rare. Every send site now falls back here, so on a Twilio-dark
 * production deploy with email working it is every confirmation and every recovery link — and the
 * production sink is `console.error` precisely so a monitoring pipeline ingests it, which
 * replicates the credential into a second store. Rare became routine; the accepted trade did not
 * survive that.
 *
 * Redacting here rather than at the nine call sites is the same argument as `makeSmsChannel`
 * itself: this is the one place a tenth caller cannot forget.
 *
 * The line stays useful. What did not go out and to whom both survive — only the secret goes.
 */
export function redactBookingCodes(line: string, reveal: boolean): string {
  if (reveal) return line; // dev: the clickable link is the entire point of reading the line
  return line.replace(
    new RegExp(`/b/[${BOOKING_CODE_ALPHABET}]{${BOOKING_CODE_LENGTH}}`, "g"),
    "/b/<redacted>",
  );
}

export class LogChannel implements ChannelPort, NoticePort, NotificationPort {
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #sink: (line: string) => void;
  readonly #revealBookingCodes: boolean;

  constructor(options: LogChannelOptions) {
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#now = options.now ?? (() => new Date());
    this.#sink = options.sink ?? ((line) => console.error(line));
    this.#revealBookingCodes = options.revealBookingCodes ?? false;
  }

  async send(
    message: OutboundMessage | AssignmentNotice | NotificationMessage,
  ): Promise<SendResult> {
    const now = this.#now();

    // The branch structure is `TwilioChannel`'s, deliberately and to the letter — the
    // two are meant to be interchangeable at the same three port types, so a message
    // that degrades on one must not throw on the other. In particular the generic
    // branch takes a GUEST recipient (a receipt, a booking link) and must not demand a
    // crew id, and it honours a pre-composed `message.link` rather than writing over it.
    let kind: string;
    let line: string;
    if ("threadId" in message) {
      kind = "ring";
      // Deep-links into the thread — a ring that lands on the shift list instead of the
      // message is a different message.
      requireCrewId(message.to);
      line = `${message.body}\n${this.#linkBase}/crew/threads/${encodeURIComponent(String(message.threadId))}`;
    } else if ("action" in message) {
      kind = `notice:${message.action}`;
      requireCrewId(message.to);
      line = `${message.body}\n${this.#linkBase}/crew`;
    } else if (message.kind === "ask") {
      kind = "ask";
      requireCrewId(message.to);
      line = `${message.body}\n${message.link ?? `${this.#linkBase}/crew`}`;
    } else {
      // magic_link / receipt / admin_alert / booking_request: body and any link arrive
      // composed, and the recipient may be a guest with no crew id at all.
      kind = message.kind;
      line = message.link ? `${message.body}\n${message.link}` : message.body;
    }

    const who = message.to.crewMemberId ?? message.to.email ?? "unknown recipient";
    const phone = message.to.phone ?? "no phone on file";
    this.#sink(
      `[channel:${kind}] NOT SENT — no channel configured. to=${who} / ${phone}\n${redactBookingCodes(line, this.#revealBookingCodes)}`,
    );

    // `deliveredAt` is when the LINE was written, and the `ref` says so in words —
    // nothing downstream should be able to mistake this for a transmission. `loggedOnly` is the
    // machine-readable half of that sentence (#955): the `ref` said it to a human reading a log,
    // which left `resendBookingLink` reporting a green "sent" over a console line.
    return { deliveredAt: now.toISOString(), ref: `logged-${kind}`, loggedOnly: true };
  }
}
