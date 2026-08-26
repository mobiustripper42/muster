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

/**
 * The same question, asked **at most once per DOM event**.
 *
 * Two guarded forms can be dirty at the same time — `/crew/time-off` renders the add-a-window
 * form and the weekday-blackout form side by side, and either can hold an edit. With a listener
 * per form, one click ran the prompt once per armed guard: two native dialogs back to back for
 * one click, and an operator who confirmed the first could reflexively dismiss the second and
 * find themselves blocked on a page they had already agreed to leave.
 *
 * The dirtiness this consults is page-wide (`anythingDirty`), so the first answer is the right
 * answer for every listener that sees the same event. Caching it on the event identity makes
 * that true by construction rather than by counting listeners.
 */
let answeredEvent: Event | null = null;
let answeredWith = true;

export function confirmLeaveOnce(event: Event): boolean {
  if (answeredEvent === event) return answeredWith;
  answeredEvent = event;
  answeredWith = confirmLeaveIfDirty();
  return answeredWith;
}

/**
 * The Back/Forward trap — **one per page, not one per form** (#781).
 *
 * A soft navigation backwards fires `popstate` *after* the browser has moved and Next has begun
 * rendering the previous route, so asking at that point and calling `history.forward()` would
 * return a form re-fetched from the server with the typing gone. Undoing the move is not enough;
 * it has to be prevented. So a duplicate history entry for the same URL sits under the page, a
 * Back press lands on it with the form intact, and the guard can ask.
 *
 * **Refcounted, and armed for the page's whole life rather than while something is dirty.** Both
 * of those are corrections to the first cut:
 *
 *  - *Per form* meant a page with two guarded forms pushed two sentinels and unwound them
 *    unevenly. There is one back stack, so there is one trap.
 *  - *Armed on dirty* pushed a fresh entry on every clean→dirty transition, so a value edited
 *    back and forth several times stacked up that many dead Back presses. It also left a hole:
 *    a Back press while the form was momentarily clean consumed the sentinel silently, and the
 *    next edit re-armed nothing, so the following Back walked out unchallenged.
 *
 * Arming unconditionally costs nothing visible, because a pop with nothing dirty is **consumed
 * transparently** — the handler consents immediately and re-issues the step the operator asked
 * for, so one Back press still goes back one page.
 */
const SENTINEL = "__unsavedGuard";
let trapHolders = 0;
let traversing = false;

function pushSentinel(): void {
  // Spread the existing state so Next's own router state survives — this entry has to be
  // indistinguishable from the one it shadows apart from the marker.
  window.history.pushState(
    { ...window.history.state, [SENTINEL]: true },
    "",
    window.location.href,
  );
}

function onPopState(e: PopStateEvent): void {
  // Our own `history.back()` below fires this handler again; let that one stand.
  if (traversing) {
    traversing = false;
    return;
  }
  if (confirmLeaveOnce(e)) {
    // Nothing dirty, or the operator consented. Either way take the step they asked for.
    traversing = true;
    window.history.back();
    return;
  }
  // Declined. The sentinel was consumed by this pop, so replace it or the next Back press
  // walks out unchallenged.
  pushSentinel();
}

/** Arm the trap while at least one guarded form is mounted. Returns the release function. */
export function retainBackTrap(): () => void {
  trapHolders += 1;
  if (trapHolders === 1) {
    pushSentinel();
    window.addEventListener("popstate", onPopState);
  }
  return () => {
    trapHolders -= 1;
    if (trapHolders === 0) window.removeEventListener("popstate", onPopState);
  };
}
