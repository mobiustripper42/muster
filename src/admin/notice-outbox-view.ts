import type { AssignmentAction, OutboxStatus } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";

/**
 * Assignment-change relay view (DEC-084) — the "Assignment changes" section of
 * `/admin/outbox`, sibling to the ask + ring views. A pure read over
 * `notice_outbox`, split pending / sent and sorted by recency.
 *
 * **Terminal-on-sent, NOT drop-on-read** (unlike the ring view): a notice has no
 * thread + no read-state, so there's nothing to drop against. A sent notice stays in
 * the `sent` list as the durable "we told them" record; the operator marking it sent
 * is the only lifecycle transition. Adapter-side (DEC-030): only this view reads the
 * table, only `OutboxNoticeChannel` writes it.
 */

export interface NoticeOutboxCardView {
  entryId: string;
  crewMemberId: string;
  crewName: string;
  /** Live from the crew record; "" when none (the no-phone case the card flags). */
  crewPhone: string;
  action: AssignmentAction;
  /** The frozen relay text ("you're off the Sat, Jul 4 · Barrel shift."). */
  body: string;
  /** The frozen /crew magic link. */
  link: string;
  status: OutboxStatus;
  /** ISO-8601 UTC enqueue time — the recency sort key. */
  createdAt: string;
  sentAt: string | null;
}

export interface NoticeOutboxView {
  pending: NoticeOutboxCardView[];
  sent: NoticeOutboxCardView[];
}

export async function buildNoticeOutboxView(
  repo: Repository,
): Promise<NoticeOutboxView> {
  const entries = await repo.listNoticeOutboxEntries();
  const cards: NoticeOutboxCardView[] = [];

  for (const e of entries) {
    const crew = await repo.getCrewMember(e.crewMemberId);
    cards.push({
      entryId: String(e.id),
      crewMemberId: String(e.crewMemberId),
      crewName: crew?.name ?? String(e.crewMemberId),
      crewPhone: crew?.phone ?? "",
      action: e.action,
      body: e.body,
      link: e.link,
      status: e.status,
      createdAt: e.createdAt,
      sentAt: e.sentAt ?? null,
    });
  }

  cards.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.entryId.localeCompare(b.entryId),
  );
  return {
    pending: cards.filter((c) => c.status === "pending"),
    sent: cards.filter((c) => c.status === "sent"),
  };
}
