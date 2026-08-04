import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { buildPayrollReport, type PayrollRow } from "@core/admin/payroll.js";
import { buildGratuityPayroll, type GratuityPayroll } from "@core/admin/gratuity-payroll.js";
import {
  buildPayrollReconcile,
  type PayrollReconcile,
} from "@core/admin/payroll-reconcile.js";
import { currentPeriod, periodsForYear, periodLabel } from "@core/admin/pay-periods.js";
import { PAY_PERIOD_ANCHOR, vesselDateOf } from "@core/config/tenant.js";
import { readSubject } from "../../../lib/auth";
import { timeClockEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";

/**
 * /admin/payroll (#347, then 13.4/#628) — what you send to payroll for a pay period.
 *
 * **Two shapes, one route.** With `TIME_CLOCK` off this is what it always was: estimated hours
 * from Confirmed seats (DEC-041) beside the Gusto tips export. With it on, the estimate gains its
 * counterpart — **actual punched hours** — and the page becomes a reconcile: the two side by
 * side with the delta, because the estimate earns its keep exactly when the two disagree
 * (SPEC §2.9.7).
 *
 * **Rows are a UNION.** Somebody with a Confirmed seat and no punch shows actual `0h`; somebody
 * who punched with no seat shows estimate `0h`. Those two rows are the whole reason to look at
 * this screen, so neither side may drop them.
 *
 * **An open punch blocks the export** (§2.9.6, operator 2026-08-02). Not a caveat printed beside
 * a file that downloads anyway — the download is not offered, and the route refuses too. Each
 * open punch links straight to the repair bench that can close it.
 */

export const dynamic = "force-dynamic";

type Search = { period?: string };

/** minutes → "12h 30m". Floors the minute — display only; stored data keeps its seconds (§2.9.6). */
const hoursLabel = (min: number) => `${Math.floor(min / 60)}h ${Math.floor(min % 60)}m`;
/** A signed delta — "+45m", "−1h 20m", "even". */
function deltaLabel(min: number): string {
  if (Math.abs(min) < 1) return "even";
  return `${min > 0 ? "+" : "−"}${hoursLabel(Math.abs(min))}`;
}
/** cents → "$124.75". */
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function AdminPayroll({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const timeClock = timeClockEnabled();
  const today = vesselDateOf(new Date());
  const cur = currentPeriod(PAY_PERIOD_ANCHOR, today);
  const periods = periodsForYear(PAY_PERIOD_ANCHOR, Number(today.slice(0, 4)));

  // Selected period from ?period=start|end, else the current one. Validate the shape
  // (mirrors the all-shifts isDate idiom) so a garbled param falls back to current
  // instead of rendering "Invalid Date" and running over an arbitrary window.
  const [selFrom, selTo] = (sp.period ?? "").split("|");
  const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const sel = isDate(selFrom) && isDate(selTo) ? { start: selFrom, end: selTo } : cur;
  const selValue = `${sel.start}|${sel.end}`;

  let rows: PayrollRow[] = [];
  let tips: GratuityPayroll = { rows: [], warnings: [], totalCents: 0 };
  let rec: PayrollReconcile | null = null;
  try {
    if (timeClock) {
      rec = await buildPayrollReconcile(getRepo(), { from: sel.start, to: sel.end });
    } else {
      [rows, tips] = await Promise.all([
        buildPayrollReport(getRepo(), { from: sel.start, to: sel.end }),
        buildGratuityPayroll(getRepo(), { from: sel.start, to: sel.end }),
      ]);
    }
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t build the payroll report right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
  const totalShifts = rows.reduce((s, r) => s + r.shiftCount, 0);

  return (
    <Shell width="3xl">
      <h1 className="text-xl font-semibold text-ink">Payroll hours</h1>
      <p className="text-sm text-muted">
        {timeClock
          ? "Punched hours for a pay period, beside the scheduled estimate. Where they disagree, the clock is what gets paid — the estimate is the cross-check."
          : "Estimated hours per crew member for a pay period — the committed shift window (call time to off the clock) of every shift they were assigned. A gut-check against timesheets, not a punch clock. Assigned crew only (no trainee rides)."}
      </p>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="period" className="text-xs text-muted">
            Pay period
          </label>
          <select
            id="period"
            name="period"
            defaultValue={selValue}
            className="min-h-[44px] rounded-card border border-line bg-card px-3 text-ink"
          >
            {periods.map((p) => {
              const v = `${p.start}|${p.end}`;
              return (
                <option key={v} value={v}>
                  {periodLabel(p)}
                  {p.start === cur.start ? " — current" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <GetFormSubmit className="min-h-[44px] rounded-card bg-accent px-4 font-semibold text-white">
          View
        </GetFormSubmit>
      </form>

      {rec ? (
        <ReconcileSection rec={rec} selValue={selValue} periodLabelText={periodLabel(sel)} />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {periodLabel(sel)} · {rows.length} {rows.length === 1 ? "person" : "people"}
            </h2>
            {rows.length === 0 ? (
              <Notice>No assigned shifts in this period.</Notice>
            ) : (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-card text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-semibold">Crew</th>
                      <th className="px-4 py-2 text-right font-semibold">Shifts</th>
                      <th className="px-4 py-2 text-right font-semibold">Est. hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.crewMemberId} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-ink">{r.name}</td>
                        <td className="px-4 py-2 text-right font-mono text-muted">{r.shiftCount}</td>
                        <td className="px-4 py-2 text-right font-mono text-ink">{hoursLabel(r.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-card font-semibold">
                      <td className="px-4 py-2 text-ink">Total</td>
                      <td className="px-4 py-2 text-right font-mono text-muted">{totalShifts}</td>
                      <td className="px-4 py-2 text-right font-mono text-ink">{hoursLabel(totalMin)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Tips (Gusto) · {money(tips.totalCents)}
              </h2>
              {tips.rows.length > 0 && (
                <a
                  href={`/admin/payroll/tips.csv?period=${encodeURIComponent(selValue)}`}
                  className="min-h-[36px] rounded-card border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink"
                >
                  Download Gusto CSV
                </a>
              )}
            </div>
            {tips.warnings.length > 0 && (
              <Notice>
                <ul className="list-disc pl-4">
                  {tips.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {tips.rows.length === 0 ? (
              <Notice>No Muster-side tips in this period.</Notice>
            ) : (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-card text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-semibold">Crew</th>
                      <th className="px-4 py-2 font-semibold">Gusto</th>
                      <th className="px-4 py-2 text-right font-semibold">Tips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tips.rows.map((r) => (
                      <tr key={r.crewMemberId} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-ink">{r.name}</td>
                        <td className="px-4 py-2 text-xs text-muted">
                          {r.gusto ? r.gusto.employeeId : "— not mapped —"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-ink">{money(r.tipCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-card font-semibold">
                      <td className="px-4 py-2 text-ink" colSpan={2}>
                        Total
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-ink">{money(tips.totalCents)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

/** The 13.4 reconcile: estimate vs actual vs tips, and the gate on the export. */
function ReconcileSection({
  rec,
  selValue,
  periodLabelText,
}: {
  rec: PayrollReconcile;
  selValue: string;
  periodLabelText: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {periodLabelText} · {rec.rows.length} {rec.rows.length === 1 ? "person" : "people"}
        </h2>
        {rec.rows.length > 0 &&
          (rec.exportBlocked ? (
            // No button at all. A disabled control invites a hunt for the way to enable it; the
            // notice below says what to do instead.
            <span className="text-sm text-muted">Export unavailable</span>
          ) : (
            <a
              href={`/admin/payroll/gusto.csv?period=${encodeURIComponent(selValue)}`}
              className="min-h-[36px] rounded-card border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink"
            >
              Download Gusto CSV
            </a>
          ))}
      </div>

      {rec.exportBlocked && (
        <Notice tone="bad">
          <p className="font-semibold">
            {rec.openCount === 1
              ? "Someone is still on the clock in this period."
              : `${rec.openCount} punches in this period are still open.`}
          </p>
          <p>
            These hours are incomplete, so the payroll file can’t be built yet. Close each one on
            the time clock — Muster never guesses when somebody went home.
          </p>
          <ul className="mt-1 list-disc pl-4">
            {rec.rows
              .filter((r) => r.openCount > 0)
              .map((r) => (
                <li key={r.crewMemberId}>
                  <a
                    className="underline"
                    href={`/admin/time-clock?crew=${encodeURIComponent(r.crewMemberId)}&period=${encodeURIComponent(selValue)}`}
                  >
                    {r.name ?? r.crewMemberId}
                  </a>{" "}
                  — {r.openCount} open
                </li>
              ))}
          </ul>
        </Notice>
      )}

      {/*
       * Missing days (#638) — `warn`, not `bad`, and deliberately no effect on the export. An
       * open punch is an error with a guaranteed fix: a human closes it and the block clears.
       * A missing day may simply be true — the person didn't work — so there is no action that
       * always resolves it, and blocking payroll for the whole crew on one no-show would leave
       * the operator stuck. It reads as something to check, because that is what it is.
       */}
      {rec.missingCount > 0 && (
        <Notice tone="warn">
          <p className="font-semibold">
            {rec.missingCount === 1
              ? "One shift in this period has no punch against it."
              : `${rec.missingCount} shifts in this period have no punch against them.`}
          </p>
          <p>
            Someone held a confirmed seat and never clocked in, so their hours read zero. That may
            be right — check each day and add the punch on the time clock if it isn’t.
          </p>
          <ul className="mt-1 list-disc pl-4">
            {rec.rows
              .filter((r) => r.missingDays.length > 0)
              .map((r) => (
                <li key={r.crewMemberId}>
                  {r.name ?? r.crewMemberId} —{" "}
                  {r.missingDays.map((d, i) => (
                    <span key={d}>
                      {i > 0 && ", "}
                      <a
                        className="underline"
                        href={`/admin/time-clock?day=${encodeURIComponent(d)}`}
                      >
                        {d}
                      </a>
                    </span>
                  ))}
                </li>
              ))}
          </ul>
        </Notice>
      )}

      {rec.warnings.length > 0 && (
        <Notice>
          <ul className="list-disc pl-4">
            {rec.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      {rec.rows.length === 0 ? (
        <Notice>No hours and no assigned shifts in this period.</Notice>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-card text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-semibold">Crew</th>
                <th className="px-4 py-2 text-right font-semibold">Est.</th>
                <th className="px-4 py-2 text-right font-semibold">Actual</th>
                <th className="px-4 py-2 text-right font-semibold">Δ</th>
                <th className="px-4 py-2 text-right font-semibold">Tips</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rec.rows.map((r) => (
                <tr key={r.crewMemberId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink">
                    {r.name ?? <span className="text-muted">(unknown crew)</span>}
                    {/* Provenance is visible (§2.9.8): hours nobody tapped must never look
                        identical to hours they did. */}
                    {r.touchedByAdmin && (
                      <span className="ml-2 text-xs text-muted" title="Entered or edited by the office">
                        office-edited
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted">
                    {hoursLabel(r.estimateMinutes)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-ink">
                    {hoursLabel(r.actualMinutes)}
                    {r.openCount > 0 && (
                      <span className="ml-2 text-xs text-bad">+{r.openCount} open</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted">
                    {deltaLabel(r.deltaMinutes)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted">{money(r.tipCents)}</td>
                  <td className="px-4 py-2 text-right">
                    <a
                      className="text-xs text-muted underline"
                      href={`/admin/time-clock?crew=${encodeURIComponent(r.crewMemberId)}&period=${encodeURIComponent(selValue)}`}
                    >
                      Time clock
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-card font-semibold">
                <td className="px-4 py-2 text-ink">Total</td>
                <td className="px-4 py-2 text-right font-mono text-muted">
                  {hoursLabel(rec.totalEstimateMinutes)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-ink">
                  {hoursLabel(rec.totalActualMinutes)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted">
                  {deltaLabel(rec.totalActualMinutes - rec.totalEstimateMinutes)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-ink">
                  {money(rec.totalTipCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
