/**
 * Manual split of a vessel-day shift (SPEC §2.3 action, DEC-083).
 *
 * A split is stored as ONE field — `splitCutTime` (vessel-local "HH:MM") on the
 * canonical (side-A) row. This service sets it and re-forms; `formShifts` then
 * materializes side A (trips `< cut`, canonical id, crew preserved) and side B
 * (`>= cut`, `{id}-b`, born fresh), and re-derives that partition on every pull —
 * so the split survives Xola re-import. Merge (8.4) is the explicit inverse.
 */

import type { Repository } from "../ports/repository.js";
import type { ShiftId } from "../domain/ids.js";
import { formShifts } from "./form-shifts.js";
import type { FormResult } from "./form-shifts.js";

/**
 * Split `shiftId` at `cutTime`. The shift must be an un-split canonical shift, and
 * the cut must partition its current scheduled trips into two non-empty sides
 * (a cut that leaves one side empty isn't a split — that's the un-split shift).
 * Throws on an invalid target/cut; the caller maps the message to inline feedback.
 * Returns the `FormResult` of the re-form (the two sides now exist).
 */
export async function splitShift(
  repo: Repository,
  shiftId: ShiftId,
  cutTime: string,
  now?: Date,
): Promise<FormResult> {
  // Validate the cut FIRST — the partition is a lexical "HH:MM" compare
  // (`e.time < cut`), so a malformed cut ("9:00", "2pm") would be stored verbatim
  // and silently mis-partition. The engine is the trust boundary for the 8.3b UI.
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutTime)) {
    throw new Error(`Invalid cut time ${cutTime} — expected zero-padded "HH:MM"`);
  }

  const shift = await repo.getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);
  if (shift.splitCutTime != null) {
    throw new Error(`Shift ${shiftId} is already split`);
  }
  if (String(shiftId).endsWith("-b")) {
    throw new Error(`Cannot split a split side (${shiftId})`);
  }
  // DEC-083 keys the whole split/merge design on the canonical vessel-day id
  // (`shift-{vessel}-{date}`) — `formShifts` only ever re-forms THAT id. Splitting a
  // NON-canonical shift (e.g. a hand-authored dev fixture with an id like
  // `shift-ar-gappy`) sets the cut on a row the re-form ignores, silently spawning a
  // duplicate canonical shift + an orphan husk (the "two rows, same times" trap). A
  // real shift is always canonical (formShifts minted it), so refuse anything else.
  const canonicalId = `shift-${shift.vesselId}-${shift.date}`;
  if (String(shiftId) !== canonicalId) {
    throw new Error(
      `Shift ${shiftId} is not the canonical vessel-day shift (${canonicalId})`,
    );
  }

  // The cut must produce two non-empty sides from the vessel-day's LIVE scheduled
  // trips — what `formShifts` will actually partition, not a stale `eventIds`.
  const times = (await repo.listEvents())
    .filter(
      (e) =>
        e.vesselId === shift.vesselId &&
        e.date === shift.date &&
        e.status === "scheduled",
    )
    .map((e) => e.time);
  const hasBefore = times.some((t) => t < cutTime);
  const hasAfter = times.some((t) => t >= cutTime);
  if (!hasBefore || !hasAfter) {
    throw new Error(
      `Cut ${cutTime} does not split ${shiftId} into two non-empty sides`,
    );
  }

  await repo.saveShift({ ...shift, splitCutTime: cutTime });
  // notifyTripChanges (#350): this is an explicit operator command, so the crew who
  // stay on side A — now a shorter day (the later trips split off into `…-b`) — get a
  // "your shift changed" notice. Opting in from the command (not the idempotent
  // re-form) is the DEC-084 posture.
  return formShifts(repo, { notifyTripChanges: true, ...(now ? { now } : {}) });
}
