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
 * Link handling mirrors the outbox adapters it replaces (DEC-030 "mint at
 * send"): each SMS that needs a tap-in appends a fresh one-time magic link —
 * the ask's In/Out URL, the notice's my-shifts sign-in, the ring's thread
 * deep-link. Minted here, once, straight into the delivered text.
 *
 * Unlike the outbox worklist adapters there is no dedupe slot: a real SMS has
 * no "pending entry" to upsert. The forward-* glue only calls per committed
 * domain action, so a duplicate send needs a duplicate domain event — accepted
 * (an extra text beats a missed one; best-effort posture throughout).
 *
 * Throws (port contract) on a missing recipient phone or a non-2xx from
 * Twilio — every caller is a best-effort forwarder that swallows per-message.
 */

import { issueMagicLink, randomSecret } from "../auth/magic-link.js";
import type { CrewMemberId } from "../domain/ids.js";
import {
  type ChannelPort,
  type OutboundMessage,
  requireCrewId,
  type SendResult,
} from "../ports/channel.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";
import type {
  NotificationMessage,
  NotificationPort,
} from "../ports/notification.js";
import type { Repository } from "../ports/repository.js";
import type { FetchLike } from "./email-channel.js";
import { RELAY_LINK_TTL_MS } from "./web-link-channel.js";

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
  /** Injected secret generator — defaults to crypto-random. */
  mintSecret?: () => string;
}

export class TwilioChannel implements ChannelPort, NoticePort, NotificationPort {
  readonly #repo: Repository;
  readonly #opts: Pick<
    TwilioChannelOptions,
    "accountSid" | "authToken" | "from" | "messagingServiceSid"
  >;
  readonly #linkBase: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;

  constructor(repo: Repository, options: TwilioChannelOptions) {
    this.#repo = repo;
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
    this.#linkBase = options.linkBase.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
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
      const link = await this.#mintLink(
        requireCrewId(message.to),
        `&thread=${encodeURIComponent(String(message.threadId))}`,
      );
      text = `${message.body}\n${link}`;
    } else if ("action" in message) {
      // Assignment notice (DEC-084): body composed + frozen by forwardNotices;
      // the link signs the crew member into their my-shifts view.
      const link = await this.#mintLink(requireCrewId(message.to));
      text = `${message.body}\n${link}`;
    } else if (message.kind === "ask") {
      // The ask (DEC-030): same 24h answer-window link the web-link relay
      // mints — the crew member taps, lands authenticated on In/Out, and
      // answers through `recordResponseAndConfirm`. No inbound SMS parsing.
      const link =
        message.link ?? (await this.#mintLink(requireCrewId(message.to)));
      text = `${message.body}\n${link}`;
    } else {
      // magic_link / receipt: the body (and optional link) arrive composed.
      text = message.link ? `${message.body}\n${message.link}` : message.body;
    }

    return this.#deliver(phone, text);
  }

  /** Fresh one-time crew magic link (mint-at-send, DEC-030) — 24h TTL. */
  async #mintLink(
    crewMemberId: CrewMemberId,
    extraQuery = "",
  ): Promise<string> {
    const { secret } = await issueMagicLink(
      this.#repo,
      { subjectKind: "crew", subjectId: crewMemberId, ttlMs: RELAY_LINK_TTL_MS },
      { now: this.#now(), mintSecret: this.#mintSecret },
    );
    return `${this.#linkBase}/crew/auth?t=${secret}${extraQuery}`;
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
      // Surface status + Twilio's error body; the message text (which embeds a
      // live magic link) is deliberately NOT echoed into the error.
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio send failed (${res.status}): ${detail}`);
    }

    // Twilio returns the message resource; `sid` is the audit ref. A
    // malformed-but-2xx body shouldn't fail a successful send.
    let ref: string | undefined;
    try {
      ref = (JSON.parse(await res.text()) as { sid?: string }).sid;
    } catch {
      ref = undefined;
    }
    const deliveredAt = this.#now().toISOString();
    return ref !== undefined ? { deliveredAt, ref } : { deliveredAt };
  }
}
