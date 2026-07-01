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
  const shift = await repo.getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);
  if (shift.splitCutTime != null) {
    throw new Error(`Shift ${shiftId} is already split`);
  }
  if (String(shiftId).endsWith("-b")) {
    throw new Error(`Cannot split a split side (${shiftId})`);
  }

  // The cut must produce two non-empty sides from the CURRENT scheduled trips.
  const times: string[] = [];
  for (const id of shift.eventIds) {
    const e = await repo.getEvent(id);
    if (e && e.status === "scheduled") times.push(e.time);
  }
  const hasBefore = times.some((t) => t < cutTime);
  const hasAfter = times.some((t) => t >= cutTime);
  if (!hasBefore || !hasAfter) {
    throw new Error(
      `Cut ${cutTime} does not split ${shiftId} into two non-empty sides`,
    );
  }

  await repo.saveShift({ ...shift, splitCutTime: cutTime });
  return formShifts(repo, now ? { now } : undefined);
}
