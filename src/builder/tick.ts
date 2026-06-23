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
 *
 * **Pause is enforced at the cron edge, NOT here** (#124, DEC-054): the operator
 * pause flag is checked in `app/api/cron/tick/route.ts`, which skips calling
 * `tick` when paused — `tick` stays pure (pause is an ops concern, not engine
 * logic). Any *new* autonomous caller of `tick` must check `isEnginePaused`
 * itself; the dev CLI (`db/tick-dev.ts`) and manual cockpit asks bypass by design.
 */

import type { Ask, Seat, Shift } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { deriveAtRiskBoard } from "../admin/at-risk-board.js";
import { broadcastAsk } from "../asks/ask-loop.js";
import { escalate } from "../asks/escalate.js";
import { solveShift } from "../oracle/oracle.js";
import {
  logBoardLanded,
  SYSTEM_ACTOR_ID,
} from "../oracle/reliability-log.js";
import {
  resolveShiftState,
  staffingHorizonFor,
  STAFFING_HORIZON_LEAD_DAYS,
} from "./derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";

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
  /** `Filling` shifts that hit the Tier-2 stall path this tick (DEC-024). */
  shiftsEscalated: number;
  /** Total Tier-2 direct-nudges fired across escalated shifts. */
  nudgesFired: number;
  /**
   * New (shift, reason) board landings recorded this tick (DEC-026) — the
   * detection half of "landing on the board pings Spink"; delivery rides the
   * DEC-MSG-3 pilot adapter later.
   */
  boardLanded: number;
  /**
   * Every ask this tick fired — Tier-1 broadcasts AND Tier-2 nudges — surfaced
   * so the tick's TRIGGER (the dev script today, a cron route later) can
   * forward them to the injected channel adapter (DEC-030). The core never
   * talks to a transport (DEC-MSG-3); this return value is the seam.
   */
  firedAsks: Ask[];
}

/**
 * Has Tier-1 stalled on this `Filling` shift? True when a required seat is `Open`
 * (the broadcast came back declined/silent and the seat reopened) and **nothing**
 * is mid-flight — no required seat is `Asked` (a live ask) or `Claimed` (an
 * accepted, unconfirmed yes). A live ask means Tier-1 is still working; only the
 * dead-quiet shift is Tier-2's job (DEC-024). `Bailed` seats are the Tier-3 path
 * (DEC-019) and don't gate this.
 */
function isStalled(seats: Seat[]): boolean {
  const required = seats.filter((s) => s.kind === "required");
  const hasOpen = required.some((s) => s.state === "Open");
  const inFlight = required.some(
    (s) => s.state === "Asked" || s.state === "Claimed",
  );
  return hasOpen && !inFlight;
}

/**
 * Has Tier-1 ever fired on this shift? True once any required seat carries an ask
 * (sent, answered, or timed out). The signal that separates a genuine birth
 * (broadcast Tier-1) from a stalled re-engagement (escalate Tier-2) — see the call
 * site for why the Pending→Filling transition can't tell them apart.
 */
async function shiftEverAsked(repo: Repository, seats: Seat[]): Promise<boolean> {
  for (const seat of seats) {
    if (seat.kind !== "required") continue;
    if ((await repo.listAsksForSeat(seat.id)).length > 0) return true;
  }
  return false;
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

/**
 * Resolve ONE shift's state on read (the DEC-023 corollary) — for display
 * surfaces that must not trust the persisted, eventually-consistent badge
 * (e.g. the assignment page a board row links to). Single-shift, repo-backed
 * composition of the same pieces tick's batch loop and the board's trail-reuse
 * inline for their own structural reasons. `null` when the shift is unknown.
 */
export async function resolveShiftStateOnRead(
  repo: Repository,
  shiftId: Shift["id"],
  now: Date,
  opts?: { leadDays?: number; tz?: string },
): Promise<Shift["state"] | null> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return null;
  const seats = await repo.listSeatsForShift(shiftId);
  const horizon = staffingHorizonFor(
    shift,
    await repo.listEvents(),
    opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS,
    opts?.tz ?? TENANT_TIMEZONE,
  );
  const poolExhausted = await poolExhaustedFor(repo, shift, seats, now);
  return resolveShiftState(seats, { now, horizon, poolExhausted });
}

export async function tick(
  repo: Repository,
  now: Date,
  opts?: { leadDays?: number; tz?: string },
): Promise<TickResult> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const tz = opts?.tz ?? TENANT_TIMEZONE;
  const allEvents = await repo.listEvents();
  const result: TickResult = {
    shiftsAdvanced: 0,
    bornFilling: 0,
    toAtRisk: 0,
    asksFired: 0,
    shiftsEscalated: 0,
    nudgesFired: 0,
    boardLanded: 0,
    firedAsks: [],
  };

  for (const shift of await repo.listShifts()) {
    // Lifecycle states are terminal here — a tick never resurrects a cancelled
    // or completed shift (mirrors how #20 guards `Completed` in formShifts).
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;

    const seats = await repo.listSeatsForShift(shift.id);
    const horizon = staffingHorizonFor(shift, allEvents, leadDays, tz);
    const poolExhausted = await poolExhaustedFor(repo, shift, seats, now);
    const next = resolveShiftState(seats, { now, horizon, poolExhausted });

    const bornFilling = next === "Filling" && shift.state === "Pending";
    if (next !== shift.state) {
      await repo.saveShift({ ...shift, state: next });
      result.shiftsAdvanced++;
      if (next === "AtRisk") result.toAtRisk++;
    }

    if (next === "Filling") {
      // Tier-1 vs Tier-2 turns on whether the shift was *ever asked*, not on the
      // Pending→Filling transition: a stalled shift whose seats reopened reads as
      // `Pending` again (the seat-fold can't tell "never asked" from "all
      // declined/timed-out"), so the transition alone would re-broadcast Tier-1
      // forever and never escalate. Prior asks ⇒ Tier-1 already ran ⇒ Tier-2.
      const everAsked = await shiftEverAsked(repo, seats);
      if (!everAsked) {
        if (bornFilling) result.bornFilling++;
        // Eagerly kick Tier-1: broadcast each open required seat. broadcastAsk
        // moves the seat Open→Asked and refreshes the shift state from seats
        // (still `Filling`), so the persisted state stays consistent.
        for (const seat of seats) {
          if (seat.kind === "required" && seat.state === "Open") {
            const asks = await broadcastAsk(repo, seat.id, now);
            result.asksFired += asks.length;
            result.firedAsks.push(...asks);
          }
        }
      } else if (isStalled(seats)) {
        // Tier-1 ran dry on an already-worked shift (the gap a born-once
        // broadcast leaves) → Tier-2 (DEC-024). `escalate` self-limits, so a
        // shift with nothing left to nudge just re-logs the widen-stub and rides
        // its horizon to At-Risk on a later tick.
        const out = await escalate(repo, shift.id, now);
        if (out.widened) {
          result.shiftsEscalated++;
          result.nudgesFired += out.nudged.length;
          result.firedAsks.push(...out.asks);
        }
      }
    }
  }

  // ── Board-landing detection (DEC-026) ───────────────────────────────────────
  // Membership stays single-sourced: tick asks the SAME deriver the board page
  // renders, never a hand-rolled "did it land" check. Derived AFTER the
  // advance/escalate sweep above — load-bearing order: a fresh Tier-2 nudge is a
  // live ask, which keeps the shift off the board this tick (the nudge gets its
  // chance before Spink is summoned). Dedup memory is one `board_landed` event
  // per (shift, reason) on the system actor's log, so a rescued shift that later
  // REGRESSES re-pings while a same-reason re-landing stays quiet.
  const seenLandings = new Set(
    (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID))
      .filter((e) => e.type === "board_landed")
      .map((e) => `${e.metadata.shiftId}:${e.metadata.reason}`),
  );
  for (const row of await deriveAtRiskBoard(repo, now, { leadDays, tz })) {
    for (const reason of row.reasons) {
      if (!seenLandings.has(`${row.shiftId}:${reason}`)) {
        await logBoardLanded(repo, row.shiftId, reason, now);
        result.boardLanded++;
      }
    }
  }

  return result;
}
