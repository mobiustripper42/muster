/**
 * Operator messaging — the cross-visibility thread list (#118, artifact §10,
 * DEC-072). The operator's read side of messaging: every thread, plus the two it
 * can originate. A pull surface (DEC-042 ethos) — no unread badge; the operator
 * isn't a doorbell recipient (DEC-072), they watch the board.
 *
 * Enumeration = the operator's post-targets (all-staff + today's cohort, synth)
 * UNION `listThreadsWithMessages()` (the all-subject sweep, DEC-070 — every real
 * thread incl. shift threads, DMs, past cohorts). Deduped by id, the real row
 * preferred over a synth (its `createdAt` is true). Framework-free + data-only
 * (DEC-020); the surface formats.
 */

import { TENANT_TIMEZONE } from "../config/tenant.js";
import type { TenantId } from "../domain/ids.js";
import {
  operatorPostTargets,
  senderLabel,
  threadTitle,
} from "../crewapp/thread-list.js";
import type { Thread } from "../messaging/entities.js";
import type { Repository } from "../ports/repository.js";

export interface OperatorThreadItem {
  threadId: string;
  kind: Thread["kind"];
  title: string;
  /** Last message body + author label + ISO time; absent on an unposted target. */
  preview?: { body: string; senderLabel: string; createdAt: string };
}

export interface OperatorThreadsView {
  threads: OperatorThreadItem[];
}

/**
 * Build the operator thread list. Post-targets pinned first (all-staff, today's
 * cohort — the operator's broadcast doors); the rest by recency (most-recent
 * message first), so live conversations surface. `now` bounds "today".
 */
export async function buildOperatorThreads(
  repo: Repository,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<OperatorThreadsView> {
  const targets = operatorPostTargets(tenantId, now, tz);
  const targetIds = new Set(targets.map((t) => String(t.id)));

  // Dedup: synth targets first, then real rows overwrite (real createdAt wins).
  const byId = new Map<string, Thread>();
  for (const t of targets) byId.set(String(t.id), t);
  for (const t of await repo.listThreadsWithMessages()) byId.set(String(t.id), t);

  const item = async (thread: Thread): Promise<OperatorThreadItem & { sortKey: string }> => {
    const messages = await repo.listMessagesForThread(thread.id);
    const last = messages[messages.length - 1];
    return {
      threadId: String(thread.id),
      kind: thread.kind,
      title: await threadTitle(repo, thread, null, now, tz),
      ...(last
        ? { preview: { body: last.body, senderLabel: await senderLabel(repo, last), createdAt: last.createdAt } }
        : {}),
      sortKey: last?.createdAt ?? "",
    };
  };

  // Post-targets pinned (real row if posted, else synth), then the rest by recency.
  const pinned: OperatorThreadItem[] = [];
  for (const t of targets) pinned.push(strip(await item(byId.get(String(t.id))!)));

  const rest = [...byId.values()].filter((t) => !targetIds.has(String(t.id)));
  const restItems: Array<OperatorThreadItem & { sortKey: string }> = [];
  for (const t of rest) restItems.push(await item(t));
  restItems.sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.threadId.localeCompare(b.threadId));

  return { threads: [...pinned, ...restItems.map(strip)] };
}

/** Drop the internal sort key from the public item. */
function strip(it: OperatorThreadItem & { sortKey: string }): OperatorThreadItem {
  const { sortKey: _sortKey, ...rest } = it;
  return rest;
}
