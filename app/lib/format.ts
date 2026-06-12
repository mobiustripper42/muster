/**
 * Shared admin-surface formatters. Kept here so the board and the cockpit render
 * the same fact the same way (DEC-031's "fills by" is shown on both — a single
 * formatter is what keeps them from drifting).
 *
 * Clock times are treated as UTC by DEC-022's v1 simplification — every
 * formatter here pins `timeZone: "UTC"` so a dated fact reads the same wherever
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
    timeZone: "UTC",
  });
}
