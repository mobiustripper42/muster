/**
 * Crew messaging — the thread list + the shared "which threads are mine" assembly
 * (#117, artifact §10, DEC-071).
 *
 * Threads aren't joined; they exist by rule (DEC-051), so "my threads" is "which
 * rules apply to me now": **all-staff** always, **today's cohort** when I'm
 * crewing today, **each upcoming shift** I hold, and **my DMs**. The three standing
 * kinds have a deterministic id (`standingThreadId`) computed from my seats + today
 * — no `Thread` row need exist yet (an unposted thread is a place to post; the row
 * is find-or-created on first message). DMs are the one kind with no derivable
 * membership, so they come from the participant index (`listDmThreadsForCrew`),
 * NOT a scan of the doorbell's all-thread sweep (DEC-070/071).
 *
 * Framework-free + data-only (DEC-020): the surface formats; `tenantId`/`now`/`tz`
 * are injected so the same view drives the test double and Postgres alike. Unread
 * is computed from raw read + message state (the doorbell *decision* is a delivery
 * output, never a UI read-model — DEC-068/071); the count mirrors the decider's
 * own unread rule (not mine, not yet read), failing toward *showing* a badge.
 */

import type { Subject } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, TenantId, ThreadId } from "../domain/ids.js";
import { subjectKey } from "../domain/subject.js";
import { standingThreadId, type Message, type Thread } from "../messaging/entities.js";
import { isIsoDate } from "../domain/iso-date.js";
import { deriveMembers } from "../messaging/membership.js";
import type { Repository } from "../ports/repository.js";
import { TENANT_TIMEZONE, vesselDateOf } from "../config/tenant.js";

/**
 * A thread the viewer belongs to — the real `Thread` (DMs, persisted) or a
 * synthesized one for a standing kind whose row may not exist yet. `title` is the
 * surface-ready label; both the list and the thread view render it.
 */
export interface MyThread {
  thread: Thread;
  title: string;
}

/** One row in the crew thread list. */
export interface ThreadListItem {
  threadId: string;
  kind: Thread["kind"];
  title: string;
  unread: number;
  /** Last message's body + author label + ISO time — the preview line. Absent on
   *  a thread with no messages yet (a standing thread you can post to). */
  preview?: { body: string; senderLabel: string; createdAt: string };
}

export interface ThreadListView {
  threads: ThreadListItem[];
  /** Sum of unread across all listed threads — the home badge (§7.6 in-app). */
  totalUnread: number;
}

/** A message counts as unread for `viewer` iff not authored by them and not yet
 *  read — the decider's own rule (`doorbell-decider.ts`), failing toward unread:
 *  an absent/unparseable read mark or a corrupt timestamp shows the badge. */
function isUnread(m: Message, viewer: Subject, lastReadMs: number | null): boolean {
  if (m.senderKind === viewer.kind && m.senderId === viewer.id) return false;
  if (lastReadMs === null) return true;
  const t = Date.parse(m.createdAt);
  return Number.isNaN(t) || t > lastReadMs;
}

export function countUnread(
  messages: Message[],
  viewer: Subject,
  lastReadIso: string | undefined,
): number {
  const parsed = lastReadIso === undefined ? null : Date.parse(lastReadIso);
  const lastReadMs = parsed === null || Number.isNaN(parsed) ? null : parsed;
  return messages.filter((m) => isUnread(m, viewer, lastReadMs)).length;
}

/** Resolve a thread's last-read mark for one subject (absent → undefined). */
export async function lastReadFor(
  repo: Repository,
  threadId: ThreadId,
  viewer: Subject,
): Promise<string | undefined> {
  const reads = await repo.readStateForThread(threadId);
  return reads.get(subjectKey(viewer));
}

async function vesselNameForShift(repo: Repository, shiftId: string): Promise<string> {
  const shift = await repo.getShift(shiftId as Parameters<Repository["getShift"]>[0]);
  if (!shift) return shiftId;
  const v = await repo.getVessel(shift.vesselId);
  return v?.name ?? String(shift.vesselId);
}

/** "Sat, Jun 28" — a thread-title date, UTC-formatted so the stored vessel-local
 *  calendar day shows verbatim regardless of server zone (DEC-032). */
function fmtDay(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The threads a crew member belongs to + may read/post (DEC-071) — the shared
 * authorization + assembly the list and the thread view both read. Order is
 * structured (all-staff, today's cohort, upcoming shifts soonest-first, DMs
 * alphabetical), not recency — refresh-to-see + the unread badge carry attention;
 * recency-sort is a parked polish, not v1.
 */
export async function myThreads(
  repo: Repository,
  crewMemberId: CrewMemberId,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<MyThread[]> {
  const today = vesselDateOf(now, tz);
  const nowIso = now.toISOString();
  const synth = (kind: "all_staff" | "cohort" | "shift", scope: string | null): Thread => ({
    id: standingThreadId(kind, tenantId, scope),
    tenantId,
    kind,
    scopeRef: scope,
    createdAt: nowIso,
  });

  const out: MyThread[] = [];

  // All-staff — always mine (I'm on the roster).
  out.push({ thread: synth("all_staff", null), title: "All staff" });

  // My upcoming shifts (Confirmed or Claimed, today-or-later) → one shift thread
  // each, and today's cohort thread iff I'm crewing today.
  const held = (await repo.listAllSeats()).filter(
    (s) =>
      (s.state === "Confirmed" || s.state === "Claimed") &&
      String(s.assignedCrewMemberId ?? "") === String(crewMemberId),
  );
  const myShifts = [];
  for (const seat of held) {
    const shift = await repo.getShift(seat.shiftId);
    if (!shift || shift.date < today) continue;
    myShifts.push(shift);
  }
  myShifts.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));

  if (myShifts.some((s) => s.date === today)) {
    out.push({ thread: synth("cohort", today), title: `Today’s crew · ${fmtDay(today)}` });
  }
  for (const shift of myShifts) {
    out.push({
      thread: synth("shift", String(shift.id)),
      title: `${await vesselNameForShift(repo, String(shift.id))} · ${fmtDay(shift.date)}`,
    });
  }

  // My DMs — the participant index, titled by the other person.
  const dms = await repo.listDmThreadsForCrew(crewMemberId);
  const named: MyThread[] = [];
  for (const dm of dms) {
    const parts = await repo.listParticipantsForThread(dm.id);
    const otherId = parts.map((p) => String(p.crewMemberId)).find((id) => id !== String(crewMemberId));
    const other = otherId
      ? await repo.getCrewMember(otherId as CrewMemberId)
      : null;
    named.push({ thread: dm, title: other?.name ?? otherId ?? "Direct message" });
  }
  named.sort((a, b) => a.title.localeCompare(b.title));
  out.push(...named);

  return out;
}

/** A thread's surface label, computed from the `Thread` alone (any date) — the one
 *  the thread view renders. Matches the inline labels `myThreads` builds for the
 *  list, so a thread reads the same in both places. */
export async function threadTitle(
  repo: Repository,
  thread: Thread,
  viewerCrewId: CrewMemberId | null,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<string> {
  switch (thread.kind) {
    case "all_staff":
      return "All staff";
    case "cohort": {
      const day = thread.scopeRef ?? "";
      const label = day === vesselDateOf(now, tz) ? "Today’s crew" : "Crew";
      return `${label} · ${fmtDay(day)}`;
    }
    case "shift": {
      const sh = thread.scopeRef ? await repo.getShift(asId<"ShiftId">(thread.scopeRef)) : null;
      const vessel = sh ? (await repo.getVessel(sh.vesselId))?.name ?? String(sh.vesselId) : "";
      return `${vessel} · ${fmtDay(sh?.date ?? thread.scopeRef ?? "")}`;
    }
    case "dm": {
      const parts = await repo.listParticipantsForThread(thread.id);
      // Operator view (viewerCrewId === null, DEC-072): no "other" — name both sides.
      if (viewerCrewId === null) {
        const names: string[] = [];
        for (const p of parts) {
          const c = await repo.getCrewMember(p.crewMemberId);
          names.push(c?.name ?? String(p.crewMemberId));
        }
        names.sort();
        return names.join(" ↔ ") || "Direct message";
      }
      const otherId = parts
        .map((p) => String(p.crewMemberId))
        .find((id) => id !== String(viewerCrewId));
      const other = otherId ? await repo.getCrewMember(asId<"CrewMemberId">(otherId)) : null;
      return other?.name ?? otherId ?? "Direct message";
    }
  }
}

/**
 * The two threads the operator can ORIGINATE (artifact §9/§10, DEC-072): the
 * all-staff broadcast and TODAY's cohort. Synthesized with deterministic ids
 * (`standingThreadId`) so an unposted one is still a post target; a real row, once
 * posted, supersedes the synth (the list + find-or-create dedup on id). Future-day
 * cohorts are deferred (they interact with ring-on-future-membership — DEC-072).
 */
export function operatorPostTargets(
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Thread[] {
  const nowIso = now.toISOString();
  const today = vesselDateOf(now, tz);
  return [
    { id: standingThreadId("all_staff", tenantId, null), tenantId, kind: "all_staff", scopeRef: null, createdAt: nowIso },
    { id: standingThreadId("cohort", tenantId, today), tenantId, kind: "cohort", scopeRef: today, createdAt: nowIso },
  ];
}

/** The synthesized `Thread` if `threadId` is one of the operator's post-targets,
 *  else null — lets the operator open/post an all-staff/cohort with no row yet. */
export function operatorStandingTarget(
  threadId: ThreadId,
  tenantId: TenantId,
  now: Date,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the 4-arg
  // callers (tz no longer needed now that the target isn't date-derived).
  _tz: string = TENANT_TIMEZONE,
): Thread | null {
  const s = String(threadId);
  const createdAt = now.toISOString();
  // The two standing DOORS the operator's thread list surfaces are today-only
  // (all-staff + today's cohort — `operatorPostTargets`). But the operator may ALSO
  // post to ANY day's cohort (#317): the Cohort button on a shift deep-links here for
  // that shift's date. No "today" restriction — the doorbell rings a cohort's crew with
  // no date filter (a future-day post is advance notice; it surfaces in the crew thread
  // list on the day, and the ring links them in meanwhile).
  if (s === String(standingThreadId("all_staff", tenantId, null))) {
    return { id: threadId, tenantId, kind: "all_staff", scopeRef: null, createdAt };
  }
  // A cohort thread id ends in its day (`…-YYYY-MM-DD`); take the trailing 10 chars and
  // reconstruct to confirm (robust to a tenant id that itself contains dashes).
  const date = s.slice(-10);
  if (isIsoDate(date) && s === String(standingThreadId("cohort", tenantId, date))) {
    return { id: threadId, tenantId, kind: "cohort", scopeRef: date, createdAt };
  }
  return null;
}

/** Is the crew member a member of `thread` — the SAME `deriveMembers` the doorbell
 *  rings on (DEC-058), with NO date filter. Authorization must match attention: a
 *  thread that can ring a member must open for them, even a past-day one rung at the
 *  midnight rollover. */
async function isMemberOf(
  repo: Repository,
  thread: Thread,
  crewId: CrewMemberId,
): Promise<boolean> {
  if (thread.kind === "dm") {
    const participants = await repo.listParticipantsForThread(thread.id);
    return deriveMembers(thread, { shifts: [], seats: [], roster: [], participants }).some(
      (id) => String(id) === String(crewId),
    );
  }
  const [shifts, seats, roster] = await Promise.all([
    repo.listShifts(),
    repo.listAllSeats(),
    repo.listCrewMembers(),
  ]);
  return deriveMembers(thread, { shifts, seats, roster, participants: [] }).some(
    (id) => String(id) === String(crewId),
  );
}

/**
 * The viewing/posting authorization for ONE thread (DEC-071) — date-agnostic, so it
 * never refuses a thread the doorbell would ring (the rung-but-can't-read trap at
 * the vessel-day boundary). A persisted thread authorizes via `deriveMembers` (the
 * ring's own predicate) and returns the REAL row (so its `createdAt` is preserved on
 * a re-save). A thread with no row yet was never rung (no messages → no ring), so
 * it's reachable only as an empty standing thread from the viewer's own list —
 * `myThreads` (date-filtered) is the right resolver there. Returns null when the
 * viewer may not read it.
 */
export async function threadMembership(
  repo: Repository,
  threadId: ThreadId,
  viewerCrewId: CrewMemberId,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<MyThread | null> {
  const existing = await repo.getThread(threadId);
  if (existing) {
    if (!(await isMemberOf(repo, existing, viewerCrewId))) return null;
    return { thread: existing, title: await threadTitle(repo, existing, viewerCrewId, now, tz) };
  }
  const mine = await myThreads(repo, viewerCrewId, tenantId, now, tz);
  return mine.find((t) => String(t.thread.id) === String(threadId)) ?? null;
}

/** Operator/office sender → a stable label; crew senders resolve to their name. */
export async function senderLabel(repo: Repository, m: Message): Promise<string> {
  if (m.senderKind === "admin") return "Operator";
  const c = await repo.getCrewMember(m.senderId as CrewMemberId);
  return c?.name ?? m.senderId;
}

/**
 * Build the crew thread list (#117, §10). Standing threads always list (a place to
 * post); empty DMs are hidden (you reach a fresh DM directly from the shift card,
 * and it lists once it carries a message). `now` bounds "upcoming"/"today".
 */
export async function buildThreadList(
  repo: Repository,
  crewMemberId: CrewMemberId,
  tenantId: TenantId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<ThreadListView> {
  const viewer: Subject = { kind: "crew", id: String(crewMemberId) };
  const mine = await myThreads(repo, crewMemberId, tenantId, now, tz);

  const threads: ThreadListItem[] = [];
  for (const { thread, title } of mine) {
    const [messages, lastRead] = await Promise.all([
      repo.listMessagesForThread(thread.id),
      lastReadFor(repo, thread.id, viewer),
    ]);
    // Hide an empty DM (no place-to-post value, unlike a standing thread).
    if (thread.kind === "dm" && messages.length === 0) continue;
    const unread = countUnread(messages, viewer, lastRead);
    const last = messages[messages.length - 1];
    threads.push({
      threadId: String(thread.id),
      kind: thread.kind,
      title,
      unread,
      ...(last
        ? {
            preview: {
              body: last.body,
              senderLabel: await senderLabel(repo, last),
              createdAt: last.createdAt,
            },
          }
        : {}),
    });
  }

  return { threads, totalUnread: threads.reduce((n, t) => n + t.unread, 0) };
}
