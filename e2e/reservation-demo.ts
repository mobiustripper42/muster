/**
 * The reservation fixture's dates, for the specs that drive it (#646).
 *
 * **Why this file exists.** The seeded world used to be pinned to Aug 10–16 2026 and seven specs
 * typed those dates verbatim. That expired: `/book` defaults to today's month, so once today
 * reached August the forward-paging test had nowhere to page and — worse — usually passed by
 * racing a link navigation and asserting against the page it never left. The seed is now relative
 * (`reservationDemo`), and these are the derived values the specs read instead of literals.
 *
 * **This is where the clock read lives**, and there is deliberately only ONE of it per run.
 * `reservationDemo` is pure and the core stays clock-free. {@link TODAY} is computed once, at module
 * import, and `resetAndSeed` hands it to the seed subprocess as `SEED_TODAY` — so the fixture in
 * the database and the expectations in the specs are derived from the *same* day by construction.
 *
 * That matters more than it first looks. The suite runs `workers: 1, fullyParallel: false`, and
 * `resetAndSeed` re-seeds in every `beforeEach`, so a subprocess reading its own clock would be
 * re-deriving the window dozens of times across a run that spans many spec files. A month rollover
 * mid-run would then mismatch this module's cached value for **every remaining test**, not just the
 * one that straddled it. Passing the day down removes the disagreement rather than narrowing it:
 * a rollover mid-run now simply means the whole run used yesterday's date, which is harmless.
 *
 * Labels come from the app's OWN formatters (`formatShortDay`, and the same
 * `toLocaleDateString` shape `buildMonthCalendar` uses for its header) — a spec that reimplements
 * the format asserts its own idea of correct, which is how "Wed, Aug 12" passes while the page
 * says something else.
 */
import { vesselDateOf } from "../src/config/tenant.js";
import { formatShortDay } from "../src/reservations/availability-screen.js";
import { demoReservationId, reservationDemo } from "../src/reservations/seed-reservation.js";

/** The run's single day, vessel-local (DEC-032). Handed to the seed so both sides agree. */
export const TODAY = vesselDateOf(new Date());

/** The seeded world for today — the 10th–16th of next month. */
export const DEMO = reservationDemo(TODAY);

/** The first booking (Marcus Webb, party 8, $549) — the slot most specs point at. */
export const BOOKED = DEMO.bookings[0]!;

/** The second booking (Dana Cho, $439). */
export const BOOKED_2 = DEMO.bookings[1]!;

/** The third — Marcus again, outside the vessel-block window on purpose. */
export const BOOKED_3 = DEMO.bookings[2]!;

/** An OPEN slot on the booked day: same date, a departure nobody has taken. */
export const OPEN_TIME = DEMO.departureTimes[1]!; // 15:30

/** "September 2026" — the calendar header, formatted exactly as `buildMonthCalendar` does. */
export function monthLabel(isoDay: string): string {
  return new Date(`${isoDay.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The month header the seeded window lives under — what the paging test pages TO. */
export const DEMO_MONTH_LABEL = monthLabel(DEMO.ownedRange.start);

/** Today's month header — what `/book` opens on, and which must contain no availability. */
export const TODAY_MONTH_LABEL = monthLabel(TODAY);

/** "Wed, Aug 12" — the app's own short-day rendering. */
export { formatShortDay };

/**
 * "Aug 12" — the weekday-less tail of {@link formatShortDay}, for surfaces that render a date
 * inside a longer string (the customer history rows, the purchases list). Derived from the app's
 * formatter rather than re-spelled, so a format change fails here instead of drifting silently.
 */
export function monthDay(isoDay: string): string {
  return formatShortDay(isoDay).split(", ")[1]!;
}

/** `resv-demo-<date>-<time>`, built by the seed's own id function rather than hand-spelled. */
export { demoReservationId };
