/**
 * Warming derivation (SPEC §2.4, #55, DEC-027 §3) — shifts **trending toward
 * risk** but not yet summoning anyone: the deliberately-opened pull view on the
 * assignment surface. Never on the At-Risk board, never pings (§2.5 stays pure
 * push/empty); Spink opens it when he wants the weather, not the alarm.
 *
 * Membership = a conservative candidate predicate **minus the actual board**:
 *
 *  - candidate: past the staffing horizon (the system is working it), trip still
 *    ahead, at least one unfilled required seat (Open/Asked/Bailed — Claimed is
 *    a yes awaiting confirm, not a hole), AND a negative-trend signal —
 *      · **ghosted**: at least one ask timed out silent (silence is the
 *        disease, §2.4), or
 *      · **quiet**: asks went out and none are still live (`asked > 0`,
 *        `pending === 0`) yet the seat count above says still short — everyone
 *        answered no or went silent. This is the board's deliberate quiet zone
 *        (willingness-exhausted, trip too far out to summon) surfacing as
 *        weather instead of alarm.
 *    A live ask is **never** a negative signal: people mid-decision are the
 *    system working, so a fresh broadcast cannot warm a shift (anti-anxiety-
 *    dashboard, BRAND). This is deliberately tighter than a raw answered/asked
 *    rate, which would read 0% the second a broadcast fires.
 *  - minus: anything `deriveAtRiskBoard` already claims. Board membership stays
 *    **single-sourced** (DEC-026): warming subtracts the real board rows, never
 *    re-approximates membership with state checks — so inside the summon
 *    threshold the board takes over and the row leaves warming automatically.
 *
 * `responseRate` is a display fact, not a membership signal: answered ÷ settled
 * (settled = answered + silent — pending asks excluded for the same reason).
 *
 * Cost: one board derive + one trail per shift on top of the horizon reads —
 * BrewBoat-cheap; same revisit trigger as DEC-022/024/026.
 */

import type { ShiftId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { EscalationTrail } from "../asks/escalation-trail.js";
import { escalationTrailFor } from "../asks/escalation-trail.js";
import {
  earliestScheduledStart,
  staffingHorizonFromEvents,
  STAFFING_HORIZON_LEAD_DAYS,
} from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import { deriveAtRiskBoard } from "./at-risk-board.js";

const MS_PER_HOUR = 60 * 60 * 1000;

/** One warming row — the cockpit renders these, no further derivation. */
export interface WarmingRow {
  shiftId: ShiftId;
  vesselId: VesselId;
  /** ISO-8601 shift date. */
  date: string;
  /** Earliest scheduled departure (always non-null for a warming row). */
  tripStart: Date;
  /** Hours from `now` to `tripStart`. */
  hoursToTrip: number;
  /** Unfilled required seats (Open/Asked/Bailed). */
  unfilledSeats: number;
  /** Answered ÷ settled asks (display fact); null until an ask settles. */
  responseRate: number | null;
  /** The raw trail behind the signals (DEC-024 transparency). */
  trail: EscalationTrail;
}

/**
 * Derive the warming list as of `now`, soonest trip first. `opts` passes the
 * same horizon/threshold overrides through to the board subtraction so the two
 * derivations always agree on membership.
 */
export async function deriveWarming(
  repo: Repository,
  now: Date,
  opts?: { leadDays?: number; deadlineHours?: number; tz?: string },
): Promise<WarmingRow[]> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const tz = opts?.tz ?? TENANT_TIMEZONE;

  // The board's actual claim — membership single-sourced (DEC-026), subtracted.
  const onBoard = new Set(
    (await deriveAtRiskBoard(repo, now, opts)).map((r) => r.shiftId),
  );

  const allEvents = await repo.listEvents();
  const rows: WarmingRow[] = [];

  for (const shift of await repo.listShifts()) {
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;
    if (onBoard.has(shift.id)) continue;

    const ids = new Set(shift.eventIds);
    const events = allEvents.filter((e) => ids.has(e.id));
    const tripStart = earliestScheduledStart(events, tz);
    const horizon = staffingHorizonFromEvents(events, leadDays, tz);
    // Pre-horizon shifts aren't being worked yet; event-less shifts have
    // nothing to trend toward. Departed trips are the past, not a trend.
    if (tripStart === null || horizon === null) continue;
    if (now < horizon || now >= tripStart) continue;

    const unfilled = (await repo.listSeatsForShift(shift.id)).filter(
      (s) =>
        s.kind === "required" &&
        s.state !== "Confirmed" &&
        s.state !== "Claimed",
    );
    if (unfilled.length === 0) continue;

    const trail = await escalationTrailFor(repo, shift.id, now);

    // The SIGNALS key on the seats that still need a body; `trail` stays whole-shift
    // for display (DEC-024 transparency). A filled seat's ask history says nothing
    // about whether the remaining gap is being worked.
    //
    // This scoping became load-bearing at #600. `trail` is summed across every
    // required seat, and a withdrawn ask counts toward `asked` but not `pending` — so
    // a shift with one FILLED seat (carrying withdrawn losers) plus one Open seat
    // NEVER asked derived `asked > 0 && pending === 0` and false-positived as "quiet",
    // i.e. "everyone answered and we're still short", when the gap had simply never
    // been tried. Before #600 those losing asks stayed live forever, so `pending` was
    // never 0 in that shape and the bug was unreachable.
    //
    // A `withdrawn` ask is not counted as an ask for the CURRENT gap either: it
    // belongs to the previous, filled cycle. Same rule as `askedSetFrom` — one
    // concept, so a seat carrying only withdrawn asks reads as un-asked and the drip
    // is left to do its job rather than the operator being pinged.
    let gapAsked = 0;
    let gapPending = 0;
    let gapSilent = 0;
    for (const s of unfilled) {
      for (const ask of await repo.listAsksForSeat(s.id)) {
        if (ask.response === "withdrawn") continue;
        gapAsked++;
        if (ask.respondedAt === undefined) gapPending++;
        else if (ask.response === undefined) gapSilent++;
      }
    }

    const ghosted = gapSilent > 0;
    const quiet = gapAsked > 0 && gapPending === 0;
    if (!ghosted && !quiet) continue;

    const answered = trail.accepted + trail.declined;
    const settled = answered + trail.silent;

    rows.push({
      shiftId: shift.id,
      vesselId: shift.vesselId,
      date: shift.date,
      tripStart,
      hoursToTrip: (tripStart.getTime() - now.getTime()) / MS_PER_HOUR,
      unfilledSeats: unfilled.length,
      responseRate: settled > 0 ? answered / settled : null,
      trail,
    });
  }

  // Soonest trip first; shiftId tie-break for adapter-stable order.
  return rows.sort(
    (a, b) =>
      a.hoursToTrip - b.hoursToTrip ||
      String(a.shiftId).localeCompare(String(b.shiftId)),
  );
}
