"use client";

/**
 * A module-level "somebody has an unsaved edit" flag, shared by the islands that can
 * navigate away from one.
 *
 * Why this exists: `DirtySubmit` guarded anchor clicks and `beforeunload`, which covers
 * the day ‹/› steps, the view tabs, a reload and a tab close — but NOT
 * `AutoSubmitSelect` / `AutoSubmitDate`, which navigate by `router.push` from a
 * `change` handler. Switching crew member mid-edit silently discarded the edit, and the
 * guard's own comment claimed full coverage. Two components needed one fact, so the
 * fact lives here rather than in either of them.
 *
 * A `Set` of tokens rather than a boolean: several punch rows are on screen at once and
 * each owns its own dirtiness, so "is anything dirty" is a non-empty check.
 *
 * **Moved out of `components/admin/` at #781.** It was never admin-only — `/crew/time`
 * has imported it across that boundary since the day it landed — and #781 puts the
 * guard on four crew and six admin surfaces, so the directory name was the last thing
 * still claiming otherwise.
 */

const dirty = new Set<symbol>();

export function markDirty(token: symbol, isDirty: boolean): void {
  if (isDirty) dirty.add(token);
  else dirty.delete(token);
}

export function forgetDirty(token: symbol): void {
  dirty.delete(token);
}

export function anythingDirty(): boolean {
  return dirty.size > 0;
}

/**
 * Ask before abandoning an unsaved edit. Returns true when it's safe to proceed —
 * either nothing is dirty, or the operator confirmed.
 *
 * Deliberately a plain `confirm`: the alternative (a custom modal) is a component with
 * focus management and its own failure modes, for a prompt that fires rarely and must
 * not be dismissable by accident. Reaffirmed at #781 (operator, 2026-08-24) when the
 * guard went from two surfaces to ten.
 *
 * **The copy stopped naming the punch at #781.** It read "an unsaved change on this
 * punch" while the guard covered only the two time-clock surfaces; it now covers add-ons,
 * offerings, vessels, locations, blocks, time-off and the calendar pane, where a punch is
 * not what the operator is looking at.
 */
export function confirmLeaveIfDirty(): boolean {
  if (!anythingDirty()) return true;
  return window.confirm("You have unsaved changes. Leave without saving?");
}
