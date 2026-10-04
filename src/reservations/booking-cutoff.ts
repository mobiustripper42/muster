/**
 * The booking cutoff's stored value (DEC-193, `docs/SPEC.md §2.8.4`, issue #1071).
 *
 * A length of time before a departure, in whole hours, inside which the public site stops selling
 * it. It lives in `app_settings` under {@link BOOKING_CUTOFF_KEY}; an absent key is the fallback,
 * **0, which means no cutoff** — so nothing changes until the operator chooses a number. The
 * predicate that applies it is `insideBookingCutoff` in `availability.ts`, beside `hasDeparted`,
 * because it is that function asked about a later clock.
 *
 * No screen edits it yet. It is set by SQL until the settings page (issue #1166) ships.
 */
import { logSwallowed } from "../log.js";

/** The `app_settings` key. */
export const BOOKING_CUTOFF_KEY = "booking.cutoff_hours";

/**
 * Parse the stored value. Absent ⇒ 0, silently. A whole number (surrounding spaces allowed) ⇒
 * that many hours. Anything else — negative, a fraction, a unit, empty — ⇒ 0 **and a log line**:
 * a typo in a hand-written SQL row must not stop the public site selling, and must not be silent
 * either, because the operator believes a cutoff is in force.
 */
export function parseBookingCutoffHours(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  if (/^\s*\d+\s*$/.test(raw)) return Number(raw.trim());
  logSwallowed(
    "reservations:booking-cutoff",
    new Error(`${BOOKING_CUTOFF_KEY} is ${JSON.stringify(raw)}, not a whole number of hours`),
    "the booking cutoff reads as 0 — the public site is selling right up to departure",
  );
  return 0;
}
