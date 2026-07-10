/**
 * Payroll hours report (#347) — each crew member's ESTIMATED hours for a pay period,
 * for the operator to sanity-check against timesheets. Sum the DEC-041 on-clock
 * window (`committedMinutes`) of every shift in `[from, to]` the person holds a
 * **required Confirmed** seat on. "Estimated" by design: it's scheduled/committed
 * hours from confirmed assignments, not a punch clock.
 *
 * Only assigned crew count — a supernumerary/trainee ride (DEC-087) is unpaid, so
 * those seats are excluded (operator's call). Cancelled shifts don't count. Pure read
 * over the port (the deriveAllShifts idiom): name-map once, then walk shifts.
 */

import type { Repository } from "../ports/repository.js";
import { committedMinutes } from "../crewapp/shift-card.js";

export interface PayrollRow {
  crewMemberId: string;
  name: string;
  /** Qualifying shifts worked in the window. */
  shiftCount: number;
  /** Total on-clock minutes (sum of each shift's committed window). */
  minutes: number;
}

export async function buildPayrollReport(
  repo: Repository,
  window: { from: string; to: string },
): Promise<PayrollRow[]> {
  const nameById = new Map(
    (await repo.listCrewMembers()).map((c) => [String(c.id), c.name]),
  );
  const acc = new Map<string, { shiftCount: number; minutes: number }>();

  for (const shift of await repo.listShifts()) {
    if (shift.state === "Cancelled") continue;
    if (shift.date < window.from || shift.date > window.to) continue;

    // The shift's on-clock minutes, from its SCHEDULED event departure times.
    const times: string[] = [];
    for (const eventId of shift.eventIds) {
      const event = await repo.getEvent(eventId);
      if (event && event.status === "scheduled") times.push(event.time);
    }
    const minutes = committedMinutes(times);
    if (minutes === 0) continue; // event-less / all-cancelled → nobody's on the clock

    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (seat.state !== "Confirmed" || seat.kind !== "required" || !seat.assignedCrewMemberId) {
        continue;
      }
      const id = String(seat.assignedCrewMemberId);
      const row = acc.get(id) ?? { shiftCount: 0, minutes: 0 };
      row.shiftCount += 1;
      row.minutes += minutes;
      acc.set(id, row);
    }
  }

  return [...acc.entries()]
    .map(([crewMemberId, v]) => ({
      crewMemberId,
      name: nameById.get(crewMemberId) ?? "(unknown)",
      shiftCount: v.shiftCount,
      minutes: v.minutes,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
