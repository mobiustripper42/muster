/**
 * Time off (blackout windows) — the add/remove/scan use-cases over `PtoWindow`
 * (SPEC §2.1, DEC-009). Surfaces-only: the data model + suppression already ship
 * (the oracle's "not on PTO" rule reads these); this module is the write door the
 * crew and admin surfaces (#332) post through.
 *
 * The one line to hold (DEC-009): this is **subtractive** — "I'm OFF these dates."
 * A window means unavailable; absence means available. There is deliberately no
 * positive "set your availability" — that reversal is a separate, parked idea.
 *
 * Validation lives here, not the surface: every date crosses `isIsoDate` (the
 * dates-as-text door, DEC-020/032) before it can persist, and `start ≤ end` is
 * enforced so a window can't invert. Expected user errors return a `code` rather
 * than throw — the surface maps each to calm copy (the claim-service idiom).
 */

import type { PtoWindow } from "../domain/entities.js";
import type { CrewMemberId, PtoWindowId } from "../domain/ids.js";
import { isIsoDate } from "../domain/iso-date.js";
import type { Repository } from "../ports/repository.js";

/** Expected, surfaced-to-the-user failures of {@link addTimeOff}. */
export type AddTimeOffCode = "bad_date" | "end_before_start";

export type AddTimeOffResult =
  | { ok: true; window: PtoWindow }
  | { ok: false; code: AddTimeOffCode };

/**
 * Add one blackout window. The caller mints the id (branded-id convention — the
 * core mints nothing it can't make deterministic); dates are validated at this
 * door. `start`/`end` are inclusive calendar dates (`YYYY-MM-DD`, vessel-local
 * per DEC-032); string comparison is a valid date order for that shape.
 */
export async function addTimeOff(
  repo: Repository,
  input: { id: PtoWindowId; crewMemberId: CrewMemberId; start: string; end: string },
): Promise<AddTimeOffResult> {
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) {
    return { ok: false, code: "bad_date" };
  }
  if (input.end < input.start) {
    return { ok: false, code: "end_before_start" };
  }
  const window: PtoWindow = {
    id: input.id,
    crewMemberId: input.crewMemberId,
    start: input.start,
    end: input.end,
  };
  await repo.savePtoWindow(window);
  return { ok: true, window };
}

/** Delete a window by id. Unrestricted — the operator surface calls this
 *  directly; the crew surface gates on {@link ownsTimeOff} first (a crew member
 *  can only remove their own). Idempotent at the adapter (no-op if already gone). */
export async function removeTimeOff(repo: Repository, id: PtoWindowId): Promise<void> {
  await repo.removePtoWindow(id);
}

/**
 * Does this window belong to this crew member? The crew self-serve remove path's
 * authorization guard (10.3 posture) — a forged window id can't delete someone
 * else's off-dates. Reads the crew's own set (no per-id port lookup exists) and
 * checks membership.
 */
export async function ownsTimeOff(
  repo: Repository,
  crewMemberId: CrewMemberId,
  id: PtoWindowId,
): Promise<boolean> {
  const mine = await repo.listPtoWindowsForCrew(crewMemberId);
  return mine.some((w) => w.id === id);
}

/** One crew member's blackout windows, sorted by start — the shape both the crew
 *  "Days I'm off" list and the admin per-crew group render. */
export function sortWindows(windows: PtoWindow[]): PtoWindow[] {
  return [...windows].sort((a, b) => a.start.localeCompare(b.start));
}

export interface TimeOffByCrew {
  crewMemberId: CrewMemberId;
  crewName: string;
  /** Archived crew keep any stale windows but are off every list — the scan greys
   *  them so a stale window isn't read as an active person's (DEC-096). */
  archived: boolean;
  windows: PtoWindow[];
}

/**
 * Everyone's time off, grouped per crew for the admin scan (#332) — "who's out
 * before I work a shift." Only crew who actually have windows appear; sorted by
 * crew name, each group's windows by start. An orphaned window (crew id with no
 * matching member — the no-FK bet, DEC-020) is skipped rather than shown nameless.
 */
export async function buildAllTimeOff(repo: Repository): Promise<TimeOffByCrew[]> {
  const [windows, crew] = await Promise.all([
    repo.listAllPtoWindows(),
    repo.listCrewMembers(),
  ]);
  const byId = new Map(crew.map((c) => [String(c.id), c]));
  const byCrew = new Map<string, TimeOffByCrew>();
  for (const w of windows) {
    const member = byId.get(String(w.crewMemberId));
    if (member === undefined) continue; // orphan (no-FK) — don't render nameless
    const group = byCrew.get(String(w.crewMemberId));
    if (group) {
      group.windows.push(w);
    } else {
      byCrew.set(String(w.crewMemberId), {
        crewMemberId: w.crewMemberId,
        crewName: member.name,
        archived: member.status === "archived",
        windows: [w],
      });
    }
  }
  return [...byCrew.values()]
    .map((g) => ({ ...g, windows: sortWindows(g.windows) }))
    .sort((a, b) => a.crewName.localeCompare(b.crewName));
}
