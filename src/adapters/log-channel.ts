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
 * **It mints a real link.** The whole value over a bare `console.log` is that the line
 * is usable: same `issueMagicLink` call, same 24h TTL as the ask's answer window
 * (`RELAY_LINK_TTL_MS`), so tapping it signs the crew member in and lands them on their
 * Yes/No screen. A logged ask you cannot answer would not replace the outbox, it would
 * just describe it.
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
}

export class LogChannel implements ChannelPort, NoticePort, NotificationPort {
  readonly #repo: Repository;
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;
  readonly #sink: (line: string) => void;

  constructor(repo: Repository, options: LogChannelOptions) {
    this.#repo = repo;
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
    this.#sink = options.sink ?? ((line) => console.error(line));
  }

  async send(
    message: OutboundMessage | AssignmentNotice | NotificationMessage,
  ): Promise<SendResult> {
    const now = this.#now();
    const crewMemberId = requireCrewId(message.to);

    let kind: string;
    let extraQuery = "";
    if ("threadId" in message) {
      kind = "ring";
      // Deep-links into the thread, matching `TwilioChannel` — a ring that lands on the
      // shift list instead of the message is a different message.
      extraQuery = `&thread=${encodeURIComponent(String(message.threadId))}`;
    } else if ("action" in message) {
      kind = `notice:${message.action}`;
    } else {
      kind = message.kind;
    }

    const link = await this.#mintLink(crewMemberId, extraQuery);
    const phone = message.to.phone ?? "no phone on file";
    this.#sink(
      `[channel:${kind}] NOT SENT — no channel configured. to=${crewMemberId} / ${phone}\n` +
        `${message.body}\n${link}`,
    );

    // `deliveredAt` is when the LINE was written, and the `ref` says so in words —
    // nothing downstream should be able to mistake this for a transmission.
    return { deliveredAt: now.toISOString(), ref: `logged-${kind}` };
  }

  /** Fresh one-time crew magic link, minted at send exactly as the real channels do. */
  async #mintLink(crewMemberId: CrewMemberId, extraQuery = ""): Promise<string> {
    const { secret } = await issueMagicLink(
      this.#repo,
      { subjectKind: "crew", subjectId: crewMemberId, ttlMs: RELAY_LINK_TTL_MS },
      { now: this.#now(), mintSecret: this.#mintSecret },
    );
    return `${this.#linkBase}/crew/auth?t=${secret}${extraQuery}`;
  }
}
