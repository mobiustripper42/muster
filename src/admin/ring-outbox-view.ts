/**
 * The doorbell-ring relay worklist for the operator (#118, DEC-073) — the "New
 * messages" half of `/admin/outbox`, sibling to {@link buildOutboxView}.
 *
 * Two rules distinguish it from the ask outbox:
 *  - **Drop-on-read** (the ring analog of the ask's drop-on-settled): an entry leaves
 *    the worklist once the recipient has read the thread past the ring's enqueue
 *    (`message_reads.last_read_at >= createdAt`, DEC-069 read-state — no new state).
 *    The human taps the deep-link → the crew `ActivityBeacon` marks read → the entry
 *    self-clears. Without this the surface would rot (a ring has no `respondedAt`).
 *  - **Derive crew name/phone at render** (not stored on the entry), exactly as the
 *    ask view does — the relay text was frozen, the contact is live.
 *
 * Framework-free + data-only (DEC-020); the surface formats. Rings carry no trip, so
 * they sort by recency (newest first), pending and sent split like the ask outbox.
 */

import type { OutboxStatus } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { Repository } from "../ports/repository.js";

export interface RingOutboxCardView {
  entryId: string;
  crewMemberId: string;
  crewName: string;
  /** Live from the crew record; "" when none (the no-phone case the card flags). */
  crewPhone: string;
  threadId: string;
  /** The frozen relay text — "N new" or the inlined short note (§7.5). */
  body: string;
  /** The frozen thread deep-link magic link. */
  link: string;
  status: OutboxStatus;
  /** ISO-8601 UTC enqueue time — the recency sort key. */
  createdAt: string;
  sentAt: string | null;
}

export interface RingOutboxView {
  pending: RingOutboxCardView[];
  sent: RingOutboxCardView[];
}

export async function buildRingOutboxView(repo: Repository): Promise<RingOutboxView> {
  const entries = await repo.listRingOutboxEntries();
  // Cache read-state per thread — many rings can target the same thread.
  const readByThread = new Map<string, Map<string, string>>();
  const cards: RingOutboxCardView[] = [];

  for (const e of entries) {
    const threadKey = String(e.threadId);
    let reads = readByThread.get(threadKey);
    if (!reads) {
      reads = await repo.readStateForThread(e.threadId);
      readByThread.set(threadKey, reads);
    }
    const lastRead = reads.get(subjectKey({ kind: "crew", id: String(e.crewMemberId) }));
    // Drop-on-read (DEC-073): once read at/after enqueue, the ring is moot. ISO-8601
    // UTC strings compare lexicographically — same instant order as a parse.
    if (lastRead !== undefined && lastRead >= e.createdAt) continue;

    const crew = await repo.getCrewMember(e.crewMemberId);
    cards.push({
      entryId: String(e.id),
      crewMemberId: String(e.crewMemberId),
      crewName: crew?.name ?? String(e.crewMemberId),
      crewPhone: crew?.phone ?? "",
      threadId: threadKey,
      body: e.body,
      link: e.link,
      status: e.status,
      createdAt: e.createdAt,
      sentAt: e.sentAt ?? null,
    });
  }

  cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.entryId.localeCompare(b.entryId));
  return {
    pending: cards.filter((c) => c.status === "pending"),
    sent: cards.filter((c) => c.status === "sent"),
  };
}
