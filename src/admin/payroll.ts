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
  /**
   * The vessel-local dates this person held a qualifying seat on, ascending (#638). The seat
   * rules that produced them — required, Confirmed, not Cancelled, not event-less — stay here
   * rather than being re-applied by a consumer: four rules and a dedupe, and a second copy
   * would drift from this one the first time any of them changed.
   */
  days: string[];
}

export async function buildPayrollReport(
  repo: Repository,
  window: { from: string; to: string },
): Promise<PayrollRow[]> {
  const nameById = new Map(
    (await repo.listCrewMembers()).map((c) => [String(c.id), c.name]),
  );
  const acc = new Map<string, { shiftCount: number; minutes: number; days: Set<string> }>();

  for (const shift of await repo.listShifts()) {
    // Cancelled only — Completed IS counted (unlike the forward-looking all-shifts
    // board): a completed past shift is exactly the work being paid for.
    if (shift.state === "Cancelled") continue;
    if (shift.date < window.from || shift.date > window.to) continue;

    // The shift's on-clock minutes, from its SCHEDULED events. The event ROWS, not
    // their departure times: each trip is measured by its own length (DEC-041), so a
    // 120-minute boat is paid 20 minutes more than a 100-minute one.
    const events = [];
    for (const eventId of shift.eventIds) {
      const event = await repo.getEvent(eventId);
      if (event && event.status === "scheduled") events.push(event);
    }
    const minutes = committedMinutes(events);
    if (minutes === 0) continue; // event-less / all-cancelled → nobody's on the clock

    // Distinct crew on this shift's required Confirmed seats — dedupe so the operator
    // override backstop (which can seat one person twice, bypassing the DEC-003
    // double-book guard) doesn't count their hours twice for the one shift.
    const seatedHere = new Set<string>();
    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (seat.state !== "Confirmed" || seat.kind !== "required" || !seat.assignedCrewMemberId) {
        continue;
      }
      seatedHere.add(String(seat.assignedCrewMemberId));
    }
    for (const id of seatedHere) {
      const row = acc.get(id) ?? { shiftCount: 0, minutes: 0, days: new Set<string>() };
      row.shiftCount += 1;
      row.minutes += minutes;
      // `shift.date` is already the vessel-local day (DEC-032) — the same calendar on which
      // #638 asks whether a punch exists. A Set because two shifts in one day is one day.
      row.days.add(shift.date);
      acc.set(id, row);
    }
  }

  return [...acc.entries()]
    .map(([crewMemberId, v]) => ({
      crewMemberId,
      name: nameById.get(crewMemberId) ?? "(unknown)",
      shiftCount: v.shiftCount,
      minutes: v.minutes,
      days: [...v.days].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
