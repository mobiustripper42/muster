/**
 * Payroll reconcile (13.4, #628) — the estimate and the punch clock in one table, and the ONE
 * Gusto file that carries both hours and tips.
 *
 * **Why a union and not a join.** `buildPayrollReport` knows who was *scheduled*;
 * `buildTimeClockReport` knows who *punched*; `buildGratuityPayroll` knows who earned tips. The
 * rows that matter most are the ones present on only one side — someone who held a Confirmed
 * seat and never clocked in reads as zero hours, and someone who punched with no seat is work
 * the schedule can't explain but is still owed (§2.9.2). An inner join would hide exactly the
 * disagreements the surface exists to surface. So: union, and the delta is the thing you read.
 *
 * **An open punch blocks the export** (§2.9.6, operator 2026-08-02). This is a deliberate
 * hardening of the original rule, which excluded open punches from the total and counted them
 * separately on the grounds that "a number the recipient can see is incomplete beats a number
 * that is silently short." True as far as it goes — but a warning printed beside a file that
 * still downloads is a file that still gets sent, and the number inside it is still short. Any
 * open punch when reconciling is an error needing attention, so {@link gustoPayrollCsv} refuses
 * to build rather than trusting a caller to have read `exportBlocked`.
 *
 * Pure reads over the port, composed from the three existing reports rather than re-deriving
 * anything — the estimate's seat rules, the clock's bucketing and the tip split each stay in one
 * place.
 */

import type { GustoIdentity } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { buildGratuityPayroll } from "./gratuity-payroll.js";
import { GUSTO_CSV_HEADER } from "./gratuity-payroll.js";
import { decimalHours } from "./hours-format.js";
import { buildPayrollReport } from "./payroll.js";
import { buildTimeClockReport } from "./time-clock-report.js";

export interface ReconcileRow {
  crewMemberId: string;
  /** Null when the id resolves to nobody — render nameless rather than drop owed hours. */
  name: string | null;
  /** Scheduled/committed minutes from Confirmed required seats (DEC-041). 0 if unscheduled. */
  estimateMinutes: number;
  /** True elapsed minutes from CLOSED punches, unrounded. 0 if they never punched. */
  actualMinutes: number;
  /** `actual − estimate`. Negative reads as "worked less than scheduled". */
  deltaMinutes: number;
  /** Punches still open in this window — hours this row does NOT yet contain. */
  openCount: number;
  /**
   * Vessel-local days they held a paid seat and have no punch at all (#638), ascending.
   * The estimate row already shows the shortfall as a negative delta; this says WHICH days,
   * so an eight-hour gap reads as one missed shift or four partial ones rather than a number
   * the operator has to reconstruct a fortnight later.
   */
  /**
   * Days this person holds two punches covering a shared minute (#645), ascending. Closed
   * punches only. Unlike `missingDays`, these BLOCK the export — an overlap is never legitimate
   * and editing or deleting either punch always clears it.
   */
  overlapDays: string[];
  missingDays: string[];
  /** An admin entered or edited at least one of these punches (§2.9.8). */
  touchedByAdmin: boolean;
  tipCents: number;
  /** Absent ⇒ no Gusto mapping — warned, and excluded from the file. */
  gusto?: GustoIdentity;
}

export interface PayrollReconcile {
  window: { from: string; to: string };
  rows: ReconcileRow[];
  totalEstimateMinutes: number;
  totalActualMinutes: number;
  totalTipCents: number;
  /** Open punches anywhere in the window. */
  openCount: number;
  /**
   * Seat-days with no punch, across everyone (#638) — **counted, never blocking**
   * (operator, 2026-08-03). An open punch blocks the export because closing it always clears
   * the block; a missing day has no such action, since the person may genuinely not have
   * worked. Gating the file on it would stop payroll for the whole crew over one no-show,
   * with nothing the operator could do to release it. Flagged in the UI, linked to the bench.
   */
  missingCount: number;
  /**
   * Days with overlapping punches, across everyone (#645). **Blocks the export**, unlike
   * `missingCount`. The rule is whether a guaranteed action clears the condition: editing or
   * deleting one of two overlapping punches always does, exactly as closing an open punch does.
   * A missing day may simply be true, so nothing the operator does is guaranteed to clear it.
   */
  overlapCount: number;
  /** `openCount > 0 || overlapCount > 0`. Deliberately NOT `missingCount`. */
  exportBlocked: boolean;
  warnings: string[];
}

/**
 * Why the file was refused, in the operator's terms.
 *
 * Reason-specific rather than one constant. "Close it on /admin/time-clock" is actively wrong
 * advice for an overlap — there is nothing open to close — and a message that names the wrong
 * problem costs more than a generic one, because it sends someone looking for something that
 * isn't there. Kept exported under the old name for the route, which has no reason to know.
 */
export function exportBlockedMessage(r: Pick<PayrollReconcile, "openCount" | "overlapCount">): string {
  const reasons: string[] = [];
  if (r.openCount > 0) {
    reasons.push(
      r.openCount === 1
        ? "one punch is still open"
        : `${r.openCount} punches are still open`,
    );
  }
  if (r.overlapCount > 0) {
    reasons.push(
      r.overlapCount === 1
        ? "one day has overlapping punches"
        : `${r.overlapCount} days have overlapping punches`,
    );
  }
  // Plain " and " — there are only ever two reasons, so a serial comma reads as a truncated list
  // ("one punch is still open, and one day has overlapping punches").
  return `Refusing to build the payroll file: ${reasons.join(" and ")}. Fix it on /admin/time-clock first.`;
}

export async function buildPayrollReconcile(
  repo: Repository,
  window: { from: string; to: string },
): Promise<PayrollReconcile> {
  const [estimate, actual, tips, crew] = await Promise.all([
    buildPayrollReport(repo, window),
    buildTimeClockReport(repo, window),
    buildGratuityPayroll(repo, window),
    repo.listCrewMembers(),
  ]);

  const byId = new Map(crew.map((c) => [String(c.id), c]));
  const estById = new Map(estimate.map((r) => [r.crewMemberId, r]));
  const actById = new Map(actual.rows.map((r) => [r.crewMemberId, r]));
  const tipById = new Map(tips.rows.map((r) => [r.crewMemberId, r]));

  // The union — every id any of the three knows about.
  const ids = new Set([...estById.keys(), ...actById.keys(), ...tipById.keys()]);

  const warnings = [...tips.warnings];
  const rows: ReconcileRow[] = [...ids].map((id) => {
    const est = estById.get(id);
    const act = actById.get(id);
    const tip = tipById.get(id);
    const member = byId.get(id);
    // Resolve the name ONCE, from the roster. The fallback chain used to reach into the
    // estimate row, which defaults its own unresolved names to the literal string "(unknown)"
    // (`payroll.ts`) — so an estimate-only orphan rendered that string as plain ink while a
    // punch-only orphan rendered the styled "(unknown crew)". Two spellings of "nobody knows
    // this person" for no reason. All three sources read the same roster, so neither fallback
    // could ever supply a name this doesn't.
    const name = member?.name ?? null;
    const estimateMinutes = est?.minutes ?? 0;
    const actualMinutes = act?.minutes ?? 0;

    // The set difference. Both sides arrive already bucketed on the vessel-local calendar by
    // the module that owns their rules — `payroll.ts` the seat filter, `time-clock-report.ts`
    // the punch bucketing — so this is the join and nothing more. Neither rule is re-applied
    // here, which is the point of doing it in the module that already reads both.
    const punched = new Set(act?.days ?? []);
    const missingDays = (est?.days ?? []).filter((d) => !punched.has(d));

    return {
      crewMemberId: id,
      name,
      estimateMinutes,
      actualMinutes,
      deltaMinutes: actualMinutes - estimateMinutes,
      openCount: act?.openCount ?? 0,
      overlapDays: act?.overlapDays ?? [],
      missingDays,
      touchedByAdmin: act?.touchedByAdmin ?? false,
      tipCents: tip?.tipCents ?? 0,
      ...(member?.gusto ? { gusto: member.gusto } : {}),
    };
  });

  // Warn per row that can't import. `buildGratuityPayroll` already warns about unmapped crew
  // with TIPS; this catches the ones with HOURS, which is the new half.
  //
  // Gated on ACTUAL hours, not the estimate: an unmapped crew member who was scheduled and never
  // punched would export 0.00 anyway, so warning about them is noise on a surface whose warnings
  // need to mean "money is about to go missing".
  for (const r of rows) {
    if (!r.gusto?.employeeId && r.actualMinutes > 0) {
      warnings.push(
        `${r.name ?? r.crewMemberId} has hours but no Gusto mapping — row won't be in the file`,
      );
    }
  }

  rows.sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿"));

  const openCount = rows.reduce((s, r) => s + r.openCount, 0);
  const overlapCount = rows.reduce((s, r) => s + r.overlapDays.length, 0);
  return {
    window,
    rows,
    totalEstimateMinutes: rows.reduce((s, r) => s + r.estimateMinutes, 0),
    totalActualMinutes: rows.reduce((s, r) => s + r.actualMinutes, 0),
    totalTipCents: rows.reduce((s, r) => s + r.tipCents, 0),
    openCount,
    missingCount: rows.reduce((s, r) => s + r.missingDays.length, 0),
    overlapCount,
    exportBlocked: openCount > 0 || overlapCount > 0,
    warnings,
  };
}

// ── The Gusto file ───────────────────────────────────────────────────────────

/** RFC-4180 field escape — quote if it contains a comma, quote, or newline. */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The ONE Gusto timesheet CSV — identity, `regular_hours` and `paycheck_tips` on a single row
 * (operator, 2026-08-02: "gusto file should be hours and tips"). Same 15-column header the tips
 * export already uses, so it imports the same way.
 *
 * Rows with no Gusto identity are excluded — they can't import, and a keyless row is worse than
 * an absent one because it looks like data. They surface as `warnings` on the page instead.
 *
 * **Throws when `exportBlocked`.** The guard lives here rather than only at the route so it
 * cannot be forgotten by the next caller; an open punch means these hours are incomplete, and an
 * incomplete payroll file is the failure this whole phase exists to prevent.
 */
export function gustoPayrollCsv(r: PayrollReconcile): string {
  if (r.exportBlocked) throw new Error(exportBlockedMessage(r));

  const lines = [GUSTO_CSV_HEADER];
  for (const row of r.rows) {
    if (!row.gusto?.employeeId) continue;
    lines.push(
      [
        csvField(row.gusto.lastName),
        csvField(row.gusto.firstName),
        csvField(row.gusto.title),
        csvField(row.gusto.employeeId),
        decimalHours(row.actualMinutes), // regular_hours
        "", "", "", "", "", // overtime…commission
        (row.tipCents / 100).toFixed(2), // paycheck_tips
        "", "", "", "", // cash_tips…personal_note
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
