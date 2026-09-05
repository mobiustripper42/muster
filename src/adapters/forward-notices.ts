import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { AssignmentAction } from "../domain/entities.js";
import type { NoticePort } from "../ports/notice.js";
import type { Repository } from "../ports/repository.js";
import { changeSummary, GSM7_SEGMENT, type ChangeDetail } from "./change-summary.js";
import { outbound } from "./message-opener.js";

/** One "you're on / you're off a shift" change to relay (DEC-084). The engine
 * (e.g. `mergeShift`) returns the crew ids + the shift; the edge maps each to this. */
export interface AssignmentChange {
  crewMemberId: CrewMemberId;
  action: AssignmentAction;
  shiftId: ShiftId;
  /** #740: what moved, for `action: "changed"` only. Absent → the notice falls back to the
   * original "shift changed - check the app." Optional rather than required because the other
   * two actions have nothing to describe — "you're off the … shift." is complete on its own,
   * and `changed` was the only one naming an event without naming its content. */
  detail?: ChangeDetail;
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
      // #740: fit the summary against what is ACTUALLY left, not a guessed allowance. The
      // opener, the date and the vessel name are already spent, and the vessel name is tenant
      // data of unknown length — so compose the frame first, measure it, and hand the remainder
      // to `changeSummary`. A summary sized against a constant would overflow on a long boat
      // name and split the message, which is the #619 failure with extra steps.
      // No "check the app." tail (operator, 2026-08-17): the crew have had this notice for
      // months and know where the detail lives. It cost ~15 characters of a budget measured in
      // single digits, and those characters buy another token of what actually moved.
      const changedFrame = (summary: string) =>
        outbound("crew", `your ${where} shift changed: ${summary}.`);
      const plainChanged = outbound("crew", `your ${where} shift changed.`);
      const summary = change.detail
        ? changeSummary(change.detail, { budget: GSM7_SEGMENT - changedFrame("").length })
        : null;

      const body =
        change.action === "removed"
          ? outbound("crew", `you're off the ${where} shift.`)
          // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
          : change.action === "changed"
            // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
            ? summary
              ? changedFrame(summary)
              : plainChanged
            : outbound("crew", `you're on the ${where} shift.`);

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
