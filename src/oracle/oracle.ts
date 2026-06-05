/**
 * The availability oracle — eligible pool + composite crew satisfiability
 * (SPEC §1.3, DEC-003).
 *
 * One authoritative place that answers "who may crew this seat?" and "can this
 * whole shift be crewed?". Nobody else computes availability. Repo-backed (reads
 * the world through the port); `now` injected so the core never reads the clock.
 *
 * THE composite point (DEC-003): crew rules are not independent booleans over the
 * pool. Captain A is free but lapsed; Captain B is current but booked — evaluate
 * each rule separately and every rule passes about a *different* person, a false
 * yes. So `solveShift` solves over a **shared** pool: a person assigned to one
 * required seat is removed before the next seat is considered.
 *
 * Out of scope for 1.4a (homed at 1.4b/M3): reliability-ORDERED ranking (the pool
 * comes back in arbitrary repo order here — §1.4 ordering is the next task) and
 * the two-horizon `deferred` machinery (§1.3). This computes the in-horizon pool
 * when asked.
 */

import type { CrewMember } from "../domain/entities.js";
import type {
  CrewMemberId,
  RoleTypeId,
  SeatId,
  ShiftId,
} from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { CandidateVerdict } from "./eligibility.js";
import { evaluateCandidate } from "./eligibility.js";

/** Seat states that mean a person is already committed for double-booking (§1.3).
 * `Asked` is excluded — an outstanding ask isn't a commitment (they may decline);
 * `Open`/`Bailed` hold nobody. */
const COMMITTED_SEAT_STATES = new Set(["Claimed", "Confirmed"]);

/** The eligible pool for one required seat: who passes, and why the rest failed. */
export interface SeatPool {
  seatId: SeatId;
  role: RoleTypeId;
  /** Candidates passing every hard rule — arbitrary order (ranking is 1.4b). */
  eligible: CrewMemberId[];
  /** Every candidate's verdict (incl. the eligible) — the "why each failed" record. */
  verdicts: CandidateVerdict[];
}

/**
 * Map each crew member → the set of ISO dates they already hold a committed seat
 * on, optionally excluding one shift (the one being solved). One pass over all
 * shifts and their seats — fine for the throwaway in-memory store; a real DB
 * indexes this later.
 */
async function committedDatesByCrew(
  repo: Repository,
  excludeShiftId?: ShiftId,
): Promise<Map<CrewMemberId, Set<string>>> {
  const byCrew = new Map<CrewMemberId, Set<string>>();
  const shifts = await repo.listShifts();
  for (const shift of shifts) {
    if (shift.id === excludeShiftId) continue;
    const seats = await repo.listSeatsForShift(shift.id);
    for (const seat of seats) {
      if (!seat.assignedCrewMemberId) continue;
      if (!COMMITTED_SEAT_STATES.has(seat.state)) continue;
      const dates = byCrew.get(seat.assignedCrewMemberId) ?? new Set<string>();
      dates.add(shift.date);
      byCrew.set(seat.assignedCrewMemberId, dates);
    }
  }
  return byCrew;
}

/** Assemble a candidate's context slice and evaluate them against one seat. */
async function verdictFor(
  repo: Repository,
  crew: CrewMember,
  role: RoleTypeId,
  tripDate: string,
  committed: ReadonlySet<string>,
): Promise<CandidateVerdict> {
  const [credentials, ptoWindows] = await Promise.all([
    repo.listCredentialsForCrew(crew.id),
    repo.listPtoWindowsForCrew(crew.id),
  ]);
  return evaluateCandidate(
    { crew, credentials, ptoWindows, committedDates: committed },
    role,
    tripDate,
  );
}

/**
 * The eligible pool for every required seat on a shift. Supernumerary seats are
 * not crewed by the pool (they don't gate `Crewed` — DEC-005), so only required
 * seats get a pool. Returns one `SeatPool` per required seat.
 */
export async function eligiblePool(
  repo: Repository,
  shiftId: ShiftId,
): Promise<SeatPool[]> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return [];
  const seats = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  const crew = await repo.listCrewMembers();
  const committed = await committedDatesByCrew(repo, shiftId);

  const pools: SeatPool[] = [];
  for (const seat of seats) {
    const verdicts = await Promise.all(
      crew.map((c) =>
        verdictFor(
          repo,
          c,
          seat.role,
          shift.date,
          committed.get(c.id) ?? new Set<string>(),
        ),
      ),
    );
    pools.push({
      seatId: seat.id,
      role: seat.role,
      eligible: verdicts.filter((v) => v.eligible).map((v) => v.crewMemberId),
      verdicts,
    });
  }
  return pools;
}

/** Result of the composite shared-pool solve for one shift (DEC-003). */
export interface ShiftSolution {
  shiftId: ShiftId;
  /** True iff every required seat got a distinct, eligible person. */
  satisfiable: boolean;
  /** seatId → crewMemberId when satisfiable; null otherwise. */
  assignment: Map<SeatId, CrewMemberId> | null;
  /** Per-seat pools (the "why each candidate failed" detail), always populated. */
  pools: SeatPool[];
}

/**
 * Can this shift be crewed *right now*, and by whom? (DEC-003 composite rule.)
 *
 * Greedy over the shared pool: walk required seats in order, assign the first
 * still-unused eligible candidate, remove them from the pool for later seats. If
 * any required seat is left with no unused eligible candidate, the shift is
 * unsatisfiable and `assignment` is null (the per-seat pools still explain why).
 *
 * Greedy-by-arbitrary-order is deliberate at 1.4a: with reliability scores flat/
 * null there is no ranking yet (§1.4). 1.4b makes the walk reliability-ordered.
 * Greedy can miss an assignment a full matching would find (the classic
 * bipartite-matching gap); acceptable while the pool is tiny and ranking is the
 * next task — noted for the 1.4b ask loop, which is where assignment goes live.
 */
export async function solveShift(
  repo: Repository,
  shiftId: ShiftId,
): Promise<ShiftSolution> {
  const pools = await eligiblePool(repo, shiftId);
  const assignment = new Map<SeatId, CrewMemberId>();
  const used = new Set<CrewMemberId>();
  let satisfiable = true;

  for (const pool of pools) {
    const pick = pool.eligible.find((id) => !used.has(id));
    if (pick === undefined) {
      // First starved seat dooms the shift; stop rather than leave a half-built
      // `used`/`assignment` a later reader could mistake for a partial result.
      satisfiable = false;
      break;
    }
    used.add(pick);
    assignment.set(pool.seatId, pick);
  }

  return {
    shiftId,
    satisfiable,
    assignment: satisfiable ? assignment : null,
    pools,
  };
}
