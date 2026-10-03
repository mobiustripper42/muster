/**
 * Likely duplicates (Phase 18.6, issue #1120) — the one rule every check-in surface counts people by:
 * the booker's party page, the signing page's success screen, and the mate's list.
 *
 * **An obvious duplicate is the same name, case and spacing ignored, and the same date of birth,
 * within one booking**; walk-ups match only walk-ups (operator, 2026-10-02: someone signing twice
 * "happens all the time"). Not a shared email or phone — couples share one, and grouping on it would
 * hide a real person. Not the name alone — Sr. and Jr. sail together. A false match hides someone who
 * still has to sign; a missed one overcounts by one, which is the cheaper mistake.
 *
 * **Every signing is still its own row.** Nothing is merged or deleted; a duplicate is grouped where
 * it is shown and counted once. If the mate ticks both signings (**Check in again**), it was two people
 * after all, and both count.
 *
 * Imports types only, so the mate's list island can use it in the browser.
 */
import type { Guest } from "./entities.js";

/** Which signings are one person. With no date of birth (retention cleared it) nothing can be told,
 *  so the row is its own. */
function personKey(g: Guest): string {
  const name = g.name.trim().replace(/\s+/g, " ").toLowerCase();
  return JSON.stringify([g.reservationId ? String(g.reservationId) : null, name, g.dob ?? `#${String(g.id)}`]);
}

/** The signings grouped by person, each group earliest signing first, groups in no promised order. */
export function groupSignings<G extends Guest>(guests: readonly G[]): G[][] {
  const groups = new Map<string, G[]>();
  for (const g of guests) {
    const key = personKey(g);
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || String(a.id).localeCompare(String(b.id))),
  );
}

/** How many people a group is: one, unless the mate checked more of its signings in. */
function peopleIn(group: readonly Guest[]): number {
  return Math.max(1, group.filter((g) => g.checkedIn).length);
}

/** How many people have signed — the number every surface shows, before its caps. */
export function peopleSigned(guests: readonly Guest[]): number {
  return groupSignings(guests).reduce((n, group) => n + peopleIn(group), 0);
}

/** One signing in a row, as the mate's list holds it. */
export interface RowSigning {
  guestId: string;
  checkedIn: boolean;
}

/** A tap (or **Check in again**) ticks the earliest signing not yet ticked. */
export function nextToTick(signings: readonly RowSigning[]): string | undefined {
  return signings.find((s) => !s.checkedIn)?.guestId;
}

/** An undo takes back the latest tick first. */
export function nextToUntick(signings: readonly RowSigning[]): string | undefined {
  return [...signings].reverse().find((s) => s.checkedIn)?.guestId;
}
