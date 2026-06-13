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
