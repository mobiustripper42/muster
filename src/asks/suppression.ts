/**
 * Send-time ask suppression — the two candidate-filters the autonomous ask paths
 * apply *when deciding whom to text*, deliberately OUTSIDE the eligibility layer
 * (DEC-129, DEC-130). Kept in `asks/` (not `oracle/`) on purpose: eligibility
 * (`eligiblePool`/`poolExhaustedFor`) must NOT see these, so that a pool empty only
 * because everyone is suppressed still resolves `Filling`, never `AtRisk` — defer
 * is not exhaustion. Built ONCE per tick; O(1) set lookups per seat thereafter.
 *
 *  - **`working` (DEC-129, #341 — HARD):** crew currently inside `[call, end)` of a
 *    shift they hold a Claimed/Confirmed seat on. Never auto-asked, never valved to,
 *    never nudged. `call = earliestScheduledStart − CALL_LEAD_MINUTES`,
 *    `end = shiftEndFromEvents` (latest departure + TRIP_DURATION + TEARDOWN, DEC-041
 *    / #275). Computed Date-based here — the crewapp `committedWindow` is an
 *    `"HH:mm"` display helper that loses the date and is not reused.
 *  - **`declinedOnDay` (DEC-130, #342 — SOFT):** per vessel-date, the crew who
 *    declined an ask for any shift on that date. The tick suppresses them for other
 *    boats the same date, with a last-resort valve (see the tick / escalate call
 *    sites). Derived from `Ask` rows (`response === "declined"`) — the rows the tick
 *    already loads for #393; declined asks are never deleted (`expireAsks` only
 *    stamps). Keyed by the *declined shift's* `shift.date`, so it expires with the
 *    date. No new data, no migration; a decline stays reliability-neutral.
 */

import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { COMMITTED_SEAT_STATES } from "../oracle/oracle.js";
import {
  CALL_LEAD_MINUTES,
  earliestScheduledStart,
  shiftEndFromEvents,
} from "./../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";

const MINUTE_MS = 60 * 1000;

export interface AskSuppression {
  /** #341 (DEC-129): crew inside a committed `[call, end)` window right now. Hard. */
  working: ReadonlySet<CrewMemberId>;
  /** #342 (DEC-130): vessel-date → crew who declined an ask for a shift on it. Soft. */
  declinedOnDay: ReadonlyMap<string, ReadonlySet<CrewMemberId>>;
}

/**
 * Compute both suppression sets in one sweep over the live shifts + all asks.
 * `now` injected (no clock read); `tz` defaults to the tenant zone.
 */
export async function buildAskSuppression(
  repo: Repository,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<AskSuppression> {
  const working = new Set<CrewMemberId>();
  const declinedOnDay = new Map<string, Set<CrewMemberId>>();
  const seatDate = new Map<SeatId, string>(); // seatId → its shift's vessel-date
  const allEvents = await repo.listEvents();
  const nowMs = now.getTime();

  for (const shift of await repo.listShifts()) {
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;
    const ids = new Set(shift.eventIds);
    const events = allEvents.filter((e) => ids.has(e.id));
    const seats = await repo.listSeatsForShift(shift.id);
    for (const seat of seats) seatDate.set(seat.id, shift.date);

    // #341 working window: [call, end). Both null when nothing's scheduled.
    const start = earliestScheduledStart(events, tz);
    const end = shiftEndFromEvents(events, tz);
    if (start === null || end === null) continue;
    const callMs = start.getTime() - CALL_LEAD_MINUTES * MINUTE_MS;
    if (nowMs < callMs || nowMs >= end.getTime()) continue; // half-open [call, end)
    for (const seat of seats) {
      if (seat.assignedCrewMemberId && COMMITTED_SEAT_STATES.has(seat.state)) {
        working.add(seat.assignedCrewMemberId);
      }
    }
  }

  // #342 cooldown: crew who said no to a shift on date D, keyed by D.
  for (const ask of await repo.listAllAsks()) {
    if (ask.response !== "declined") continue;
    const date = seatDate.get(ask.seatId);
    if (date === undefined) continue; // seat on a terminal/absent shift — ignore
    const set = declinedOnDay.get(date) ?? new Set<CrewMemberId>();
    set.add(ask.crewMemberId);
    declinedOnDay.set(date, set);
  }

  return { working, declinedOnDay };
}
