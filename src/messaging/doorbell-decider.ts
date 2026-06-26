/**
 * The Smart Doorbell decider (#114, Phase 6.4) — the pure function that decides
 * who's phone rings, when, and how. DEC-048 / DEC-068, artifact §7.
 *
 * Pure core (DEC-020/048): over injected `(pendingMessages, threadMembers,
 * presence, readState, notifyState, rules, now)` → `NotificationDecision[]`. NO
 * I/O, NO send, NO connection, injected `now` — the same shape as the oracle and
 * refund engine. Delivery (the SMS / toast) and presence *capture* live at the
 * edge behind ports; this only decides.
 *
 * **The six rules (artifact §7), per `(thread × member)`, sender dropped:**
 *   1. Presence-suppression — present-in-thread sees it live, no ring (§7.1).
 *   2. In-app toast — present-but-elsewhere gets a badge, not an SMS (§7.6).
 *   3. First-only-until-read — ring once per thread until they read (§7.3).
 *   4. Batch / cancel window — hold a flurry into one ping; reading inside the
 *      window cancels it (§7.2).
 *   5. Priority jump — an operator-flagged message rings through now (§7.4).
 *   6. Short-notice-as-text — a lone short note carries its body inline (§7.5).
 *
 * **Presence is a three-state verdict produced AT THE EDGE (DEC-068).** The
 * decider never classifies a timestamp — it reads `present_here |
 * present_elsewhere | absent` per `(subject, thread)`. v1's edge, fed only the
 * coarse global `lastActiveFor` signal + window (DEC-047/060), can only ever emit
 * `present_elsewhere | absent` → the v1 observable is "present-anywhere → toast,
 * absent → SMS." A later per-thread realtime adapter emits `present_here` for the
 * focused thread and the strongest suppression turns on with **zero change here** —
 * the promise DEC-047 makes and DEC-068 keeps.
 *
 * **Present-tense only (DEC-049).** A decision is ring-now / hold / toast /
 * suppress as of `now` — never a scheduled future send-time. The batch/cancel
 * window is realized by the doorbell *tick* (6.6) re-running this each sweep: a
 * still-batching thread is `ring:false, reason:"within_batch_window"` and a later
 * sweep flips it once the window elapses. The decider holds no timers.
 *
 * **Inject-don't-persist (DEC-048/059).** `readState`, `notifyState`, and a
 * message's `priority` arrive as injected inputs; their *storage* (a
 * `message_reads` table, a `messages.priority` source) is 6.6 wiring — so **no
 * migration ships with 6.4**. Priority rides the `PendingMessage` DTO field, so
 * 6.6's future column flows into the same field with no change here. The decider
 * never writes — the tick records "rang" back into `notifyState`.
 *
 * **Rings on membership, never on visibility (DEC-058/052).** The only recipient
 * set the decider sees is `threadMembers` (the edge fills it from `deriveMembers`,
 * never a DEC-052 operator-readers set), so it *structurally cannot* ring someone
 * who can merely read a thread — the anxiety-dashboard guard, enforced by the seam.
 */

import type { CrewMemberId, MessageId, ThreadId } from "../domain/ids.js";
import type { Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { MessageSenderKind } from "./entities.js";

// ───────────────────────── inputs ─────────────────────────

/**
 * Presence per `(subject, thread)`, classified at the edge (DEC-068). Never
 * derived inside the decider — `here` vs `elsewhere` is socket knowledge, not
 * recoverable from a global last-active timestamp. Absent from the map → read as
 * `"absent"` (fail toward ringing).
 */
export type PresenceState = "present_here" | "present_elsewhere" | "absent";

/**
 * What the decider consumes for one pending message. A DTO, not the stored
 * `Message` (which has no `priority` — §7.4): the edge builds this from a `Message`
 * plus its priority source (6.6). `priority` here is the field 6.6's column flows
 * into unchanged.
 */
export interface PendingMessage {
  id: MessageId;
  threadId: ThreadId;
  /** Subject ref of the author — dropped from its own recipients (§7.1 swarm-fear). */
  senderId: string;
  senderKind: MessageSenderKind;
  body: string;
  /** ISO-8601 UTC; the age the batch window measures against `now`. */
  createdAt: string;
  /** §7.4 — operator-flagged or type-derived; bypasses batch + first-only-until-read. */
  priority: boolean;
}

/**
 * The tune-later numbers (operator tenant-config — DEC-046), built once via
 * {@link makeDoorbellRules} so the DEC-060 cross-field invariant is checked at
 * startup. `presenceWindowMs` is the **edge's** classification param (and the
 * invariant's other half); the pure branching here reads only `batchWindowMs` +
 * `shortNoticeMaxChars` — presence arrives pre-classified (DEC-068), so the window
 * is intentionally not consulted in `decideNotifications`.
 */
export interface DoorbellRules {
  /** DEC-060 `DOORBELL_BATCH_WINDOW_MS` (90s) — hold-before-ring / cancel window (§7.2). */
  batchWindowMs: number;
  /** DEC-060 `DOORBELL_PRESENCE_WINDOW_MS` (5min) — edge presence-staleness; must exceed `batchWindowMs`. */
  presenceWindowMs: number;
  /** §7.5 — at/under this body length a lone unread carries its text inline. */
  shortNoticeMaxChars: number;
}

export interface DoorbellInput {
  /** Undelivered messages across all threads; filtered per thread internally. */
  pendingMessages: PendingMessage[];
  /** The edge's `deriveMembers` output per thread — members, NEVER readers (DEC-058/052). */
  threadMembers: Map<ThreadId, CrewMemberId[]>;
  /** Per `(subject, thread)` presence verdict, keyed by {@link memberThreadKey}. */
  presence: Map<string, PresenceState>;
  /** Last-read-at ISO per `(subject, thread)`, keyed by {@link memberThreadKey}. */
  readState: Map<string, string>;
  /** Last-rang-at ISO per `(subject, thread)`, keyed by {@link memberThreadKey}. */
  notifyState: Map<string, string>;
  rules: DoorbellRules;
  /** ISO-8601 UTC — the instant this sweep decides as of. */
  now: string;
}

// ───────────────────────── output ─────────────────────────

export type DoorbellChannel = "sms" | "in_app_toast" | "none";

/** How a ringing SMS reads — the whole note inline (§7.5) or an "N new" summary (§7.2). */
export type DoorbellMode = "summary" | "content";

/** Structured reason code (DEC-002 — a payload, not a sentence); the 6.5 harness + tests assert on it. */
export type DoorbellReason =
  | "all_read" // nothing unread (read everything, or only authored it) — cancel-on-read lands here
  | "present_suppressed" // present_here → sees it live, no ring (§7.1)
  | "present_toast" // present_elsewhere → in-app toast, no SMS (§7.6)
  | "already_notified" // rang since last read, no new priority → hold (§7.3)
  | "within_batch_window" // unread but the flurry is still grouping → hold (§7.2)
  | "batched" // oldest unread aged past the window → ring, grouped (§7.2)
  | "priority_bypass"; // a new priority rings through now (§7.4)

export interface NotificationDecision {
  /** Who (DEC-058 canonical identity); in v1 every member is `kind:"crew"`. */
  subject: Subject;
  threadId: ThreadId;
  channel: DoorbellChannel;
  /** True only for an outgoing SMS this sweep; a toast is `false` (it isn't a phone ring). */
  ring: boolean;
  /** `"summary" | "content"` when an SMS rings; `null` otherwise. */
  mode: DoorbellMode | null;
  reason: DoorbellReason;
  /** Unread count for this subject in this thread — the "N new" number, present on holds/toasts too. */
  messageCount: number;
  /** The unread messages this decision covers; `content` inlines the single one. */
  messageIds: MessageId[];
}

// ───────────────────────── helpers ─────────────────────────

/**
 * The Map key for per-`(subject, thread)` presence / read / notify state. The edge
 * and the 6.5 harness build the same key to populate the maps.
 */
export function memberThreadKey(threadId: ThreadId, subject: Subject): string {
  return `${threadId}|${subjectKey(subject)}`;
}

/**
 * Validate + freeze the tune-later windows at startup — the 6.3 → 6.4 handoff
 * (DEC-060): `envMs` checks each value alone, so the cross-field invariant
 * `presenceWindowMs > batchWindowMs` (a too-short presence window would text
 * someone reading a thread the coarse signal can't see) is enforced here, the one
 * place that sees both. `decideNotifications` trusts the returned rules.
 */
export function makeDoorbellRules(rules: DoorbellRules): DoorbellRules {
  // Each window positive + finite first — `envMs` guards the env path, but a direct
  // construction with a negative batch window would otherwise make every thread ring
  // instantly (nowMs - oldest >= -5). This is the one place that sees both, so it
  // validates both absolutely, not just the relative invariant.
  for (const [name, ms] of [
    ["batchWindowMs", rules.batchWindowMs],
    ["presenceWindowMs", rules.presenceWindowMs],
  ] as const) {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(`Doorbell ${name} must be a positive, finite number of ms (got ${ms})`);
    }
  }
  if (!(rules.presenceWindowMs > rules.batchWindowMs)) {
    throw new Error(
      `Doorbell window invariant (DEC-060): presenceWindowMs (${rules.presenceWindowMs}ms) must exceed batchWindowMs (${rules.batchWindowMs}ms)`,
    );
  }
  if (!Number.isFinite(rules.shortNoticeMaxChars) || rules.shortNoticeMaxChars < 0) {
    throw new Error(
      `Doorbell shortNoticeMaxChars must be a non-negative, finite number (got ${rules.shortNoticeMaxChars})`,
    );
  }
  return rules;
}

// ───────────────────────── the decider ─────────────────────────

/**
 * Decide notifications for every `(thread, member)` as of `now`. A **total**
 * function — one decision per member per thread, suppressions and holds emitted as
 * `ring:false` rows (not omitted) so the 6.5 harness reads who-rings-vs-silent
 * directly. The tick (6.6) acts on `ring:true`.
 */
export function decideNotifications(input: DoorbellInput): NotificationDecision[] {
  const { pendingMessages, threadMembers, presence, readState, notifyState, rules, now } =
    input;
  const nowMs = Date.parse(now);
  const decisions: NotificationDecision[] = [];

  for (const [threadId, memberIds] of threadMembers) {
    const threadMsgs = pendingMessages.filter((m) => m.threadId === threadId);
    const seen = new Set<string>();

    for (const memberId of memberIds) {
      const id = String(memberId);
      if (seen.has(id)) continue; // never ring the same subject twice for one thread
      seen.add(id);

      const subject: Subject = { kind: "crew", id };
      const key = memberThreadKey(threadId, subject);
      const lastReadMs = parseOrNull(readState.get(key));
      const lastNotifiedMs = parseOrNull(notifyState.get(key));
      const state: PresenceState = presence.get(key) ?? "absent";

      const unread = threadMsgs
        .filter((m) => !authoredBy(m, subject))
        .filter((m) => !isReadBy(m, lastReadMs))
        .sort((a, b) => ageKey(a) - ageKey(b));

      const base = {
        subject,
        threadId,
        messageCount: unread.length,
        messageIds: unread.map((m) => m.id),
      } as const;

      // 1. Caught up — read everything, or only own messages here. Cancel-on-read lands here too.
      if (unread.length === 0) {
        decisions.push(hold(base, "none", "all_read"));
        continue;
      }

      // 2. Presence (DEC-068). v1's edge only ever produces elsewhere|absent; here is future-realtime.
      if (state === "present_here") {
        decisions.push(hold(base, "none", "present_suppressed"));
        continue;
      }
      if (state === "present_elsewhere") {
        decisions.push(hold(base, "in_app_toast", "present_toast"));
        continue;
      }

      // 3. Absent → SMS-eligible.

      // 3a. Priority jump (§7.4) — a priority that arrived AFTER our last ring rings through now,
      //     bypassing both the batch window and first-only-until-read. One we already rang doesn't.
      // `!(t <= lastNotified)` not `t > lastNotified` so an unparseable stamp (NaN)
      // counts as a NEW priority → rings (fail toward ringing), never silently skipped.
      const hasNewPriority = unread.some(
        (m) => m.priority && (lastNotifiedMs === null || !(Date.parse(m.createdAt) <= lastNotifiedMs)),
      );
      if (hasNewPriority) {
        decisions.push(sms(base, unread, rules, "priority_bypass"));
        continue;
      }

      // 3b. First-only-until-read (§7.3) — rang since they last read, no new priority → don't nag.
      //     Strict `>` so the exact ring==read tie re-arms (fail toward ringing, §7.3 boundary).
      const notifiedSinceRead =
        lastNotifiedMs !== null && (lastReadMs === null || lastNotifiedMs > lastReadMs);
      if (notifiedSinceRead) {
        decisions.push(hold(base, "none", "already_notified"));
        continue;
      }

      // 3c. Batch / cancel window (§7.2) — ring once the oldest unread has aged past the window.
      //     `ageKey` maps an unparseable stamp to -∞ → "infinitely old" → rings, never held.
      const oldestMs = Math.min(...unread.map(ageKey));
      if (nowMs - oldestMs >= rules.batchWindowMs) {
        decisions.push(sms(base, unread, rules, "batched"));
      } else {
        decisions.push(hold(base, "none", "within_batch_window"));
      }
    }
  }

  return decisions;
}

// ───────────────────────── decision builders ─────────────────────────

type DecisionBase = Pick<
  NotificationDecision,
  "subject" | "threadId" | "messageCount" | "messageIds"
>;

function hold(
  base: DecisionBase,
  channel: Exclude<DoorbellChannel, "sms">,
  reason: DoorbellReason,
): NotificationDecision {
  return { ...base, channel, ring: false, mode: null, reason };
}

/** §7.5 — a lone short unread carries its body inline; a flurry (or a long note) summarizes. */
function sms(
  base: DecisionBase,
  unread: PendingMessage[],
  rules: DoorbellRules,
  reason: "batched" | "priority_bypass",
): NotificationDecision {
  const [only] = unread;
  const carryContent =
    unread.length === 1 && only !== undefined && only.body.length <= rules.shortNoticeMaxChars;
  return { ...base, channel: "sms", ring: true, mode: carryContent ? "content" : "summary", reason };
}

function authoredBy(m: PendingMessage, subject: Subject): boolean {
  return m.senderKind === subject.kind && m.senderId === subject.id;
}

/**
 * Read-state, fail-toward-ringing: a message counts as read only with a *parseable*
 * stamp at or under the last-read mark. An absent mark (`null`) or an unparseable
 * `createdAt` (NaN) is not *provably* read → the message stays unread. The module's
 * one direction (header / §7.1): corruption rings, it never silently drops.
 */
function isReadBy(m: PendingMessage, lastReadMs: number | null): boolean {
  if (lastReadMs === null) return false;
  const t = Date.parse(m.createdAt);
  return !Number.isNaN(t) && t <= lastReadMs;
}

/**
 * Sort + batch-aging key. An unparseable `createdAt` sorts oldest (−∞) so a corrupt
 * message surfaces first and ages past any window → rings, never silently held.
 */
function ageKey(m: PendingMessage): number {
  const t = Date.parse(m.createdAt);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Read / notify state → ms, fail-toward-ringing: absent OR unparseable reads as
 * `null` ("never"), so a corrupt state entry leans toward ringing — never the
 * all-silent `all_read` a raw NaN would otherwise produce for the whole member.
 */
function parseOrNull(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
