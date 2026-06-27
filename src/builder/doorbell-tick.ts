/**
 * The Smart Doorbell tick (#167, Phase 6.6b) — the clock-driven sweep that runs
 * the pure decider (#114) against live store + presence state and records the
 * rings. The doorbell analog of the engine `tick` (DEC-023/049): a separate cron
 * (DEC-070) fires it; the core stays clock-free with `now` injected here.
 *
 * Per sweep, over every thread that has messages (`listThreadsWithMessages` —
 * NOT a time-bounded slice, DEC-070): derive its members, assemble the decider's
 * inputs from the store + the `PresencePort`, run `decideNotifications`, and
 * **record notify-state for each ring** so first-only-until-read survives to the
 * next sweep. This module assembles + records (I/O); it never composes an SMS or
 * sends — delivery is `forwardNotifications` at the edge.
 *
 * **Edge presence classification (DEC-068):** the coarse `lastActiveFor` signal
 * yields only `present_elsewhere | absent` here — never `present_here` (that's the
 * future per-thread realtime adapter, DEC-047). So v1's observable is
 * present-anywhere → toast, absent → SMS, with zero decider change when realtime
 * lands.
 */

import type { Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { Message } from "../messaging/entities.js";
import { deriveMembers } from "../messaging/membership.js";
import { isPresent } from "../messaging/presence.js";
import {
  decideNotifications,
  memberThreadKey,
  type DoorbellRules,
  type NotificationDecision,
  type PendingMessage,
  type PresenceState,
} from "../messaging/doorbell-decider.js";
import type { PresencePort } from "../ports/presence.js";
import type { Repository } from "../ports/repository.js";

export interface DoorbellTickResult {
  threadsSwept: number;
  /** Every (thread, member) decision this sweep — suppress/hold/toast/ring. */
  decisions: NotificationDecision[];
  /** The subset with `ring:true` — what `forwardNotifications` delivers. */
  rings: NotificationDecision[];
}

export async function doorbellTick(
  repo: Repository,
  presence: PresencePort,
  now: Date,
  rules: DoorbellRules,
): Promise<DoorbellTickResult> {
  const nowIso = now.toISOString();
  // Global membership inputs — loaded ONCE for the whole sweep, not per thread
  // (deriveMembers folds the schedule for cohort/shift kinds; all_staff = roster).
  const [shifts, seats, roster, threads] = await Promise.all([
    repo.listShifts(),
    repo.listAllSeats(),
    repo.listCrewMembers(),
    repo.listThreadsWithMessages(),
  ]);

  const decisions: NotificationDecision[] = [];
  for (const thread of threads) {
    const participants = await repo.listParticipantsForThread(thread.id);
    const members = deriveMembers(thread, { shifts, seats, roster, participants });
    if (members.length === 0) continue;
    const subjects: Subject[] = members.map((id) => ({ kind: "crew", id: String(id) }));

    const [messages, lastActive, readMap, notifyMap] = await Promise.all([
      repo.listMessagesForThread(thread.id),
      presence.lastActiveFor(subjects),
      repo.readStateForThread(thread.id),
      repo.notifyStateForThread(thread.id),
    ]);

    // Re-key the store's subjectKey-keyed maps to the decider's memberThreadKey,
    // and classify presence at the edge (DEC-068).
    const presenceVerdict = new Map<string, PresenceState>();
    for (const s of subjects) {
      if (isPresent(lastActive.get(subjectKey(s)), nowIso, rules.presenceWindowMs)) {
        presenceVerdict.set(memberThreadKey(thread.id, s), "present_elsewhere");
      }
    }
    const readState = new Map<string, string>();
    for (const [sk, at] of readMap) readState.set(`${thread.id}|${sk}`, at);
    const notifyState = new Map<string, string>();
    for (const [sk, at] of notifyMap) notifyState.set(`${thread.id}|${sk}`, at);

    decisions.push(
      ...decideNotifications({
        pendingMessages: messages.map(toPending),
        threadMembers: new Map([[thread.id, members]]),
        presence: presenceVerdict,
        readState,
        notifyState,
        rules,
        now: nowIso,
      }),
    );
  }

  const rings = decisions.filter((d) => d.ring);
  // Record-on-decide (DEC-070), like the engine tick records seat state: the
  // decider decided to ring, so the ring is the source of truth — first-only-
  // until-read must hold even if delivery later fails (delivery is best-effort).
  for (const d of rings) {
    await repo.recordNotification(d.threadId, d.subject, nowIso);
  }

  return { threadsSwept: threads.length, decisions, rings };
}

/** Map a stored `Message` 1:1 into the decider's input DTO (`priority` flows straight). */
function toPending(m: Message): PendingMessage {
  return {
    id: m.id,
    threadId: m.threadId,
    senderId: m.senderId,
    senderKind: m.senderKind,
    body: m.body,
    createdAt: m.createdAt,
    priority: m.priority,
  };
}
