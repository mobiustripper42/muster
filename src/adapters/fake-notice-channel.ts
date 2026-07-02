import type { SendResult } from "../ports/channel.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";

/** A captured notice: the message plus the stamp `send` returned for it. */
export interface SentNotice extends AssignmentNotice {
  deliveredAt: string;
  ref: string;
}

/** In-memory `NoticePort` recorder for tests (DEC-084) — sibling of
 * `FakeNotificationChannel`. Captures every assignment-change notice sent. */
export class FakeNoticeChannel implements NoticePort {
  readonly #now: () => Date;
  readonly #sent: SentNotice[] = [];

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async send(notice: AssignmentNotice): Promise<SendResult> {
    const deliveredAt = this.#now().toISOString();
    const ref = `fake-notice-${this.#sent.length}`;
    this.#sent.push({ ...notice, deliveredAt, ref });
    return { deliveredAt, ref };
  }

  /** Everything sent so far, in send order. A copy — callers can't mutate the log. */
  get sent(): readonly SentNotice[] {
    return [...this.#sent];
  }

  last(): SentNotice | undefined {
    return this.#sent[this.#sent.length - 1];
  }

  clear(): void {
    this.#sent.length = 0;
  }
}
