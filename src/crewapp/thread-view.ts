/**
 * Crew messaging — one thread's view (#117, artifact §10, DEC-071).
 *
 * Messages + the sender labels a compose box posts into. Authorization is the
 * **DEC-052 predicate**, written so 6.8's operator cross-visibility ORs in without
 * a rewrite: a crew member may read a thread iff they're a *member* (one of
 * `myThreads`) — distinct from the doorbell's membership-only *attention* line
 * (who gets rung, DEC-058). The operator branch (read any thread, incl. DMs
 * they're not in) is unreachable here — no operator routes until 6.8 — so this
 * enforces only the crew-member half today, NOT a crew-only `isMember` gate that
 * 6.8 would have to widen.
 *
 * No `Thread` row need exist: a standing thread you've never posted to has no row
 * yet, so membership comes from `myThreads` (derived from the schedule) and
 * `listMessagesForThread` returns `[]` — an empty, composable thread. The row is
 * find-or-created by the compose action on first post. Framework-free + data-only
 * (DEC-020); the surface formats time and renders.
 */

import type { Subject } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, TenantId, ThreadId } from "../domain/ids.js";
import type { Thread } from "../messaging/entities.js";
import type { Repository } from "../ports/repository.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import { myThreads, senderLabel } from "./thread-list.js";

export interface ThreadMessageView {
  id: string;
  senderLabel: string;
  body: string;
  /** ISO-8601 UTC; the surface formats. */
  createdAt: string;
  /** Authored by the viewer — the surface aligns it / labels it "you". */
  mine: boolean;
  /** §7.4 priority — a subtle marker; crew compose never sets it (operator-only, 6.8). */
  priority: boolean;
}

export interface ThreadView {
  threadId: string;
  kind: Thread["kind"];
  title: string;
  messages: ThreadMessageView[];
}

/**
 * Build one thread's view for `viewer`, or null when they may not read it (not a
 * member — or not crew, the 6.8 operator seam). `now` feeds the same `myThreads`
 * membership the list uses, so the authorization and the title stay in one place.
 */
export async function buildThreadView(
  repo: Repository,
  threadId: ThreadId,
  viewer: Subject,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<ThreadView | null> {
  // DEC-052 predicate. 6.8 ORs in `|| operatorCanRead(threadId)` for viewer.kind
  // === "admin"; until then only the crew-member branch is reachable.
  if (viewer.kind !== "crew") return null;
  const mine = await myThreads(repo, asId<"CrewMemberId">(viewer.id), tenantId, now, tz);
  const match = mine.find((t) => String(t.thread.id) === String(threadId));
  if (!match) return null;

  const messages = await repo.listMessagesForThread(threadId);
  const views: ThreadMessageView[] = [];
  for (const m of messages) {
    views.push({
      id: String(m.id),
      senderLabel: await senderLabel(repo, m),
      body: m.body,
      createdAt: m.createdAt,
      mine: m.senderKind === viewer.kind && m.senderId === viewer.id,
      priority: m.priority,
    });
  }

  return {
    threadId: String(threadId),
    kind: match.thread.kind,
    title: match.title,
    messages: views,
  };
}
