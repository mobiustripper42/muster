import type { Repository } from "../ports/repository.js";
import { deriveAllShifts } from "../admin/all-shifts.js";

/** One assigned crew member on another shift — name + role, for the day view. */
export interface OtherShiftCrew {
  name: string;
  role: string;
}

/** A shift running the same day as the one a crew member is looking at (#315). */
export interface OtherShiftToday {
  shiftId: string;
  vesselName: string;
  /** First scheduled departure, vessel-local "HH:mm"; null when none scheduled. */
  firstDeparture: string | null;
  /** How many scheduled trips this shift runs — surfaced as "N trips" under the
   *  first departure when > 1 (#315 follow-up), so a multi-trip day reads at a
   *  glance without listing every clock time (kept calm, not a full timetable). */
  tripCount: number;
  /** Assigned crew (name + role), in the board's deterministic seat order; empty
   *  when nothing's crewed yet. */
  crew: OtherShiftCrew[];
}

/**
 * Other shifts running on `date`, excluding `excludeShiftId` — the crew member's
 * "who else is out today" view (#315). A crew member scheduled that day gets a
 * sense of the whole day: which boats are running, when they leave, and who's
 * aboard.
 *
 * Reuses the admin all-shifts derivation (`deriveAllShifts` — same shift model,
 * Cancelled/Completed already excluded, sorted date → earliest departure) but
 * narrows to a lean, CREW-appropriate DTO: boat + first departure + co-crew names
 * only. **No guest manifest** (the PII boundary — a crew member sees who's working,
 * never other shifts' guests) and **no state/scoreboard** (this is comraderie, not
 * a monitoring surface — same calm posture as DEC-042). A future cohort-message
 * button hangs off this list (its own issue), so the shape carries `shiftId`.
 */
export async function otherShiftsOnDay(
  repo: Repository,
  date: string,
  excludeShiftId: string,
  now: Date,
): Promise<OtherShiftToday[]> {
  const rows = await deriveAllShifts(repo, { from: date, to: date }, now);
  return rows
    .filter((r) => r.shiftId !== excludeShiftId)
    .map((r) => ({
      shiftId: r.shiftId,
      vesselName: r.vesselName,
      firstDeparture: r.trips[0]?.time ?? null,
      tripCount: r.trips.length,
      crew: r.seats
        .filter((s) => s.crewName)
        .map((s) => ({ name: s.crewName as string, role: s.roleName })),
    }));
}
