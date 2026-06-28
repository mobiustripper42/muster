/**
 * Fake / log notification adapter (DEC-050 / DEC-MSG-3 — the doorbell sibling of
 * `FakeChannel`). The only `NotificationPort` delivery 6.6a ships: `send` records
 * the ring instead of transmitting it, and tests / the 6.6b loop read `sent` to
 * assert what would have rung. NOT throwaway — it's how the doorbell tick → ring
 * path gets driven deterministically before any real relay (6.8) or SMS (DEC-MSG-1)
 * adapter exists.
 *
 * Clockless like the rest of the core: the delivery stamp comes from an injected
 * clock so tests are deterministic. Default clock is the wall clock for dev use.
 */

import type { SendResult } from "../ports/channel.js";
import type { NotificationMessage, NotificationPort } from "../ports/notification.js";

/** A captured ring: the notification plus the stamp `send` returned for it. */
export interface SentNotification extends NotificationMessage {
  deliveredAt: string;
  ref: string;
}

export class FakeNotificationChannel implements NotificationPort {
  readonly #now: () => Date;
  readonly #sent: SentNotification[] = [];

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const deliveredAt = this.#now().toISOString();
    const ref = `fake-nfy-${this.#sent.length}`;
    this.#sent.push({ ...message, deliveredAt, ref });
    return { deliveredAt, ref };
  }

  /** Everything rung so far, in send order. A copy — callers can't mutate the log. */
  get sent(): readonly SentNotification[] {
    return [...this.#sent];
  }

  /** The most recent ring, or undefined if nothing's rung. */
  last(): SentNotification | undefined {
    return this.#sent[this.#sent.length - 1];
  }

  /** Forget the log (between test cases that share an instance). */
  clear(): void {
    this.#sent.length = 0;
  }
}
