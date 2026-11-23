/**
 * The date window shared by All Shifts and Purchases (issue #1142) — the preset chips, the
 * From/To range and the clamp, resolved by one rule (DEC-042). Lifted out of
 * `app/(admin)/admin/shifts/page.tsx` so both pages read it.
 */

import { addDays, vesselDateOf } from "../config/tenant.js";
import { formatShortDay } from "../reservations/availability-screen.js";

/** The resolved date-window kind — drives the active filter chip + scope label. `past` and
 *  `all` are Purchases-only presets. */
export type Scope =
  | "today"
  | "next7"
  | "weekend"
  | "next8to15"
  | "days30"
  | "range"
  | "past"
  | "all";

export const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Day of week (0=Sun) of an ISO date — UTC read is the calendar day verbatim. */
export function dowOf(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

/** Day-section header: full weekday so a weekend reads at a glance (#122). */
export function fmtDayHeader(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type WindowSearch = { preset?: string | undefined; from?: string | undefined; to?: string | undefined };
type WindowOpts = { allowPast?: boolean; allowAll?: boolean };

/** The presets every page has; `past` and `all` are opted into. */
const SHARED_PRESETS = new Set(["today", "weekend", "next7", "next8to15", "days30"]);

/** Is this a preset the page allows? */
function knownPreset(preset: string | undefined, opts: WindowOpts): preset is Scope {
  if (preset === undefined) return false;
  if (preset === "past") return !!opts.allowPast;
  if (preset === "all") return !!opts.allowAll;
  return SHARED_PRESETS.has(preset);
}

/** The scope label for each preset kind; a `range` is labelled by its days instead. */
const PRESET_SCOPE: Partial<Record<Scope, string>> = {
  weekend: "this weekend",
  next7: "the next 7 days",
  next8to15: "2 weeks out",
  days30: "the next 30 days",
  today: "today",
  past: "the last 30 days",
  all: "all dates",
};

/** The bounds of a preset on the vessel's calendar; `""` is no bound. */
function presetBounds(kind: Scope, today: string): { from: string; to: string } {
  switch (kind) {
    case "today":
      return { from: today, to: today };
    case "weekend": {
      // The current weekend's Sat–Sun: on a Sunday that's yesterday→today; any
      // other day, the coming Saturday and the day after.
      const dow = dowOf(today);
      const sat = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow) % 7);
      return { from: sat, to: addDays(sat, 1) };
    }
    case "next8to15":
      // The bucket AFTER "next 7": today+7 .. today+14, non-overlapping with next7 by
      // construction (starts the day next7 ends + 1).
      return { from: addDays(today, 7), to: addDays(today, 14) };
    case "days30":
      return { from: today, to: addDays(today, 29) };
    case "past":
      // The clamp's floor up to yesterday, both ends included.
      return { from: addDays(today, -30), to: addDays(today, -1) };
    case "all":
      return { from: "", to: "" };
    default:
      // next7: the 7-day week, also the bare default.
      return { from: today, to: addDays(today, 6) };
  }
}

/**
 * Resolve the date window from the filter params — defaulting to the next 7 days, clamped
 * to a sane horizon so "everything" can't render an unbounded wall (DEC-042). `from`/`to` are
 * `""` under `all`.
 */
export function resolveWindow(
  sp: WindowSearch,
  now: Date,
  opts: WindowOpts = {},
): { from: string; to: string; scope: string; kind: Scope } {
  const today = vesselDateOf(now);

  // No date bound, so no clamp either.
  if (sp.preset === "all" && opts.allowAll) {
    return { from: "", to: "", scope: PRESET_SCOPE.all!, kind: "all" };
  }

  let kind: Scope;
  let from: string;
  let to: string;
  if (knownPreset(sp.preset, opts)) {
    kind = sp.preset;
    ({ from, to } = presetBounds(kind, today));
  } else if (isDate(sp.from) || isDate(sp.to)) {
    from = isDate(sp.from) ? sp.from : today;
    to = isDate(sp.to) ? sp.to : from;
    kind = "range";
  } else {
    // Default: the next 7 days — the operator's "what's coming up" (8.2a, #205).
    kind = "next7";
    ({ from, to } = presetBounds(kind, today));
  }
  // Clamp to the horizon, then re-guard ordering. The scope LABEL is built after
  // so the header never disagrees with the actual (clamped) window.
  const minFrom = addDays(today, -30);
  const maxTo = addDays(today, 45);
  if (from < minFrom) from = minFrom;
  if (to > maxTo) to = maxTo;
  if (to < from) to = from;

  const scope =
    PRESET_SCOPE[kind] ??
    (from === to ? formatShortDay(from) : `${formatShortDay(from)} – ${formatShortDay(to)}`);
  return { from, to, scope, kind };
}

/**
 * The preset-or-range half of a querystring — no mode/sel/feedback. Both the mode toggle and a
 * page's return URLs rebuild the window from this, so a flip never drops the operator's chosen
 * days. `past` and `all` are carried only when allowed, so All Shifts' URLs are unchanged.
 */
export function windowParams(sp: WindowSearch, opts: WindowOpts = {}): URLSearchParams {
  const p = new URLSearchParams();
  if (knownPreset(sp.preset, opts)) {
    p.set("preset", sp.preset);
  } else {
    if (isDate(sp.from)) p.set("from", sp.from);
    if (isDate(sp.to)) p.set("to", sp.to);
  }
  return p;
}
