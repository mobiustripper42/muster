/**
 * Lock a shift (SPEC §2.3 "Lock semantics").
 *
 * Lock = "the system was assembling this" → "I've reviewed it, crewing may
 * proceed." It stamps `lockedAt` (now injected — the core never reads the clock).
 * Per SPEC, locking a shift *inside the staffing horizon* fires the Tier-1 asks —
 * that firing arrives with the ask loop (M3 / task 1.4b); here lock only records
 * the review hand-off. Shift state stays derived from seats (DEC-005); locking
 * does not change it.
 */

import type { Shift } from "../domain/entities.js";
import type { ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export async function lockShift(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
): Promise<Shift> {
  const shift = await repo.getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);
  const locked: Shift = { ...shift, lockedAt: now.toISOString() };
  await repo.saveShift(locked);
  return locked;
}

/** Whether a shift has been locked (reviewed). */
export function isLocked(shift: Shift): boolean {
  return shift.lockedAt != null;
}
