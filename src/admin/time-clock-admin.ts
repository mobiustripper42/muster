/**
 * `/admin/time-clock` view models (#627, SPEC §2.9.5/§2.9.7) — the operator's repair
 * bench. Muster never guesses when someone went home, so a missed clock-out is closed
 * by a human; this is what that human reads.
 *
 * **Two narrow views, deliberately not a fleet-wide grid** (operator, 2026-08-01):
 * one crew × one pay period (the "fix Quint's timesheet" job), and all crew × one day
 * (the "what happened Saturday" job). A 14-day × 16-person grid would be ~224 mostly
 * empty rows — a timesheet editor, not a triage surface. The inverse gap (someone who
 * held a seat and never punched at all) is #638, on the report where completeness is
 * already the question.
 *
 * **{@link staleOpenPunches} is the load-bearing part.** A punch left open three days
 * ago appears in NEITHER view unless the operator happens to pick that crew or that
 * day — so it rides above both, independent of the pickers. Without it the §2.9.5
 * forgotten clock-out is findable only by luck, which is the opposite of "flagged".
 *
 * Pure reads over the port (the `buildPayrollReport` idiom): name-map once, then walk.
 */

import type { TimePunch } from "../domain/entities.js";
import type { CrewMemberId, ShiftId, TimePunchId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { addDays, vesselClockOf, vesselDateOf, zonedWallClockToInstant } from "../config/tenant.js";
import type { PayPeriod } from "./pay-periods.js";

export interface PunchRow {
  id: TimePunchId;
  crewMemberId: CrewMemberId;
  /** Null when the punch references a crew id with no member (no-FK orphan). */
  crewName: string | null;
  /** Vessel-local `YYYY-MM-DD` of `inAt` — the day this punch belongs to. */
  day: string;
  /** Vessel-local `HH:MM`. */
  inTime: string;
  /** Vessel-local `HH:MM`, or null while open. */
  outTime: string | null;
  /** True elapsed minutes, or null while open. Unrounded (§2.9.6). */
  minutes: number | null;
  open: boolean;
  /**
   * The punch ends on a LATER vessel-local day than it started — an evening trip that
   * landed after midnight. One punch, on the earlier day (§2.9.6); the edit form needs
   * this to pre-check its "out is next day" box, because there is one date field and
   * the out time alone can't say which day it means.
   */
  outIsNextDay: boolean;
  /** `origin: "admin"` — the operator entered it; nobody tapped anything (§2.9.8). */
  enteredByAdmin: boolean;
  /** `adminEditedAt` set — someone else moved these hours. */
  editedByAdmin: boolean;
  shiftId: ShiftId | null;
}

export interface CrewPeriodView {
  crewMemberId: CrewMemberId;
  /** Null when the id doesn't resolve — render nameless rather than throw. */
  crewName: string | null;
  period: PayPeriod;
  /** Open first, then newest-first. */
  rows: PunchRow[];
  /** Closed punches only (§2.9.6). */
  totalMinutes: number;
  openCount: number;
}

export interface DayView {
  day: string;
  /** Open first, then by crew name. */
  rows: PunchRow[];
  totalMinutes: number;
  openCount: number;
}

export interface StaleOpenPunch {
  id: TimePunchId;
  crewMemberId: CrewMemberId;
  crewName: string | null;
  /** The vessel-local day it was opened on. */
  day: string;
  inTime: string;
}

const MINUTE_MS = 60_000;

/**
 * Vessel-local `[from, to]` inclusive DAYS → the half-open instant window
 * `[from 00:00, to+1 00:00)` the port queries on. Via `zonedWallClockToInstant` so it
 * is DST-correct: a period boundary in a week the clocks changed is still midnight
 * local, not midnight-minus-an-hour.
 */
function instantWindow(from: string, to: string): { from: string; to: string } {
  return {
    from: zonedWallClockToInstant(from, "00:00").toISOString(),
    to: zonedWallClockToInstant(addDays(to, 1), "00:00").toISOString(),
  };
}

function toRow(p: TimePunch, crewName: string | null): PunchRow {
  const inAt = new Date(p.inAt);
  const outAt = p.outAt === null ? null : new Date(p.outAt);
  return {
    id: p.id,
    crewMemberId: p.crewMemberId,
    crewName,
    day: vesselDateOf(inAt),
    inTime: vesselClockOf(inAt),
    outTime: outAt === null ? null : vesselClockOf(outAt),
    // Unrounded — §2.9.6 forbids a rounding policy in either direction; the surface
    // floors for display.
    minutes: outAt === null ? null : (outAt.getTime() - inAt.getTime()) / MINUTE_MS,
    open: outAt === null,
    outIsNextDay: outAt !== null && vesselDateOf(outAt) > vesselDateOf(inAt),
    enteredByAdmin: p.origin === "admin",
    editedByAdmin: p.adminEditedAt !== null,
    shiftId: p.shiftId,
  };
}

const totals = (rows: PunchRow[]) => ({
  totalMinutes: rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
  openCount: rows.filter((r) => r.open).length,
});

/** Open first — an unclosed punch is why this page exists, so it never sorts below a
 *  tidy one, however recent that one is. */
function openFirst(a: PunchRow, b: PunchRow, tie: (a: PunchRow, b: PunchRow) => number): number {
  if (a.open !== b.open) return a.open ? -1 : 1;
  return tie(a, b);
}

/** View (a): one crew member's punches across one pay period. */
export async function buildCrewPeriodView(
  repo: Repository,
  crewMemberId: CrewMemberId,
  period: PayPeriod,
): Promise<CrewPeriodView> {
  const [member, punches] = await Promise.all([
    repo.getCrewMember(crewMemberId),
    repo.listTimePunchesForCrew(crewMemberId),
  ]);

  const w = instantWindow(period.start, period.end);
  const rows = punches
    .filter((p) => p.inAt >= w.from && p.inAt < w.to)
    .map((p) => toRow(p, member?.name ?? null))
    .sort((a, b) =>
      openFirst(a, b, (x, y) =>
        x.day === y.day ? y.inTime.localeCompare(x.inTime) : y.day.localeCompare(x.day),
      ),
    );

  return {
    crewMemberId,
    crewName: member?.name ?? null,
    period,
    rows,
    ...totals(rows),
  };
}

/** View (b): every crew member's punches on one vessel-local day. */
export async function buildDayView(repo: Repository, day: string): Promise<DayView> {
  const w = instantWindow(day, day);
  const [punches, crew] = await Promise.all([
    repo.listTimePunchesBetween(w.from, w.to),
    repo.listCrewMembers(),
  ]);
  const nameById = new Map(crew.map((c) => [String(c.id), c.name]));

  const rows = punches
    .map((p) => toRow(p, nameById.get(String(p.crewMemberId)) ?? null))
    .sort((a, b) =>
      openFirst(a, b, (x, y) => (x.crewName ?? "").localeCompare(y.crewName ?? "")),
    );

  return { day, rows, ...totals(rows) };
}

/**
 * Every punch still open from a day BEFORE `today` — the strip above both views.
 *
 * A punch open since today is just someone on the clock, which is not a problem and
 * must not be dressed as one. Oldest first: the most overdue repair leads.
 *
 * Reads `listAllTimePunches` (the integrity scan's method) because nothing narrower
 * exists — the port has no "list open punches". That is fine at this fleet's volume
 * and for years to come; if `time_punches` ever grows to where a full scan per render
 * matters, the fix is a `listOpenTimePunches` port method backed by the partial index
 * that already exists on `(crew_member_id) where out_at is null`.
 */
export async function staleOpenPunches(
  repo: Repository,
  today: string,
): Promise<StaleOpenPunch[]> {
  const [all, crew] = await Promise.all([
    repo.listAllTimePunches(),
    repo.listCrewMembers(),
  ]);
  const nameById = new Map(crew.map((c) => [String(c.id), c.name]));

  return all
    .filter((p) => p.outAt === null)
    .map((p) => {
      const inAt = new Date(p.inAt);
      return {
        id: p.id,
        crewMemberId: p.crewMemberId,
        crewName: nameById.get(String(p.crewMemberId)) ?? null,
        day: vesselDateOf(inAt),
        inTime: vesselClockOf(inAt),
      };
    })
    .filter((s) => s.day < today)
    .sort((a, b) => (a.day === b.day ? a.inTime.localeCompare(b.inTime) : a.day.localeCompare(b.day)));
}
