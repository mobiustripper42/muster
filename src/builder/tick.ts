/**
 * The engine tick — advance shifts across their staffing horizon (DEC-023).
 *
 * `tick(repo, now)` is the **explicit** clock operation: it sweeps shifts,
 * resolves each one's state through the horizon layer (`resolveShiftState`,
 * DEC-022), persists any change, and — for a shift newly crossing into
 * `Filling` — **eagerly fires Tier-1 asks** by reusing the ask loop's
 * `broadcastAsk`. The advance must be eager because `Pending`→`Filling` kicks off
 * asking (SPEC §1.1); a lazy on-read derivation could show the state but never
 * send the ask.
 *
 * There is **no scheduler in v1** (DEC-023): who calls `tick` on a timer (a
 * Vercel cron) waits for the first hosted deploy. For now its callers are tests
 * and any manual "run the engine" trigger — exactly how `formShifts` already
 * lives. `now` is injected; the core reads no clock.
 */

import type { Seat, Shift } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { broadcastAsk } from "../asks/ask-loop.js";
import { solveShift } from "../oracle/oracle.js";
import {
  resolveShiftState,
  staffingHorizonFor,
  STAFFING_HORIZON_LEAD_DAYS,
} from "./derive.js";

export interface TickResult {
  /** Shifts whose persisted state changed this tick. */
  shiftsAdvanced: number;
  /** Shifts born/advanced into `Filling` (horizon crossed). */
  bornFilling: number;
  /** Shifts that resolved to `AtRisk` (past horizon, exhausted/no time). */
  toAtRisk: number;
  /**
   * Total Tier-1 asks fired for newly-`Filling` shifts — one per eligible crew
   * per broadcast seat (a 5-deep pool on one seat counts 5), not seats kicked.
   */
  asksFired: number;
}

/**
 * Can this shift's remaining seats NOT be crewed from the pool? The "no one left
 * to ask" half of the At-Risk condition (the other half is time vs horizon). Uses
 * `solveShift`'s **distinct-assignment** composite (DEC-003), not per-seat pools:
 * a person already needed by one seat can't also rescue another. (A bare per-seat
 * pool would call a shift fillable when its last candidate is already committed to
 * a sibling seat — the common case on BrewBoat's 2-crew vessels.) A shift with
 * every required seat `Confirmed` is never exhausted (short-circuit, no solve).
 */
async function poolExhaustedFor(
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

export async function tick(
  repo: Repository,
  now: Date,
  opts?: { leadDays?: number },
): Promise<TickResult> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const allEvents = await repo.listEvents();
  const result: TickResult = {
    shiftsAdvanced: 0,
    bornFilling: 0,
    toAtRisk: 0,
    asksFired: 0,
  };

  for (const shift of await repo.listShifts()) {
    // Lifecycle states are terminal here — a tick never resurrects a cancelled
    // or completed shift (mirrors how #20 guards `Completed` in formShifts).
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;

    const seats = await repo.listSeatsForShift(shift.id);
    const horizon = staffingHorizonFor(shift, allEvents, leadDays);
    const poolExhausted = await poolExhaustedFor(repo, shift, seats, now);
    const next = resolveShiftState(seats, { now, horizon, poolExhausted });
    if (next === shift.state) continue;

    const bornFilling = next === "Filling" && shift.state === "Pending";
    await repo.saveShift({ ...shift, state: next });
    result.shiftsAdvanced++;
    if (next === "AtRisk") result.toAtRisk++;
    if (bornFilling) {
      result.bornFilling++;
      // Eagerly kick Tier-1: broadcast each open required seat. broadcastAsk
      // moves the seat Open→Asked and refreshes the shift state from seats
      // (still `Filling`), so the persisted state stays consistent.
      for (const seat of seats) {
        if (seat.kind === "required" && seat.state === "Open") {
          const asks = await broadcastAsk(repo, seat.id, now);
          result.asksFired += asks.length;
        }
      }
    }
  }

  return result;
}
