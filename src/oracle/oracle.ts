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
 * `eligiblePool` returns each seat's eligible set in arbitrary repo order — it
 * answers *who* may crew, not in what order to ask. Reliability ORDERING (§1.4,
 * §2.4) is applied by consumers: `solveShift` ranks before its greedy pick, and
 * the ask loop ranks before broadcasting. Still out of scope: the two-horizon
 * `deferred` machinery (§1.3). This computes the in-horizon pool when asked.
 */

import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import type {
  CrewMemberId,
  RoleTypeId,
  SeatId,
  ShiftId,
} from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { CandidateVerdict } from "./eligibility.js";
import { evaluateCandidate } from "./eligibility.js";
import { rankEligibleIds } from "./reliability-score.js";

/** Seat states that mean a person is already committed for double-booking (§1.3).
 * `Asked` is excluded — an outstanding ask isn't a commitment (they may decline);
 * `Open`/`Bailed` hold nobody.
 *
 * Exported because it is also the definition self-claim reads *inverted*:
 * `CLAIMABLE_SEAT_STATES` (claimable.ts) is literally the complement — a seat is
 * claimable exactly when nobody is committed to it (#440). One definition, so the
 * two can't drift. */
export const COMMITTED_SEAT_STATES = new Set(["Claimed", "Confirmed"]);

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
 * on, optionally excluding one shift (the one being solved).
 *
 * TWO queries, not 1+N. It used to call `listSeatsForShift` per shift, which against
 * Postgres is one sequential round trip each — fine when this only ran inside the tick,
 * and not fine since it started guarding the crew-facing "In" tap (#522 sweep 3). Four
 * boats over a ~200-day season is ~800 shifts and rows are never pruned, so that shape
 * was ~800 round trips (seconds) on a user-latency path in year one, and roughly ten
 * times that by season three. `listAllSeats` makes it flat.
 */
export async function committedDatesByCrew(
  repo: Repository,
  excludeShiftId?: ShiftId,
): Promise<Map<CrewMemberId, Set<string>>> {
  const byCrew = new Map<CrewMemberId, Set<string>>();
  const [shifts, seats] = await Promise.all([repo.listShifts(), repo.listAllSeats()]);

  // A Cancelled shift is not a commitment. Its seats are deliberately KEPT (for
  // resurrection — form-shifts `restoredCrew`), so a crew member the cancel dropped
  // still carries a Confirmed seat there; counting it would read them as double-booked
  // on that date and bar them from the very shift they were moved to (a boat
  // reassignment cancels the old vessel-day and forms a new one). The claimable-list
  // scan already excludes Cancelled shifts — this makes the availability scan agree.
  // (Completed stays a real same-day commitment.)
  const dateByShift = new Map<string, string>();
  for (const shift of shifts) {
    if (shift.id === excludeShiftId) continue;
    if (shift.state === "Cancelled") continue;
    dateByShift.set(String(shift.id), shift.date);
  }

  for (const seat of seats) {
    if (!seat.assignedCrewMemberId) continue;
    if (!COMMITTED_SEAT_STATES.has(seat.state)) continue;
    // Absent ⇒ the seat's shift was excluded, Cancelled, or gone. Same outcome as the
    // per-shift loop's `continue`, reached by lookup instead of by not querying.
    const date = dateByShift.get(String(seat.shiftId));
    if (date === undefined) continue;
    const dates = byCrew.get(seat.assignedCrewMemberId) ?? new Set<string>();
    dates.add(date);
    byCrew.set(seat.assignedCrewMemberId, dates);
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
 * The walk is **reliability-ordered** (§1.4, §2.4): the shared pool is ranked
 * best-first (score + Spink's manual thumb) once, then each seat greedily takes
 * the first still-unused candidate eligible for it — so the pick is the most
 * reliable available person, not an arbitrary one. `now` is the scoring instant.
 * Ranking the union once (not per seat) keeps each crew member's log read a
 * single time per solve. Greedy can still miss an assignment a full matching
 * would find (the classic bipartite-matching gap); acceptable while the pool is
 * tiny — the ask loop is where assignment actually goes live.
 */
export async function solveShift(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
): Promise<ShiftSolution> {
  const pools = await eligiblePool(repo, shiftId);
  const assignment = new Map<SeatId, CrewMemberId>();
  const used = new Set<CrewMemberId>();
  let satisfiable = true;

  // Rank the union of everyone eligible for any seat, once, into a global order.
  const unionIds = [...new Set(pools.flatMap((p) => p.eligible))];
  const order = (await rankEligibleIds(repo, unionIds, now)).map((c) => c.id);

  for (const pool of pools) {
    // Greedy: first globally-ranked candidate eligible for THIS seat and unused
    // (skips anyone claimed by an earlier seat).
    const eligible = new Set(pool.eligible);
    const pick = order.find((id) => eligible.has(id) && !used.has(id));
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

/**
 * Can this shift's remaining seats NOT be crewed from the pool? The "no one left
 * to ask" half of the At-Risk condition (the other half is time vs horizon). Uses
 * `solveShift`'s **distinct-assignment** composite (DEC-003), not per-seat pools:
 * a person already needed by one seat can't also rescue another. (A bare per-seat
 * pool would call a shift fillable when its last candidate is already committed to
 * a sibling seat — the common case on BrewBoat's 2-crew vessels.) A shift with
 * every required seat `Confirmed` is never exhausted (short-circuit, no solve).
 *
 * Lives here (not in `tick.ts`) so both the tick and `ask-loop`'s horizon-aware
 * refresh (DEC-128) can compose it without an import cycle: `oracle.ts` imports
 * neither, while `tick.ts` imports `ask-loop.ts` (#483).
 */
export async function poolExhaustedFor(
  repo: Repository,
  shift: Shift,
  seats: Seat[],
  now: Date,
): Promise<boolean> {
  const unfilled = seats.filter(
    (s) => s.kind === "required" && s.state !== "Confirmed",
  );
  if (unfilled.length === 0) return false;
  const solution = await solveShift(repo, shift.id, now);
  return !solution.satisfiable;
}
