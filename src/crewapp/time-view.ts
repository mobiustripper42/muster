/**
 * `/crew/time` view model (#626, SPEC §2.9.7) — the crew member's own clock.
 *
 * One card, one button: **Clock in** when they're out, **Clock out** when they're
 * in, never both and never a guess about which they meant. Plus this pay period's
 * punches and a running total. The surface renders this and decides nothing, which
 * is what makes the behavior testable at all — the page itself isn't.
 *
 * **Times cross the boundary as vessel-local strings**, not Dates: `TimePunch`
 * stores instants (DEC-032's deliberate exception, §2.9.1) and this is where they
 * come back to the wall clock a crew member actually reads. The page formats
 * `"09:00"` with `fmt12`, the same as `crew-view`'s call times.
 *
 * **Open punches are excluded from the total and counted separately** (§2.9.6) — a
 * number you can see is incomplete beats a number that is silently short. A running
 * elapsed time for the open punch is deliberately absent: the page is server-
 * rendered with no client JS, so a "ticking" counter would be a lie that's correct
 * only at render.
 */

import type { TimePunch } from "../domain/entities.js";
import type { CrewMemberId, TimePunchId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { PAY_PERIOD_ANCHOR, vesselClockOf, vesselDateOf } from "../config/tenant.js";
import { currentPeriod, type PayPeriod } from "../admin/pay-periods.js";

/** The open punch, when there is one. Null is "show Clock in". */
export interface OnTheClock {
  punchId: TimePunchId;
  /** Vessel-local `YYYY-MM-DD` of `inAt`. */
  sinceDate: string;
  /** Vessel-local `HH:MM` of `inAt` — the page renders "On the clock since 9:04 AM". */
  sinceTime: string;
  /**
   * The punch started on an earlier vessel-local day — a forgotten clock-out
   * (§2.9.5). Surfaced, never auto-closed: Muster does not guess when someone went
   * home. Until 13.3 there's no repair bench, so the honest thing the surface can do
   * is show it plainly.
   */
  startedOnAnEarlierDay: boolean;
}

export interface TimePunchRow {
  id: TimePunchId;
  /** Vessel-local `YYYY-MM-DD` of `inAt` — the day this punch belongs to. */
  date: string;
  /** Vessel-local `HH:MM`. */
  inTime: string;
  /** Vessel-local `HH:MM`, or null while open. */
  outTime: string | null;
  /** True elapsed minutes between the two instants, or null while open. */
  minutes: number | null;
  open: boolean;
  /**
   * An admin created or edited this one (§2.9.8). Shown so hours nobody actually
   * punched never look identical to hours they did — including to the crew member
   * whose name is on them.
   */
  adminTouched: boolean;
}

export interface CrewTimeView {
  onTheClock: OnTheClock | null;
  period: PayPeriod;
  /** This period's punches, newest first. */
  punches: TimePunchRow[];
  /** Sum of CLOSED punches only (§2.9.6). */
  totalMinutes: number;
  /** How many of `punches` are still open — the caveat on `totalMinutes`. */
  openCount: number;
}

const MINUTE_MS = 60_000;

export async function buildCrewTimeView(
  repo: Repository,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<CrewTimeView> {
  const today = vesselDateOf(now);
  const period = currentPeriod(PAY_PERIOD_ANCHOR, today);

  // Their own punches, not `listTimePunchesBetween` — that scans the whole fleet to
  // show one person their own list. Filtering in memory is right here: a crew
  // member's punch history is bounded by how long they've worked, not by the fleet.
  const mine = await repo.listTimePunchesForCrew(crewMemberId);

  const open = mine.find((p) => p.outAt === null) ?? null;
  const onTheClock: OnTheClock | null = open
    ? {
        punchId: open.id,
        sinceDate: vesselDateOf(new Date(open.inAt)),
        sinceTime: vesselClockOf(new Date(open.inAt)),
        startedOnAnEarlierDay: vesselDateOf(new Date(open.inAt)) < today,
      }
    : null;

  // Bucketed by the VESSEL-LOCAL date of `inAt` (§2.9.6, DEC-032) — an 8pm Eastern
  // punch is already tomorrow in UTC, and bucketing on that would move hours between
  // paychecks on the last day of every period.
  const rows = mine
    .filter((p) => {
      const date = vesselDateOf(new Date(p.inAt));
      return date >= period.start && date <= period.end;
    })
    .map(toRow)
    .sort((a, b) => (a.date === b.date ? b.inTime.localeCompare(a.inTime) : b.date.localeCompare(a.date)));

  return {
    onTheClock,
    period,
    punches: rows,
    totalMinutes: rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
    openCount: rows.filter((r) => r.open).length,
  };
}

function toRow(p: TimePunch): TimePunchRow {
  const inAt = new Date(p.inAt);
  const outAt = p.outAt === null ? null : new Date(p.outAt);
  return {
    id: p.id,
    date: vesselDateOf(inAt),
    inTime: vesselClockOf(inAt),
    outTime: outAt === null ? null : vesselClockOf(outAt),
    // Instants, so this is TRUE elapsed time — a punch spanning a DST transition
    // reports the hours actually worked, not the hours the wall clock advanced.
    //
    // NOT rounded. §2.9.6 is explicit: no rounding policy, "not to the quarter hour,
    // not to the nearest five minutes, in neither direction." Both ends are stamped
    // at button-press, so a real punch essentially never lands on a whole minute —
    // rounding here would put a silent ±30s into the one number this file elsewhere
    // calls exact. Precision is lost once, at the edge, in `fmtMinutes`.
    minutes: outAt === null ? null : (outAt.getTime() - inAt.getTime()) / MINUTE_MS,
    open: outAt === null,
    adminTouched: p.origin === "admin" || p.adminEditedAt !== null,
  };
}
