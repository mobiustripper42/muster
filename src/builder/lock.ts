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

import type { Reservation, Shift } from "../domain/entities.js";
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

/**
 * "Changed since you reviewed it" (SPEC §2.3, DEC-029) — pure derivation, never
 * a stored/dismissable flag. A locked shift shows the nudge iff a reservation on
 * one of its events was created or materially changed *after* the lock:
 * `max(reservation.updatedAt over the shift's events) > shift.lockedAt`.
 *
 * - Unlocked shift → never (nothing has been "reviewed" yet; it absorbs quietly).
 * - Re-lock advances `lockedAt` → clears (re-reviewed).
 * - String comparison is safe: both are full ISO-8601 UTC instants (same format
 *   `lockShift` writes; the import stamps `updatedAt` the same way).
 *
 * `reservations` may include rows from other events — filtered here by the
 * shift's `eventIds`, so the caller can pass everything on those events as-is.
 * Knowingly excluded in v1 (DEC-029): capacity-only event edits (the import
 * overwrites silently); event time/date edits ARE caught — they re-key `eventId`,
 * which rewrites each reservation as a material change.
 */
export function changedSinceReviewed(
  shift: Shift,
  reservations: Reservation[],
): boolean {
  const lockedAt = shift.lockedAt;
  if (lockedAt == null) return false;
  const events = new Set<string>(shift.eventIds.map(String));
  return reservations.some(
    (r) =>
      events.has(String(r.eventId)) &&
      r.updatedAt != null &&
      r.updatedAt > lockedAt,
  );
}
