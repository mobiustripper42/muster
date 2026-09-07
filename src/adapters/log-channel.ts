/**
 * The channel that writes what it would have sent (#934, tracking #901).
 *
 * This is what stands where the three outbox adapters stood. When no Twilio key is
 * configured, an ask, an assignment notice or a doorbell ring used to become a row in
 * one of three tables, rendered on `/admin/outbox` as an `sms:` deep link the operator
 * tapped to send from their own phone. That screen is gone. This logs the message
 * instead, magic link included, so a dev can read it — and click it — in the terminal.
 *
 * **One `send` for all three ports**, discriminated by payload shape exactly as
 * `TwilioChannel` does: `threadId` ⇒ doorbell ring, `action` ⇒ assignment notice, else
 * ask. Keeping the same shape is what makes this a drop-in at all three fallback sites.
 *
 * **It mints a real link — in non-prod ONLY, and that gate is the important line in this
 * file.** In dev the clickable link is the whole point: same `issueMagicLink` call, same
 * 24h TTL as the ask's answer window, so tapping it signs the crew member in and lands
 * them on their Yes/No screen. A logged ask you cannot answer would describe the outbox
 * rather than replace it.
 *
 * In production it mints nothing, because that line would be a **credential**, and for one
 * recipient an admin one. `OPERATOR_CREW_MEMBER_ID` is asked for seats like anyone else,
 * and that crew id is also an active admin (DEC-092) — redeeming their crew link gives a
 * crew session, and `switchToAdmin` (`app/lib/switch-actions.ts:41`) upgrades it to admin
 * with no re-auth, which its own docstring calls "the one escalation seam in the app". So
 * a prod log line carrying that link is a full admin credential sitting in a stream that
 * log-read access alone can reach.
 *
 * `mintLink` therefore defaults to **false**: the safe value is the one you get by
 * forgetting. `app/lib/auth-delivery.ts:58` sets the precedent in the other direction —
 * it hard-returns on `isProdDeploy()` "so a prod flag-flip can never write a live
 * credential to a production log", and this is the same class of line.
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

import type { CrewMemberId } from "../domain/ids.js";
import {
  RELAY_LINK_TTL_MS,
  type ChannelPort,
  type OutboundMessage,
  requireCrewId,
  type SendResult,
} from "../ports/channel.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";
import type { NotificationMessage, NotificationPort } from "../ports/notification.js";
import type { Repository } from "../ports/repository.js";
import { issueMagicLink, randomSecret } from "../auth/magic-link.js";
import { stripTrailingSlashes } from "../config/base-url.js";

export interface LogChannelOptions {
  /** The externally-reachable origin links are built on. Must be a trusted config value. */
  linkBase: string;
  /** Injected clock — defaults to the wall clock. */
  now?: () => Date;
  /** Injected secret generator — defaults to crypto-random. */
  mintSecret?: () => string;
  /** Where the line goes. Defaults to `console.error`; the app picks by environment. */
  sink?: (line: string) => void;
  /**
   * Mint and log a live magic link. **Defaults to false** — see the header. Set it only
   * where the log is not a production stream.
   */
  mintLink?: boolean;
}

export class LogChannel implements ChannelPort, NoticePort, NotificationPort {
  readonly #repo: Repository;
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;
  readonly #sink: (line: string) => void;
  readonly #mintLinks: boolean;

  constructor(repo: Repository, options: LogChannelOptions) {
    this.#repo = repo;
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
    this.#sink = options.sink ?? ((line) => console.error(line));
    this.#mintLinks = options.mintLink ?? false;
  }

  async send(
    message: OutboundMessage | AssignmentNotice | NotificationMessage,
  ): Promise<SendResult> {
    const now = this.#now();

    // The branch structure is `TwilioChannel`'s, deliberately and to the letter — the
    // two are meant to be interchangeable at the same three port types, so a message
    // that degrades on one must not throw on the other. In particular the generic
    // branch takes a GUEST recipient (a receipt, a booking link) and must not demand a
    // crew id, and it honours a pre-composed `message.link` rather than minting over it.
    let kind: string;
    let line: string;
    if ("threadId" in message) {
      kind = "ring";
      // Deep-links into the thread — a ring that lands on the shift list instead of the
      // message is a different message.
      const link = await this.#mintLink(
        requireCrewId(message.to),
        `&thread=${encodeURIComponent(String(message.threadId))}`,
      );
      line = `${message.body}${link}`;
    } else if ("action" in message) {
      kind = `notice:${message.action}`;
      line = `${message.body}${await this.#mintLink(requireCrewId(message.to))}`;
    } else if (message.kind === "ask") {
      kind = "ask";
      const link = message.link ? `\n${message.link}` : await this.#mintLink(requireCrewId(message.to));
      line = `${message.body}${link}`;
    } else {
      // magic_link / receipt / admin_alert / booking_request: body and any link arrive
      // composed, and the recipient may be a guest with no crew id at all.
      kind = message.kind;
      line = message.link ? `${message.body}\n${message.link}` : message.body;
    }

    const who = message.to.crewMemberId ?? message.to.email ?? "unknown recipient";
    const phone = message.to.phone ?? "no phone on file";
    this.#sink(
      `[channel:${kind}] NOT SENT — no channel configured. to=${who} / ${phone}\n${line}`,
    );

    // `deliveredAt` is when the LINE was written, and the `ref` says so in words —
    // nothing downstream should be able to mistake this for a transmission.
    return { deliveredAt: now.toISOString(), ref: `logged-${kind}` };
  }

  /**
   * A newline plus a fresh one-time crew magic link — or a newline plus a note that no
   * link was minted, when `mintLink` is off. Returns the separator too, so the caller
   * cannot accidentally emit a trailing newline with nothing after it.
   *
   * **Minting is skipped entirely in the off case, not merely hidden.** Writing an
   * unredeemed 24h credential into the token table on every unsent ask would be the same
   * exposure one indirection further away.
   */
  async #mintLink(crewMemberId: CrewMemberId, extraQuery = ""): Promise<string> {
    if (!this.#mintLinks) {
      return "\n(no sign-in link minted — configure Twilio, or read this in dev where the link is included)";
    }
    const { secret } = await issueMagicLink(
      this.#repo,
      { subjectKind: "crew", subjectId: crewMemberId, ttlMs: RELAY_LINK_TTL_MS },
      { now: this.#now(), mintSecret: this.#mintSecret },
    );
    return `\n${this.#linkBase}/crew/auth?t=${secret}${extraQuery}`;
  }
}
