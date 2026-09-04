import type { NoticeOutboxEntry } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { AssignmentNotice, NoticePort } from "../ports/notice.js";
import { requireCrewId, type SendResult } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { issueMagicLink, randomSecret } from "../auth/magic-link.js";
// Reuse the ask relay's 24h TTL — same reasonable tap window, one const avoids drift.
import { RELAY_LINK_TTL_MS } from "./web-link-channel.js";
import { stripTrailingSlashes } from "../config/base-url.js";

export interface OutboxNoticeChannelOptions {
  /** Externally-reachable origin for delivered links (no trailing slash); MUST be
   *  the trusted `APP_BASE_URL` in prod (host-header poisoning — see base-url.ts). */
  linkBase: string;
  now?: () => Date;
  mintSecret?: () => string;
}

/**
 * The pilot `NoticePort` (DEC-084) — the assignment-change relay, sibling to
 * `OutboxNotificationChannel`. `send` enqueues a `NoticeOutboxEntry` instead of
 * transmitting; the operator works the `/admin/outbox` "Assignment changes" section,
 * texts the link, marks it sent. The link lands on `/crew/auth` → the crew's own
 * my-shifts view (no deep-link target — a release has no shift to open). `body` +
 * `link` are minted ONCE and frozen (DEC-030). Terminal-on-sent (DEC-084): the entry
 * is the durable "we told them" record — no drop-on-read (a notice has no thread).
 */
export class OutboxNoticeChannel implements NoticePort {
  readonly #repo: Repository;
  readonly #linkBase: string;
  readonly #now: () => Date;
  readonly #mintSecret: () => string;

  constructor(repo: Repository, options: OutboxNoticeChannelOptions) {
    this.#repo = repo;
    this.#linkBase = stripTrailingSlashes(options.linkBase);
    this.#now = options.now ?? (() => new Date());
    this.#mintSecret = options.mintSecret ?? randomSecret;
  }

  async send(notice: AssignmentNotice): Promise<SendResult> {
    const now = this.#now();
    const crewId = requireCrewId(notice.to);
    // Deterministic — one slot per (shift, member, action); a re-issued change
    // upserts it rather than piling duplicates on the operator's worklist (DEC-084).
    const id = asId<"NoticeOutboxEntryId">(
      `notice-${notice.shiftId}-${crewId}-${notice.action}`,
    );

    // Terminal-on-sent (DEC-084): if this exact change was already relayed AND the
    // operator marked it sent, preserve that durable "we told them" record — don't
    // reset it to pending with a fresh link. A re-enqueue only makes sense before
    // it's been sent (refreshing the still-pending slot).
    const existing = await this.#repo.getNoticeOutboxEntry(id);
    if (existing?.status === "sent") {
      return { deliveredAt: existing.createdAt, ref: existing.id };
    }

    // Minted at enqueue, frozen onto the entry (DEC-030) — a fresh one-time secret.
    // Lands on /crew/auth then the crew's my-shifts view.
    const { secret } = await issueMagicLink(
      this.#repo,
      { subjectKind: "crew", subjectId: crewId, ttlMs: RELAY_LINK_TTL_MS },
      { now, mintSecret: this.#mintSecret },
    );

    const entry: NoticeOutboxEntry = {
      id,
      crewMemberId: crewId,
      action: notice.action,
      body: notice.body, // composed by forwardNotices, frozen at enqueue
      link: `${this.#linkBase}/crew/auth?t=${secret}`,
      status: "pending",
      createdAt: now.toISOString(),
    };
    await this.#repo.saveNoticeOutboxEntry(entry);

    return { deliveredAt: entry.createdAt, ref: entry.id };
  }
}
