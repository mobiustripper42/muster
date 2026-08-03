/**
 * Hours report (13.4, #628, SPEC §2.9.6) — per-crew ACTUAL hours for a pay period, the number
 * that becomes a paycheck.
 *
 * Distinct from `buildPayrollReport`, which ESTIMATES hours from Confirmed seats and trip
 * lengths. Both survive on purpose: the estimate is a useful cross-check exactly when the two
 * disagree, and `payroll-reconcile.ts` is what puts them side by side.
 *
 * **Bucketing is by the vessel-local date of `inAt` (DEC-032), never UTC**, and that is the
 * load-bearing decision in this file. An 8pm Eastern punch is already tomorrow in UTC, so a UTC
 * bucket moves a person's hours to the next period on the last day of every period — in the
 * direction that looks like a shortfall, with no error and nothing on screen to notice. The
 * window is converted to instants through `zonedWallClockToInstant` so it stays correct through
 * a DST week, when midnight local is not midnight-minus-an-hour.
 *
 * **Exact minutes, no rounding, in either direction** (§2.9.6). The payroll company applies its
 * own policy; one rounding step is auditable where two compounded are not.
 *
 * **Open punches contribute nothing and are counted** (§2.9.5) — Muster never guesses when
 * somebody went home. A number the recipient can see is incomplete beats a number that is
 * silently short.
 *
 * Pure read over the port, the `buildPayrollReport` idiom: name-map once, then walk.
 */

import type { TimePunch } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { addDays, zonedWallClockToInstant } from "../config/tenant.js";

export interface TimeClockRow {
  crewMemberId: string;
  /**
   * Null when the punch's crew id resolves to nobody. **Not reachable through Postgres:**
   * `crew_member_id` carries `references crew_members(id) on delete restrict` (migration
   * `20260731180000`) — it is `shift_id` that is deliberately un-FK'd, not this — and no
   * delete path for a crew member exists in the port at all (`status` is the lifecycle).
   * Kept because the in-memory repo enforces neither, and because if it ever did happen the
   * hours would still be owed: the row renders nameless rather than disappearing.
   */
  name: string | null;
  /** CLOSED punches only — an open one has no hours to count. */
  punchCount: number;
  /** True elapsed minutes of the closed punches, unrounded. */
  minutes: number;
  openCount: number;
  /** `origin: "admin"` — the operator entered it; nobody tapped anything (§2.9.8). */
  adminEnteredCount: number;
  /** `adminEditedAt` set — someone else moved these hours. */
  adminEditedCount: number;
  /** Either of the above. The one flag a surface needs to mark the row (§2.9.8). */
  touchedByAdmin: boolean;
}

export interface TimeClockReport {
  rows: TimeClockRow[];
  /** Total minutes across every crew member — closed punches only. */
  totalMinutes: number;
  /**
   * Open punches anywhere in the window. **The export gates on this** (§2.9.6, operator
   * 2026-08-02): any open punch when reconciling is an error needing attention, not a footnote
   * on a file that goes out anyway.
   */
  openCount: number;
}

const MINUTE_MS = 60_000;

/**
 * Vessel-local `[from, to]` inclusive DAYS → the half-open instant window
 * `[from 00:00, to+1 00:00)`. Same helper shape as `time-clock-admin.ts` — deliberately not
 * shared yet: two call sites is not a pattern, and the day this needs a third it should move to
 * `tenant.ts` rather than one admin module importing another's private helper.
 */
function instantWindow(from: string, to: string): { from: string; to: string } {
  return {
    from: zonedWallClockToInstant(from, "00:00").toISOString(),
    to: zonedWallClockToInstant(addDays(to, 1), "00:00").toISOString(),
  };
}

export async function buildTimeClockReport(
  repo: Repository,
  window: { from: string; to: string },
): Promise<TimeClockReport> {
  const w = instantWindow(window.from, window.to);
  const [punches, crew] = await Promise.all([
    repo.listTimePunchesBetween(w.from, w.to),
    repo.listCrewMembers(),
  ]);
  const nameById = new Map(crew.map((c) => [String(c.id), c.name]));

  const acc = new Map<string, Omit<TimeClockRow, "crewMemberId" | "name" | "touchedByAdmin">>();
  for (const p of punches) {
    const key = String(p.crewMemberId);
    const row =
      acc.get(key) ??
      { punchCount: 0, minutes: 0, openCount: 0, adminEnteredCount: 0, adminEditedCount: 0 };

    if (p.outAt === null) {
      row.openCount += 1;
    } else {
      row.punchCount += 1;
      row.minutes += elapsedMinutes(p);
    }
    if (p.origin === "admin") row.adminEnteredCount += 1;
    if (p.adminEditedAt !== null) row.adminEditedCount += 1;

    acc.set(key, row);
  }

  const rows: TimeClockRow[] = [...acc.entries()]
    .map(([crewMemberId, v]) => ({
      crewMemberId,
      name: nameById.get(crewMemberId) ?? null,
      ...v,
      touchedByAdmin: v.adminEnteredCount > 0 || v.adminEditedCount > 0,
    }))
    // Nameless rows sort last rather than throwing on a null compare — they're the exception and
    // they belong where the operator will notice them, not interleaved.
    .sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿"));

  return {
    rows,
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    openCount: rows.reduce((s, r) => s + r.openCount, 0),
  };
}

/** True elapsed minutes. Unrounded — §2.9.6 forbids a policy in either direction. */
function elapsedMinutes(p: TimePunch): number {
  return (Date.parse(p.outAt!) - Date.parse(p.inAt)) / MINUTE_MS;
}
