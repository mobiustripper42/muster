/**
 * `/crew/open` claimable-seat view model (SPEC §2.7.1, DEC-074/077) — the read
 * side of the self-serve pull surface. Decorates each structural `ClaimableSeat`
 * (7.1) with the human context the row + confirm sheet need: vessel name, role
 * name, the live scheduled-trip times (the "2 trips (1:00 & 4:00 PM)" list), and
 * the DEC-041 call→back committed window.
 *
 * Framework-free, data-only — the surface formats. `now` is injected. The
 * claimable SET (which seats the viewer may claim) stays owned by
 * `claimableSeatsFor`; this only decorates + range-filters, so the read door and
 * the write door (`claimSeat`) keep one definition of "what's claimable".
 */

import type { Event } from "../domain/entities.js";
import type { CrewMemberId } from "../domain/ids.js";
import { claimableSeatsFor } from "../oracle/claimable.js";
import type { Repository } from "../ports/repository.js";
import { committedWindow } from "./shift-card.js";

export interface ClaimableSeatView {
  seatId: string;
  shiftId: string;
  vesselName: string;
  /** Vessel id — feeds the DEC-086 identity hue dot on the claim row, so a
   *  mixed-vessel claimable list reads which-boat at a glance (same as My-shifts
   *  and the board). Identity only, `aria-hidden`; the vessel name is the answer. */
  vesselId: string;
  /** Operator-chosen vessel hue (DEC-086 palette index, 12.9) — authoritative for the
   *  identity dot when set; absent ⇒ the id-derived hue stands. */
  vesselHue?: number;
  roleName: string;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /** Scheduled departure clock times ("HH:mm"), soonest first — the confirm
   *  sheet's live trip list; `length` is the trip count. */
  tripTimes: string[];
  /** Show-up time, "HH:mm" (DEC-041) — absent on an event-less shift. */
  callTime?: string;
  /** End of commitment, "HH:mm" (DEC-041) — absent on an event-less shift. */
  shiftEndTime?: string;
}

/** Inclusive ISO date range the surface clamps the view to (a preset / from–to). */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * The viewer's claimable rows, decorated and optionally clamped to `range` (which
 * only *narrows* `claimableSeatsFor`'s [today, today+45d] window — never widens).
 * Sorted by date, then earliest departure.
 */
export async function buildClaimableView(
  repo: Repository,
  crewId: CrewMemberId,
  now: Date,
  range?: DateRange,
): Promise<ClaimableSeatView[]> {
  const claimable = await claimableSeatsFor(repo, crewId, now);
  const rows: ClaimableSeatView[] = [];
  for (const seat of claimable) {
    if (range && (seat.date < range.from || seat.date > range.to)) continue;
    const vessel = await repo.getVessel(seat.vesselId);
    const role = await repo.getRoleType(seat.role);
    const shift = await repo.getShift(seat.shiftId);
    const scheduled: Event[] = [];
    for (const id of shift?.eventIds ?? []) {
      const e = await repo.getEvent(id);
      if (e && e.status === "scheduled") scheduled.push(e);
    }
    // The displayed departure list stays clock strings; the WINDOW needs the rows,
    // because each trip is measured by its own length (DEC-041).
    const tripTimes = scheduled.map((e) => e.time).sort((a, b) => a.localeCompare(b));
    const { callTime, shiftEndTime } = committedWindow(scheduled);
    rows.push({
      seatId: seat.seatId,
      shiftId: seat.shiftId,
      vesselName: vessel?.name ?? seat.vesselId,
      vesselId: seat.vesselId,
      ...(vessel?.hue !== undefined ? { vesselHue: vessel.hue } : {}),
      roleName: role?.name ?? seat.role,
      date: seat.date,
      tripTimes,
      ...(callTime !== undefined ? { callTime } : {}),
      ...(shiftEndTime !== undefined ? { shiftEndTime } : {}),
    });
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.tripTimes[0] ?? "").localeCompare(b.tripTimes[0] ?? ""),
  );
  return rows;
}
