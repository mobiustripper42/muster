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
 * Method: read the wall-clock as if UTC (a first guess), subtract the zone's
 * offset at that guess to get a candidate, then **re-measure the offset at the
 * candidate** and subtract that — a two-pass fix. The second pass is what makes
 * the morning of the spring-forward day correct: a 03:00–06:59 wall-clock whose
 * UTC-guess still sits before the transition would otherwise pick up the stale
 * pre-DST offset (off by an hour). The only residue is the 1-hour spring-forward
 * *gap* (02:00–02:59, a wall-clock that doesn't exist), which resolves forward
 * and which vessel departures never schedule into — accepted per DEC-032.
 */
export function zonedWallClockToInstant(
  date: string,
  time: string,
  tz: string = TENANT_TIMEZONE,
): Date {
  const guess = new Date(`${date}T${time}:00.000Z`);
  const candidate = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  return new Date(guess.getTime() - tzOffsetMs(candidate, tz));
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

/**
 * A positive-ms env knob with a fallback. Non-numeric / non-positive env values
 * fall back rather than poison the default — a fat-fingered override degrades to
 * the researched value instead of disabling the window.
 */
function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

/**
 * Doorbell window defaults — the 6.3 spike, **DEC-060**. Two distinct knobs,
 * both env-overridable and tune-on-real-use; tenant-config data later (same
 * posture as `TENANT_TIMEZONE` / DEC-001, DEC-046's operator-config doorbell).
 *
 * **Batch / cancel window** (§7.2) — how long a pending *non-priority*
 * notification is held before it rings, grouping a flurry into one ping. The
 * hold doubles as the cancel-on-read window: open the thread inside it and the
 * SMS is cancelled. 90 s — Slack's explicit-leave push delay (~1 min), the ~90 s
 * SMS response cadence, and the 1–2 min debounce norm; longer than the artifact's
 * "~1 min" placeholder buys batch/cancel headroom (every cancel saves a send) at
 * trivial latency cost, and priority bypasses entirely (§7.4) so urgency isn't held.
 */
export const DOORBELL_BATCH_WINDOW_MS: number = envMs(
  "DOORBELL_BATCH_WINDOW_MS",
  90_000,
);

/**
 * **Presence-staleness window** (§7.1) — how recently a subject must have been
 * observed active to count as "present" and *suppress* a ring (the window
 * `isPresent` takes as a param). 5 min — pulled under the ~10 min passive-idle
 * peers (Slack cursor-idle, Discord idle) because presence is narrow + fails
 * toward ringing, but kept well above the batch window: the coarse observed
 * signal (DEC-046, no socket yet) emits nothing while a crew member *reads* a
 * thread without tapping, so a shorter window would text someone staring at the
 * message — breaking the keystone. Collapses toward realtime when DEC-047's
 * websocket lands. Invariant: must exceed `DOORBELL_BATCH_WINDOW_MS`.
 */
export const DOORBELL_PRESENCE_WINDOW_MS: number = envMs(
  "DOORBELL_PRESENCE_WINDOW_MS",
  300_000,
);
