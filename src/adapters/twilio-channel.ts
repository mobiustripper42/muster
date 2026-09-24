/**
 * Twilio SMS adapter (9.4/#225 — the DEC-MSG-1 swap the channel architecture
 * was built for). ONE class implementing all three sibling relay ports — the
 * ask `ChannelPort` (DEC-030), the doorbell-ring `NotificationPort` (DEC-073),
 * and the assignment-notice `NoticePort` (DEC-084) — the "many adapters, one
 * transport" convergence DEC-050 predicted. Zero domain change: the engine
 * still emits intent; this is a different constructor at the edge.
 *
 * Delivery is **Twilio's Messages API called with plain `fetch`** — no SDK,
 * the same env-key+fetch shape as the Resend/Xola adapters (dependency bar:
 * could we do it with what we have? yes). `fetch` is injected so unit tests
 * assert the request shape without a live send.
 *
 * Each crew SMS appends a PLAIN link — `/crew` for the ask (where Yes/No is
 * answered) and the notice, the thread for a ring. No secret rides in any text
 * (issue #1030): a signed-in crew member lands where the link points, a
 * signed-out one at the 6-digit code door (DEC-081), one login and no second one.
 *
 * Unlike the outbox worklist adapters there is no dedupe slot: a real SMS has
 * no "pending entry" to upsert. The forward-* glue only calls per committed
 * domain action, so a duplicate send needs a duplicate domain event — accepted
 * (an extra text beats a missed one; best-effort posture throughout).
 *
 * Throws (port contract) on a missing recipient phone or a non-2xx from
 * Twilio — every caller is a best-effort forwarder that swallows per-message.
 */

import { logSwallowed } from "../log.js";
import {
  type ChannelPort,
  type OutboundMessage,
  requireCrewId,
  type SendResult,
  ChannelSendError,
} from "../ports/channel.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";
import type {
  NotificationMessage,
  NotificationPort,
} from "../ports/notification.js";
import type { FetchLike } from "./email-channel.js";
import { stripTrailingSlashes } from "../config/base-url.js";

/** Twilio Messages endpoint for an account (2010-04-01 is Twilio's stable API). */
export function twilioEndpoint(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

export interface TwilioChannelOptions {
  /** Twilio account SID (AC…). */
  accountSid: string;
  /** Twilio auth token — server-only, never logged. */
  authToken: string;
  /**
   * Messaging Service SID (MG…) of the approved A2P 10DLC campaign — the
   * PREFERRED sender: Twilio routes the send through the campaign's sender
   * pool, which is what clears error 30034 (a bare +1 long code not attached
   * to a campaign is blocked for US A2P traffic). Wins over `from` when both
   * are set.
   */
  messagingServiceSid?: string;
  /** Fallback sender: a single E.164 number (toll-free, or a campaign-attached
   *  long code). Required only when `messagingServiceSid` is absent. */
  from?: string;
  /**
   * Externally-reachable origin for delivered links (no trailing slash); MUST be
   * the trusted `APP_BASE_URL` in prod (host-header poisoning — see base-url.ts).
   */
  linkBase: string;
  /** Injected — defaults to the global `fetch` for app/dev use. */
  fetch?: FetchLike;
  /** Injected clock — defaults to the wall clock (adapter parity). */
  now?: () => Date;
}

export class TwilioChannel implements ChannelPort, NoticePort, NotificationPort {
  readonly #opts: Pick<
    TwilioChannelOptions,
    "accountSid" | "authToken" | "from" | "messagingServiceSid"
  >;
  readonly #linkBase: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(options: TwilioChannelOptions) {
    if (!options.messagingServiceSid && !options.from) {
      throw new Error("twilio channel needs messagingServiceSid or from");
    }
    this.#opts = {
      accountSid: options.accountSid,
      authToken: options.authToken,
      ...(options.from !== undefined ? { from: options.from } : {}),
      ...(options.messagingServiceSid !== undefined
        ? { messagingServiceSid: options.messagingServiceSid }
        : {}),
    };
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * One `send` for all three ports, discriminated by payload shape:
   * `threadId` ⇒ doorbell ring, `action` ⇒ assignment notice, else ask/outbound.
   */
  async send(
    message: OutboundMessage | AssignmentNotice | NotificationMessage,
  ): Promise<SendResult> {
    const phone = message.to.phone;
    if (!phone) throw new Error("twilio channel needs a recipient phone");

    let text: string;
    if ("threadId" in message) {
      // Doorbell ring (DEC-073): body is composed (summary/content) by
      // forwardNotifications; the link deep-links into the thread.
      requireCrewId(message.to);
      const link = `${this.#linkBase}/crew/threads/${encodeURIComponent(String(message.threadId))}`;
      text = `${message.body}\n${link}`;
    } else if ("action" in message) {
      // Assignment notice (DEC-084): body composed + frozen by forwardNotices;
      // the link opens their my-shifts view.
      requireCrewId(message.to);
      text = `${message.body}\n${this.#linkBase}/crew`;
    } else if (message.kind === "ask") {
      // The ask (DEC-030): the crew member taps, lands on /crew where Yes/No
      // is answered through `recordResponseAndConfirm`. No inbound SMS parsing.
      requireCrewId(message.to);
      const link = message.link ?? `${this.#linkBase}/crew`;
      text = `${message.body}\n${link}`;
    } else {
      // magic_link / receipt: the body (and optional link) arrive composed.
      text = message.link ? `${message.body}\n${message.link}` : message.body;
    }

    return this.#deliver(phone, text);
  }

  async #deliver(to: string, body: string): Promise<SendResult> {
    const auth = Buffer.from(
      `${this.#opts.accountSid}:${this.#opts.authToken}`,
    ).toString("base64");
    const res = await this.#fetch(twilioEndpoint(this.#opts.accountSid), {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      // Campaign routing beats a bare number: MessagingServiceSid sends via
      // the A2P campaign's sender pool (no 30034); From is the fallback.
      body: new URLSearchParams({
        To: to,
        ...(this.#opts.messagingServiceSid
          ? { MessagingServiceSid: this.#opts.messagingServiceSid }
          : { From: this.#opts.from! }),
        Body: body,
      }).toString(),
    });

    if (!res.ok) {
      // Surface status + Twilio's error body; the message text (which can embed a
      // booking link — a credential) is deliberately NOT echoed into the error.
      //
      // Read that claim precisely: it is about what WE interpolate, not about what Twilio
      // returns in `detail`. Since #902 this error is logged rather than discarded, so the
      // difference matters — and it is handled at the log sites, not here.
      // eslint-disable-next-line no-restricted-syntax -- reads the body of an error already being thrown
      const detail = await res.text().catch(() => "");
      throw new ChannelSendError("Twilio", res.status, detail);
    }

    // Twilio returns the message resource; `sid` is the audit ref. A
    // malformed-but-2xx body shouldn't fail a successful send.
    let ref: string | undefined;
    try {
      ref = (JSON.parse(await res.text()) as { sid?: string }).sid;
    } catch (e) {
      // The send SUCCEEDED; only the audit ref is lost, and the ref is how a delivery is
      // traced back at the provider later. Otherwise invisible — the caller gets a
      // `deliveredAt` and no hint that the reference is missing.
      //
      // **The error's MESSAGE is deliberately not logged.** This is a `JSON.parse` failure,
      // whose message embeds the input it choked on — and the input is the provider's
      // message resource, which carries the sent body, which can carry a booking link. The
      // error's TYPE is the part that is safe and is most of the signal anyway.
      logSwallowed(
        "sms:send",
        e instanceof Error ? e.name : "unknown error type",
        "the send succeeded but its provider reference could not be parsed — no audit ref",
      );
      ref = undefined;
    }
    const deliveredAt = this.#now().toISOString();
    return ref !== undefined ? { deliveredAt, ref } : { deliveredAt };
  }
}
