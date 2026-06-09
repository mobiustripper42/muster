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
import { eligiblePool } from "../oracle/oracle.js";
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
  /** Tier-1 asks fired for newly-`Filling` shifts' open required seats. */
  asksFired: number;
}

/**
 * Does an unfilled required seat have an empty eligible pool? The "no one left to
 * ask" half of the At-Risk condition (the other half is time vs horizon). A shift
 * with every required seat `Confirmed` is never exhausted.
 */
async function poolExhaustedFor(
  repo: Repository,
  shift: Shift,
  seats: Seat[],
): Promise<boolean> {
  const unfilled = seats.filter(
    (s) => s.kind === "required" && s.state !== "Confirmed",
  );
  if (unfilled.length === 0) return false;
  const pools = await eligiblePool(repo, shift.id);
  const eligibleBySeat = new Map(pools.map((p) => [p.seatId, p.eligible.length]));
  return unfilled.some((s) => (eligibleBySeat.get(s.id) ?? 0) === 0);
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
    const poolExhausted = await poolExhaustedFor(repo, shift, seats);
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
          if (asks.length > 0) result.asksFired += asks.length;
        }
      }
    }
  }

  return result;
}
