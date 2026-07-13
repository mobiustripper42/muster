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

import { asId } from "../domain/ids.js";
import type { RoleTypeId } from "../domain/ids.js";

/**
 * The vessel/tenant IANA timezone. Env-overridable (`TENANT_TZ`);
 * tenant-config-later (DEC-032, DEC-001). One fleet today (BrewBoat, Eastern).
 */
export const TENANT_TIMEZONE: string = process.env.TENANT_TZ ?? "America/New_York";

/**
 * Guest pickup location (#345) — hard-coded because BrewBoat runs from ONE spot
 * today. When the tenant gets per-event pickups (their own reservation system,
 * operator's note), this moves onto `Event` and the intro-text builder reads it
 * per trip instead of this constant. Env-overridable meanwhile.
 * `PICKUP_LOCATION` is the human string dropped in the guest text; `PICKUP_MAP_URL`
 * is the exact Google Maps pin the text links to.
 */
export const PICKUP_LOCATION: string =
  process.env.PICKUP_LOCATION ?? "Canal Basin Park near Flatiron Cafe";
export const PICKUP_MAP_URL: string =
  process.env.PICKUP_MAP_URL ?? "https://maps.app.goo.gl/A2vG7Q9LjKdZJpod9";

/**
 * Biweekly payroll anchor — a known period START, phasing the 14-day pay periods
 * the payroll report (#347) lists. Ported to match the sibling `xola-tip-extractor`
 * EXACTLY (its `PAY_PERIOD_ANCHOR` env + `DEFAULT_ANCHOR` fallback), so both tools
 * name the same periods for the same dates. Env-overridable to track the live
 * payroll calendar; default `2026-01-05` (the extractor's aligned fallback:
 * …, 5/25–6/7, 6/8–6/21, …).
 */
export const PAY_PERIOD_ANCHOR: string =
  process.env.PAY_PERIOD_ANCHOR ?? "2026-01-05";

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
 * Add `n` (possibly negative) days to a "YYYY-MM-DD" string. Pure, UTC-anchored —
 * day arithmetic on a date-only string has no time-of-day, so UTC is exact here
 * (unlike deriving the *current* date from an instant, which needs `vesselDateOf`).
 * `src/import/xola-pull.ts` keeps a local twin for the pull window; consolidating
 * the two is a future cleanup, not this task.
 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Role precedence (#148, DEC-066), **most-senior first** — tenant data, tune-later
 * like the timezone (DEC-001). The pilot fleet's two roles: a captain outranks a
 * mate. Used **only to decide who gets _asked_**: a crew member is never auto-asked
 * or leaned for a seat below a role they also hold, so a captain (rated
 * `[captain, mate]`) is never asked for a mate seat — they stay manually assignable
 * via the cockpit override (DEC-064). A role absent from this list is unranked: it
 * imposes no over-qualification rule. This is an **ask-routing preference**, NOT a
 * domain hierarchy (DEC-ROLE-1's flat roles stand) and NOT an eligibility gate (the
 * oracle still counts a captain as able to crew a mate seat).
 */
export const ROLE_PRECEDENCE: readonly RoleTypeId[] = [
  asId<"RoleTypeId">("role-captain"),
  asId<"RoleTypeId">("role-mate"),
];

/**
 * A positive-ms env knob with a fallback. Non-numeric / non-positive env values
 * fall back rather than poison the default — a fat-fingered override degrades to
 * the researched value instead of disabling the window. The env value must be a
 * **plain integer of milliseconds**: `90000`, not `90_000` — `Number("90_000")`
 * is `NaN` (no JS numeric separators in env strings) and silently falls back.
 */
function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

/**
 * A positive-**integer** env knob with a fallback (same poison-resistance as
 * `envMs`, but for counts rather than milliseconds — a fractional or non-positive
 * override degrades to the default). Integer-only, same as the DEC-060 windows.
 */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
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
 * websocket lands. Invariant: must exceed `DOORBELL_BATCH_WINDOW_MS` — `envMs`
 * validates each value in isolation, so this cross-field check is **not** enforced
 * here (a no-throw config module); the 6.4 decider validates the combined pair at
 * startup (#114).
 */
export const DOORBELL_PRESENCE_WINDOW_MS: number = envMs(
  "DOORBELL_PRESENCE_WINDOW_MS",
  300_000,
);

/**
 * **Short-notice content-carry threshold** (§7.5, the 6.4 decider) — at or under
 * this body length a *lone* unread doorbell SMS carries the message text inline
 * ("slip B, call 12:30"), no app trip; longer or batched → an "N new" summary.
 * 160 = one GSM-7 SMS segment: if the note fits a single text, send the text.
 * Env-overridable, tune-on-real-use (DEC-068); the decider reads it via
 * `DoorbellRules`. Sibling to the DEC-060 windows.
 */
export const DOORBELL_SHORT_NOTICE_MAX_CHARS: number = envPositiveInt(
  "DOORBELL_SHORT_NOTICE_MAX_CHARS",
  160,
);

// ── Civil send window (DEC-088, 9.9) ─────────────────────────────────────────

/**
 * A wall-clock "HH:MM" env knob with a fallback — the `envMs` poison-resistance
 * posture: a malformed value degrades to the researched default rather than
 * throwing (a thrown config error here would kill the cron route and silence
 * the whole engine).
 */
export function envWallClock(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;
  console.error(`[tenant] ${name}="${raw}" is not HH:MM — using ${fallback}`);
  return fallback;
}

const CIVIL_DEFAULT_START = "08:00";
const CIVIL_DEFAULT_END = "20:00";
const civilStartRaw = envWallClock("CIVIL_SEND_START", CIVIL_DEFAULT_START);
const civilEndRaw = envWallClock("CIVIL_SEND_END", CIVIL_DEFAULT_END);
// Inverted/equal pair (incl. an overnight window like 22:00–06:00, unsupported
// in the slice) degrades to the defaults as a PAIR — never throws.
const civilInverted = civilStartRaw >= civilEndRaw;
if (civilInverted) {
  console.error(
    `[tenant] CIVIL_SEND_START ${civilStartRaw} >= CIVIL_SEND_END ${civilEndRaw} — using ${CIVIL_DEFAULT_START}–${CIVIL_DEFAULT_END}`,
  );
}

/**
 * The civil send window (DEC-088): vessel-local wall-clock bounds outside which
 * the engine's OWN initiative defers its ask sends (tick drip/blast/escalate,
 * bail/vacate re-asks). Half-open [start, end) per the DEC-083 precedent —
 * 08:00 fires, 20:00 doesn't. Operator-explicit sends are never gated.
 */
export const CIVIL_SEND_START: string = civilInverted
  ? CIVIL_DEFAULT_START
  : civilStartRaw;
export const CIVIL_SEND_END: string = civilInverted
  ? CIVIL_DEFAULT_END
  : civilEndRaw;

/** Vessel-local wall-clock "HH:MM" of an instant (DST-immune via Intl, DEC-032). */
export function vesselClockOf(at: Date, tz: string = TENANT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/**
 * Is `now` inside the civil send window, vessel-local? Pure given its inputs;
 * `window` is injectable for tests (defaults to the tenant constants).
 */
export function withinCivilWindow(
  now: Date,
  tz: string = TENANT_TIMEZONE,
  window?: { start: string; end: string },
): boolean {
  const clock = vesselClockOf(now, tz);
  const start = window?.start ?? CIVIL_SEND_START;
  const end = window?.end ?? CIVIL_SEND_END;
  return clock >= start && clock < end;
}
