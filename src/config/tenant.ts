/**
 * Tenant configuration — the single, tune-later home for per-tenant policy that
 * isn't a database table yet (M1+). Same posture as `STAFFING_HORIZON_LEAD_DAYS`
 * / `FILL_DEADLINE_HOURS` (DEC-001): a code constant now, tenant-config data
 * later. Pure; no dependency beyond the `Intl` global, so it stays in the
 * framework-free core.
 *
 * **Timezone (DEC-032).** Muster stores times as **vessel-local wall-clock**
 * (`Event.date` "YYYY-MM-DD", `Event.time` "HH:mm" — the vessel-day shift
 * grouping depends on it) and interprets + renders them in the **vessel's**
 * timezone, never the viewer's. A captain on the dock and the operator on the
 * phone read the same boat-time, no mental conversion. Env-overridable per
 * deploy via `TENANT_TZ`; defaults to the BrewBoat fleet's zone.
 */

/**
 * The vessel/tenant IANA timezone. Env-overridable (`TENANT_TZ`);
 * tenant-config-later (DEC-032, DEC-001). One fleet today (BrewBoat, Eastern).
 */
export const TENANT_TIMEZONE: string = process.env.TENANT_TZ ?? "America/New_York";

/**
 * Offset (tz-local − UTC) in ms at instant `at`, DST-correct via `Intl`.
 * Negative west of UTC (e.g. −4h for EDT, −5h for EST). Pure.
 */
export function tzOffsetMs(at: Date, tz: string = TENANT_TIMEZONE): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - at.getTime();
}

/**
 * The true UTC instant of a vessel-local wall-clock (`date` "YYYY-MM-DD", `time`
 * "HH:mm") in timezone `tz`, DST-correct. **The DEC-032 mint seam** — every
 * event-departure instant is born here.
 *
 * Method: read the wall-clock as if UTC (a first guess), measure the zone's
 * offset at that guess, subtract it. One pass is exact except inside the 1-hour
 * spring-forward gap (a wall-clock that doesn't exist) — which vessel departures
 * never schedule into, accepted per DEC-032.
 */
export function zonedWallClockToInstant(
  date: string,
  time: string,
  tz: string = TENANT_TIMEZONE,
): Date {
  const guess = new Date(`${date}T${time}:00.000Z`);
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

/**
 * The vessel-local calendar date (`YYYY-MM-DD`) of an instant `at` in `tz` — for
 * "is this shift in the past?" / "today" comparisons against the stored
 * vessel-local `Event.date` (DEC-032). `now.toISOString().slice(0,10)` would use
 * the **UTC** date, which is a day ahead in the evening Eastern hours.
 */
export function vesselDateOf(at: Date, tz: string = TENANT_TIMEZONE): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
