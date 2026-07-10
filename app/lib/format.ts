import { TENANT_TIMEZONE } from "@core/config/tenant.js";

/**
 * Shared admin-surface formatters. Kept here so the board and the cockpit render
 * the same fact the same way (DEC-031's "fills by" is shown on both — a single
 * formatter is what keeps them from drifting).
 *
 * Times are rendered in the **vessel** timezone (DEC-032, `TENANT_TIMEZONE`) —
 * the instants are true (minted in vessel-local at `eventStart`), so formatting
 * in that zone shows the dock wall-clock to crew and operator alike, wherever
 * the server runs.
 */

/** "Mon Jun 15, 1:00 PM" — a fills-by deadline as a dated fact (DEC-031). */
export function fmtDeadline(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TENANT_TIMEZONE,
  });
}

/**
 * "HH:mm" (24h, vessel-local wall-clock per DEC-032) → "h:mm AM/PM". The app
 * renders 12-hour everywhere; default AM/PM (a 12h↔24h viewer preference is
 * parked in FUTURE_IDEAS). String-in/string-out — these clock times are stored
 * as wall-clock strings, not instants, so there's no tz conversion to do here.
 */
/** Import-run source → operator label (#128 — shared by the import list + the
 * run-detail view so a third source can't drift between them). */
export const IMPORT_SOURCE_LABEL: Record<string, string> = {
  "manual-pull": "Manual pull",
  cron: "Hourly cron",
};

/** "Jun 15, 2026, 1:00 PM" — an import run's timestamp, vessel-local (DEC-032). */
export function fmtRunWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TENANT_TIMEZONE,
  });
}

export function fmt12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Phone → a `tel:` / `sms:` deep-link href, stripped to digits + a leading `+`.
 *  Shared by every contact button (seat-card, crew shift page, guest manifest) so
 *  the three can't drift. */
export const tel = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
export const sms = (p: string) => `sms:${p.replace(/[^0-9+]/g, "")}`;

/**
 * A date-only inclusive span → "Sat Jul 11" (single day) or "Sat Jul 11 – Sun
 * Jul 19" (#332 time-off windows). Unlike the instant formatters above, these are
 * bare `YYYY-MM-DD` calendar dates (no tz), so both ends are anchored at
 * `T00:00:00Z` and formatted in **UTC** — that shows the stored vessel-local date
 * verbatim regardless of server zone (DEC-032). Shared by the crew + admin
 * time-off surfaces so the two can't drift.
 */
export function fmtDateRange(start: string, end: string): string {
  const one = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return start === end ? one(start) : `${one(start)} – ${one(end)}`;
}
