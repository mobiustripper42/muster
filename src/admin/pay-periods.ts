/**
 * Biweekly pay periods (#347) — ported VERBATIM from the sibling `xola-tip-extractor`
 * (`public/index.html`), so the payroll report and the tip tool name the exact same
 * periods for the exact same dates (the operator reconciles hours against tips).
 *
 * A period is a 14-day span `[start, start+13]` (inclusive), phased off a known
 * anchor period-start (`PAY_PERIOD_ANCHOR`). All math is date-only at UTC midnight —
 * `YYYY-MM-DD` in, `YYYY-MM-DD` out — so it never drifts with the server zone.
 * Pure (no `now`): the surface passes today.
 */

const DAY_MS = 86_400_000;
const PERIOD_MS = 14 * DAY_MS;

/** `YYYY-MM-DD` of a UTC-midnight Date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PayPeriod {
  /** `YYYY-MM-DD`, inclusive start. */
  start: string;
  /** `YYYY-MM-DD`, inclusive end (start + 13 days). */
  end: string;
}

/**
 * The biweekly period containing `todayISO` — walk 14-day steps from the anchor to
 * the window that contains today. (Extractor's `currentPeriod`.)
 */
export function currentPeriod(anchorISO: string, todayISO: string): PayPeriod {
  const anchor = new Date(anchorISO + "T00:00:00Z");
  const t = new Date(todayISO + "T00:00:00Z");
  const days = Math.floor((t.getTime() - anchor.getTime()) / DAY_MS);
  const periodsIn = Math.max(0, Math.floor(days / 14));
  const start = new Date(anchor.getTime() + periodsIn * PERIOD_MS);
  const end = new Date(start.getTime() + 13 * DAY_MS);
  return { start: isoDay(start), end: isoDay(end) };
}

/**
 * Every biweekly period that intersects `year`, walking 14-day steps from the
 * aligned anchor — includes the boundary periods that straddle Jan 1 / Dec 31.
 * (Extractor's `periodsForYear`.)
 */
export function periodsForYear(anchorISO: string, year: number): PayPeriod[] {
  const anchor = new Date(anchorISO + "T00:00:00Z").getTime();
  const yStart = Date.UTC(year, 0, 1);
  const yEnd = Date.UTC(year, 11, 31);
  let s = anchor + Math.floor((yStart - anchor) / PERIOD_MS) * PERIOD_MS; // first start ≤ Jan 1
  const out: PayPeriod[] = [];
  for (; s <= yEnd; s += PERIOD_MS) {
    const e = s + 13 * DAY_MS;
    if (e >= yStart) out.push({ start: isoDay(new Date(s)), end: isoDay(new Date(e)) });
  }
  return out;
}

/** "May 25 – Jun 7" — short, no year (the picker is scoped to one year). Extractor's
 *  `periodLabel`; UTC-formatted so the stored calendar dates show verbatim. */
export function periodLabel(p: PayPeriod): string {
  const f = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${f(p.start)} – ${f(p.end)}`;
}
