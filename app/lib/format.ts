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
export function fmt12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
