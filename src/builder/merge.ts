/**
 * Manual merge of a split vessel-day (SPEC §2.3 action, DEC-083 inverse) — the
 * operator jams the two sides of a split back into one shift.
 *
 * DEC-083 pins the mechanics: clear `splitCutTime` on the canonical (side-A) row,
 * explicitly REMOVE the `…-b` shift + its seats, then re-run `formShifts` — which
 * re-forms the whole vessel-day as one un-split shift. Clearing the cut alone would
 * orphan `…-b` (the un-split machinery is vessel|date-keyed and never revisits a
 * `…-b` id). Side A's crew is preserved by seat id (DEC-005); side B's assigned crew
 * are DROPPED — returned as `freedCrew` so the edge notifies them (DEC-084). The
 * notice is emitted from THIS explicit command only, never the idempotent re-form.
 */

import type { Repository } from "../ports/repository.js";
import type { ShiftId, CrewMemberId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { formShifts } from "./form-shifts.js";
import type { FormResult } from "./form-shifts.js";

export interface MergeResult {
  /** The re-form after teardown — the day is one un-split shift again. */
  form: FormResult;
  /**
   * Side-B occupants dropped by the merge (anyone assigned to a `…-b` seat). The
   * edge sends each an `action:"removed"` notice (DEC-084); empty when side B was
   * uncrewed. Deduped — one notice per person.
   */
  freedCrew: CrewMemberId[];
}

/**
 * Merge the split at `shiftId` (the canonical side-A row) back into one shift.
 * Throws on an invalid target — a `…-b` side, a non-canonical id, or an un-split
 * shift; the caller maps the message to inline feedback. Returns the re-form + the
 * freed crew.
 */
export async function mergeShift(
  repo: Repository,
  shiftId: ShiftId,
  now?: Date,
): Promise<MergeResult> {
  const shift = await repo.getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);
  if (String(shiftId).endsWith("-b")) {
    throw new Error(`Cannot merge from a split side (${shiftId}) — merge its canonical`);
  }
  // Same canonical-id invariant as splitShift (DEC-083): merge/split key on
  // `shift-{vessel}-{date}`, the only id `formShifts` re-forms.
  const canonicalId = `shift-${shift.vesselId}-${shift.date}`;
  if (String(shiftId) !== canonicalId) {
    throw new Error(`Shift ${shiftId} is not the canonical vessel-day shift (${canonicalId})`);
  }
  if (shift.splitCutTime == null) {
    throw new Error(`Shift ${shiftId} is not split`);
  }

  const sideBId = asId<"ShiftId">(`${canonicalId}-b`);
  const sideB = await repo.getShift(sideBId);

  // Crew who SURVIVE the merge: side A's assignees. Side A's seats are preserved by
  // id through the re-form (DEC-005), so anyone holding a side-A seat keeps their
  // spot on the merged day. A crew member confirmed on BOTH halves (routine on a
  // 2-crew boat working morning + evening) must NOT be told they're off — the notice
  // has to be true (DEC-084).
  const surviving = new Set<string>();
  for (const seat of await repo.listSeatsForShift(shiftId)) {
    if (seat.assignedCrewMemberId) surviving.add(String(seat.assignedCrewMemberId));
  }

  // Snapshot side-B's assignees BEFORE teardown, MINUS the side-A survivors — the
  // net set actually dropped off the day. Then tear side B down: seats first, then
  // the shift row (DEC-083 — clearing the cut alone orphans it).
  const freed = new Set<string>();
  if (sideB) {
    const seats = await repo.listSeatsForShift(sideBId);
    for (const seat of seats) {
      const who = seat.assignedCrewMemberId;
      if (who && !surviving.has(String(who))) freed.add(String(who));
    }
    for (const seat of seats) {
      await repo.removeSeat(seat.id);
    }
    await repo.removeShift(sideBId);
  }

  // Clear the cut on the canonical (delete the optional field — not `= undefined`,
  // exactOptionalPropertyTypes), then re-form: cut == null → the un-split path folds
  // the whole vessel-day (side A's + side B's events) back into one shift.
  const uncut = { ...shift };
  delete uncut.splitCutTime;
  await repo.saveShift(uncut);
  const form = await formShifts(repo, now ? { now } : undefined);

  return {
    form,
    freedCrew: [...freed].map((id) => asId<"CrewMemberId">(id)),
  };
}
