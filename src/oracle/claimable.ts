/**
 * The self-claim door (SPEC §2.7.1, DEC-076) — what a crew member may claim on
 * the browse surface, the inverse of the oracle's per-seat eligible pool.
 *
 * Two eligibility doors over the SAME seat/state machine (DEC-076):
 *  - **self-claim** (here) is **native-role-only** — a captain never sees mate
 *    seats — layered on top of the existing §1.3 eligible-pool gate;
 *  - **operator-assign** keeps full `ratings` (`isRatedFor`/the override, DEC-064)
 *    so the operator can still drop a captain-rated member into a mate seat. That
 *    door is unchanged; this module does not touch it.
 *
 * A READ, pure-ish (repo-backed, no writes, `now` injected). The actual claim
 * transition is 7.2's `claimSeat`; this only answers "what could you claim?".
 */

import type { CrewMember } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId, SeatId, ShiftId, VesselId } from "../domain/ids.js";
import type { ShiftState } from "../domain/states.js";
import type { Repository } from "../ports/repository.js";
import { evaluateCandidate, nativeRole } from "./eligibility.js";
import { committedDatesByCrew } from "./oracle.js";

/** Self-claim only browses shifts the system is (or will be) working — never a
 *  Crewed/AtRisk/Completed/Cancelled one. Mirrors §2.7.1. */
const CLAIMABLE_SHIFT_STATES: ReadonlySet<ShiftState> = new Set<ShiftState>([
  "Pending",
  "Filling",
]);

/** How far ahead the browse window reaches (DEC-074/042 guardrail: today+45d). */
export const CLAIMABLE_WINDOW_DAYS = 45;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Date-only (YYYY-MM-DD), UTC — sorts identically to chronological (DEC-032). */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** One seat the crew member could claim — ids + date + role; the §2.7.1 view
 *  layer resolves vessel name + trip count (7.3), so this stays structural. */
export interface ClaimableSeat {
  seatId: SeatId;
  shiftId: ShiftId;
  vesselId: VesselId;
  /** ISO-8601 date of the shift (vessel-local calendar day, DEC-032). */
  date: string;
  role: RoleTypeId;
}

/**
 * Every Open+required seat this crew member could self-claim, applying — layered:
 *  1. **native role only** (DEC-076) — `seat.role === nativeRole(crew)`,
 *  2. shift state in `Pending`/`Filling`,
 *  3. seat `Open` + `required` (supernumerary out of scope),
 *  4. the date within `[today, today+windowDays]`,
 *  5. the existing §1.3 eligible-pool gate (`evaluateCandidate`: active, rating,
 *     MMC valid on the date, not double-booked, not on PTO).
 *
 * Inactive crew or a crew member with no determinable native role get `[]`.
 */
export async function claimableSeatsFor(
  repo: Repository,
  crewId: CrewMemberId,
  now: Date,
  windowDays: number = CLAIMABLE_WINDOW_DAYS,
): Promise<ClaimableSeat[]> {
  const crew: CrewMember | null = await repo.getCrewMember(crewId);
  if (!crew || crew.status !== "active") return [];
  const role = nativeRole(crew);
  if (!role) return [];

  const today = isoDate(now);
  const until = isoDate(new Date(now.getTime() + windowDays * MS_PER_DAY));

  const [credentials, ptoWindows, committedByCrew] = await Promise.all([
    repo.listCredentialsForCrew(crewId),
    repo.listPtoWindowsForCrew(crewId),
    committedDatesByCrew(repo),
  ]);
  const committedDates = committedByCrew.get(crewId) ?? new Set<string>();

  const shifts = (await repo.listShifts()).filter(
    (s) =>
      CLAIMABLE_SHIFT_STATES.has(s.state) && s.date >= today && s.date <= until,
  );

  const claimable: ClaimableSeat[] = [];
  for (const shift of shifts) {
    const seats = await repo.listSeatsForShift(shift.id);
    for (const seat of seats) {
      if (seat.state !== "Open" || seat.kind !== "required") continue;
      if (seat.role !== role) continue; // native-role-only door (DEC-076)
      const verdict = evaluateCandidate(
        { crew, credentials, ptoWindows, committedDates },
        seat.role,
        shift.date,
      );
      if (verdict.eligible) {
        claimable.push({
          seatId: seat.id,
          shiftId: shift.id,
          vesselId: shift.vesselId,
          date: shift.date,
          role: seat.role,
        });
      }
    }
  }
  return claimable;
}
