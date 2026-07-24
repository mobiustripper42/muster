/**
 * Email channel adapter (DEC-081, DEC-MSG-3 adapter on the ChannelPort seam).
 *
 * The seam the port built ahead for: `Recipient.email` existed unconsumed and
 * `MessageKind` already had `magic_link`. This delivers the crew sign-in code by
 * email via **Resend's HTTP API called with plain `fetch`** — no SDK, the same
 * env-key+fetch shape as the Xola adapter (`app/lib/xola.ts`), so it clears the
 * dependency bar (could we do it with what we have? yes).
 *
 * Pure transport: the caller mints the code and hands it in as the message body;
 * this just sends. `fetch` is injected so a unit test asserts the request shape
 * (URL, auth, from/to/subject/body) without a live send — the real inbox check
 * is a post-DKIM human step, never a CI gate.
 *
 * Throws (port contract: `send` may throw when the medium rejects) on a missing
 * recipient email or a non-2xx from Resend — the caller schedules this off the
 * request hot path (`after()`), so a throw here never reaches the crew member.
 */

import type {
  ChannelPort,
  MessageKind,
  OutboundMessage,
  SendResult,
} from "../ports/channel.js";

/** Minimal shape of the global `fetch` the adapter needs — injectable for tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Subject line per message purpose. Only `magic_link` (the sign-in code) is
 *  sent today; the others are here so a new kind can't fall through to blank. */
const SUBJECT_BY_KIND: Record<MessageKind, string> = {
  magic_link: "Your Muster sign-in code",
  ask: "Muster — a shift needs you",
  receipt: "Muster",
  // admin_alert goes out over SMS (DEC-095), never email — here only so the
  // exhaustive Record can't fall through to blank if that ever changes.
  admin_alert: "Muster — At-Risk alert",
  // Customer cancel/change request from the booking link (12.6) — the specifics
  // (name, trip, kind, note) ride the body; the subject stays generic.
  booking_request: "Muster — booking change request",
};

export interface EmailChannelOptions {
  /** Resend API key. */
  apiKey: string;
  /** Verified sender, e.g. `Muster <crew@crew.brewcle.com>`. */
  from: string;
  /** Injected — defaults to the global `fetch` for app/dev use. */
  fetch?: FetchLike;
  /** Injected clock — defaults to the wall clock (FakeChannel/WebLinkChannel parity). */
  now?: () => Date;
}

export class EmailChannel implements ChannelPort {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(options: EmailChannelOptions) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#now = options.now ?? (() => new Date());
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.to.email;
    if (!to) throw new Error("email channel needs a recipient email");

    const res = await this.#fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.#from,
        to: [to],
        subject: SUBJECT_BY_KIND[message.kind],
        text: message.body,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }

    // Resend returns `{ id }`; surface it as the audit ref. A malformed-but-2xx
    // body shouldn't fail a successful send, so parse defensively. Omit `ref`
    // when absent (exactOptionalPropertyTypes — can't assign `undefined`).
    let ref: string | undefined;
    try {
      ref = (JSON.parse(await res.text()) as { id?: string }).id;
    } catch {
      ref = undefined;
    }
    const deliveredAt = this.#now().toISOString();
    return ref !== undefined ? { deliveredAt, ref } : { deliveredAt };
  }
}
