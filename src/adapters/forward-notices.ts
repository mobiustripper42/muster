import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { AssignmentAction } from "../domain/entities.js";
import type { NoticePort } from "../ports/notice.js";
import type { Repository } from "../ports/repository.js";

/** One "you're on / you're off a shift" change to relay (DEC-084). The engine
 * (e.g. `mergeShift`) returns the crew ids + the shift; the edge maps each to this. */
export interface AssignmentChange {
  crewMemberId: CrewMemberId;
  action: AssignmentAction;
  shiftId: ShiftId;
}

/** "Sat, Jul 4" from an ISO date — UTC-pinned so the text is TZ-deterministic
 * (matches `forward-asks`). */
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Forward assignment-change notices to the notice channel (DEC-084) — the sibling of
 * `forwardAsks`/`forwardNotifications`. Composes the relay body from the shift facts
 * (the change doesn't carry them), then hands each to the channel; the channel mints
 * the link + enqueues. Best-effort: a dangling ref or a channel hiccup is swallowed
 * (the domain action — the merge — already committed). Returns how many were sent.
 *
 * The operator-as-crew exclusion (DEC-072/084) is the CALLER's job — the operator id
 * is an app-edge value (`OPERATOR_CREW_MEMBER_ID`), so `mergeAction` filters it out of
 * the change list before calling this. This adapter stays operator-agnostic (and
 * clock-free); it relays exactly the changes it's handed.
 *
 * NO IDEMPOTENCY NET (9.4): the outbox adapter's deterministic slot (terminal
 * on sent) deduped re-issued changes; the Twilio adapter just sends. Call sites
 * today fire once per committed change — a new retry-prone caller must bring
 * its own guard or crew get duplicate texts.
 */
export async function forwardNotices(
  repo: Repository,
  channel: NoticePort,
  changes: readonly AssignmentChange[],
): Promise<number> {
  let forwarded = 0;
  for (const change of changes) {
    try {
      const crew = await repo.getCrewMember(change.crewMemberId);
      if (!crew) continue; // dangling ref — nothing to relay
      const shift = await repo.getShift(change.shiftId);
      if (!shift) continue;
      const vessel = await repo.getVessel(shift.vesselId);
      // GSM-7 only (no ·) to keep the SMS a 1-segment message, not UCS-2.
      const where = `${fmtDate(shift.date)} - ${vessel?.name ?? shift.vesselId}`;
      const body =
        change.action === "removed"
          ? `Muster: you're off the ${where} shift.`
          : `Muster: you're on the ${where} shift.`;

      await channel.send({
        to: { crewMemberId: crew.id, phone: crew.phone },
        action: change.action,
        shiftId: change.shiftId,
        body,
      });
      forwarded++;
    } catch {
      // Best-effort (see header): the merge already succeeded.
    }
  }
  return forwarded;
}
