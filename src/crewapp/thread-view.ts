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
import type { Message, Thread } from "../messaging/entities.js";
import type { Repository } from "../ports/repository.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import {
  operatorStandingTarget,
  senderLabel,
  threadMembership,
  threadTitle,
} from "./thread-list.js";

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
  /**
   * May the viewer post here? A **crew** member always can in a thread they're in
   * (DEC-071). The **operator** can post ONLY to the two broadcast doors — all-staff
   * and today's cohort (§10 / #118 AC); every other thread they can *see* (shift
   * threads, crew DMs) is read-only, so the office never injects into a private DM.
   */
  canPost: boolean;
}

/** Shape stored messages into the view DTO, deciding "mine" per the viewer's lens
 *  (the only thing that differs between the crew and operator branches). */
async function shapeMessages(
  repo: Repository,
  messages: Message[],
  isMine: (m: Message) => boolean,
): Promise<ThreadMessageView[]> {
  const out: ThreadMessageView[] = [];
  for (const m of messages) {
    out.push({
      id: String(m.id),
      senderLabel: await senderLabel(repo, m),
      body: m.body,
      createdAt: m.createdAt,
      mine: isMine(m),
      priority: m.priority,
    });
  }
  return out;
}

/**
 * Build one thread's view for `viewer`, or null when they may not read it. ONE
 * authorization site (DEC-071/072): a **crew** viewer must be a member (the
 * date-agnostic `threadMembership`, matching the doorbell's ring); the **operator**
 * (admin) reads ANY thread (DEC-052 cross-visibility) — a real row, or a synth of
 * the two post-targets (all-staff / today-cohort) so an unposted broadcast is still
 * openable. "Mine" is per-lens: for the operator, every `admin` message is the
 * office's one voice (DEC-058/030), not keyed on the non-identity handle.
 */
export async function buildThreadView(
  repo: Repository,
  threadId: ThreadId,
  viewer: Subject,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<ThreadView | null> {
  let thread: Thread;
  let title: string;
  let canPost: boolean;
  if (viewer.kind === "crew") {
    const match = await threadMembership(repo, threadId, asId<"CrewMemberId">(viewer.id), tenantId, now, tz);
    if (!match) return null;
    thread = match.thread;
    title = match.title;
    canPost = true; // a member may post in their own thread (DEC-071)
  } else {
    // Operator (admin) reads all (DEC-052 / DEC-072) but posts only to the two
    // broadcast doors — every other thread (incl. crew DMs) is read-only.
    const resolved = (await repo.getThread(threadId)) ?? operatorStandingTarget(threadId, tenantId, now, tz);
    if (!resolved) return null;
    thread = resolved;
    title = await threadTitle(repo, thread, null, now, tz);
    canPost = operatorStandingTarget(threadId, tenantId, now, tz) !== null;
  }

  const isMine = (m: Message): boolean =>
    viewer.kind === "admin"
      ? m.senderKind === "admin"
      : m.senderKind === viewer.kind && m.senderId === viewer.id;
  const messages = await shapeMessages(repo, await repo.listMessagesForThread(threadId), isMine);

  return {
    threadId: String(threadId),
    kind: thread.kind,
    title,
    messages,
    canPost,
  };
}
