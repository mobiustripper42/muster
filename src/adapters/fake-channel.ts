/**
 * Fake / log channel adapter (DEC-MSG-3 — adapter #1, permanent test infra).
 *
 * NOT a throwaway: this is how the seat + reliability state machine gets driven
 * deterministically in tests and how the magic link gets "delivered" in dev (the
 * link is logged, not emailed — real transactional email is deferred, DEC-020).
 * `send` records the message instead of transmitting it; tests/dev read `sent`
 * to assert what would have gone out (and to pull the magic link a dev needs to
 * click). Inbound replies are not this adapter's job — they re-enter through the
 * ask loop's `recordResponseAndConfirm` (a winning "in" auto-confirms, DEC-061;
 * the port is outbound-only by design).
 *
 * Clockless like the rest of the core: the delivery stamp comes from an injected
 * clock so tests are deterministic. Default clock is the wall clock for dev use.
 */

import type {
  ChannelPort,
  OutboundMessage,
  SendResult,
} from "../ports/channel.js";

/** A captured send: the message plus the stamp `send` returned for it. */
export interface SentMessage extends OutboundMessage {
  deliveredAt: string;
  ref: string;
}

export class FakeChannel implements ChannelPort {
  readonly #now: () => Date;
  readonly #sent: SentMessage[] = [];

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const deliveredAt = this.#now().toISOString();
    const ref = `fake-${this.#sent.length}`;
    this.#sent.push({ ...message, deliveredAt, ref });
    return { deliveredAt, ref };
  }

  /** Everything sent so far, in send order. A copy — callers can't mutate the log. */
  get sent(): readonly SentMessage[] {
    return [...this.#sent];
  }

  /** The most recent send, or undefined if nothing's been sent. */
  last(): SentMessage | undefined {
    return this.#sent[this.#sent.length - 1];
  }

  /** Convenience for assertions: sends filtered to one kind, in order. */
  ofKind(kind: OutboundMessage["kind"]): SentMessage[] {
    return this.#sent.filter((m) => m.kind === kind);
  }

  /** Forget the log (between test cases that share an instance). */
  clear(): void {
    this.#sent.length = 0;
  }
}
