import { BackLink } from "../../../../components/ui/back-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { buildPayrollReport, type PayrollRow } from "@core/admin/payroll.js";
import { currentPeriod, periodsForYear, periodLabel } from "@core/admin/pay-periods.js";
import { PAY_PERIOD_ANCHOR, vesselDateOf } from "@core/config/tenant.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * /admin/payroll (#347) — estimated hours per crew member for a biweekly pay period,
 * to sanity-check against timesheets during payroll. Pick a period (the same periods
 * the sibling xola-tip-extractor uses, so hours reconcile against tips), see each
 * assigned crew member's committed shift-window hours (DEC-041). Read-only, no data.
 */

export const dynamic = "force-dynamic";

type Search = { period?: string };

/** minutes → "12h 30m". */
const hoursLabel = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

export default async function AdminPayroll({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

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

  let rows: PayrollRow[];
  try {
    rows = await buildPayrollReport(getRepo(), { from: sel.start, to: sel.end });
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
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Payroll hours</h1>
      <p className="text-sm text-muted">
        Estimated hours per crew member for a pay period — the committed shift window
        (call time to off the clock) of every shift they were assigned. A gut-check
        against timesheets, not a punch clock. Assigned crew only (no trainee rides).
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
    </Shell>
  );
}