/**
 * Doorbell-ring relay adapter (DEC-073, the promotion gate) — the `NotificationPort`
 * sibling to {@link WebLinkChannel}, replacing `FakeNotificationChannel` at the one
 * swap point (`app/lib/doorbell.ts`).
 *
 * The pilot transport is the OPERATOR: `send` does not transmit — it mints a fresh
 * thread-**deep-link** magic link and enqueues a `RingOutboxEntry` the operator works
 * from the `/admin/outbox` "New messages" section (tap the `sms:` link, text it, mark
 * it sent). The crew member taps → lands authenticated **in the thread** → the
 * `ActivityBeacon` marks it read → the doorbell stops re-ringing and the entry self-
 * clears (DEC-073 drop-on-read). No inbound webhook, no Twilio.
 *
 * Mirrors WebLinkChannel's two DEC-030 rules — body + link minted ONCE at enqueue and
 * rendered verbatim; `deliveredAt` = enqueue time — with one ring-specific twist: a
 * FRESH one-time link per ring-cycle (first-only-until-read makes each enqueue a new
 * cycle), so the deterministic `ring-{thread}-{crew}` id upserts the slot rather than
 * piling duplicates. Best-effort by design (DEC-070): a failed enqueue drops that
 * cycle's ring until the recipient reads or a new message re-rings — re-ask isn't the
 * doorbell's job. Clockless/deterministic: `now` + `mintSecret` injectable.
 */

import type { RingOutboxEntry } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type {
  NotificationMessage,
  NotificationPort,
} from "../ports/notification.js";
import { requireCrewId, type SendResult } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { issueMagicLink, randomSecret } from "../auth/magic-link.js";
// Reuse the ask relay's 24h TTL. For a ring it isn't an "answer window" — just a
// reasonable tap window — but the value is the same and one const avoids drift.
import { RELAY_LINK_TTL_MS } from "./web-link-channel.js";
import { stripTrailingSlashes } from "../config/base-url.js";

export interface OutboxNotificationChannelOptions {
  /** Externally-reachable origin for delivered links (no trailing slash); MUST be
   *  the trusted `APP_BASE_URL` in prod (host-header poisoning — see base-url.ts). */
  linkBase: string;
  now?: () => Date;
  mintSecret?: () => string;
}

export class OutboxNotificationChannel implements NotificationPort {
  readonly #repo: Repository;
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;

  constructor(repo: Repository, options: OutboxNotificationChannelOptions) {
    this.#repo = repo;
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const now = this.#now();
    const crewId = requireCrewId(message.to);
    // Minted at enqueue, frozen onto the entry (DEC-030) — a fresh one-time secret
    // per cycle. The link lands on /crew/auth then deep-links into the thread.
    const { secret } = await issueMagicLink(
      this.#repo,
      { subjectKind: "crew", subjectId: crewId, ttlMs: RELAY_LINK_TTL_MS },
      { now, mintSecret: this.#mintSecret },
    );

    const entry: RingOutboxEntry = {
      // One slot per (thread, member), deterministic — a new ring-cycle upserts it,
      // never duplicating the operator's worklist (DEC-073). Both ids are
      // hyphen-bearing, so this concatenation is injective by their `thread-`/`crew-`
      // prefixes (not by a delimiter ids can't contain); a real collision is
      // effectively impossible and degrades to a dropped ring (best-effort), never a
      // misdelivery.
      id: asId<"RingOutboxEntryId">(`ring-${message.threadId}-${crewId}`),
      crewMemberId: crewId,
      threadId: message.threadId,
      body: message.body, // already composed (content/summary) by forwardNotifications
      link: `${this.#linkBase}/crew/auth?t=${secret}&thread=${encodeURIComponent(String(message.threadId))}`,
      status: "pending",
      createdAt: now.toISOString(),
    };
    await this.#repo.saveRingOutboxEntry(entry);

    return { deliveredAt: entry.createdAt, ref: entry.id };
  }
}
