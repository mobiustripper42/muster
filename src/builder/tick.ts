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
import { expireAsks, rankedEligible, widenAsk } from "../asks/ask-loop.js";
import { escalate } from "../asks/escalate.js";
import { solveShift } from "../oracle/oracle.js";
import {
  logBoardLanded,
  SYSTEM_ACTOR_ID,
} from "../oracle/reliability-log.js";
import {
  ASK_DRIP_INTERVAL_MINUTES,
  ASK_SILENT_TIMEOUT_MINUTES,
  earliestScheduledStart,
  fillDeadlineFromEvents,
  FILL_DEADLINE_HOURS,
  resolveShiftState,
  staffingHorizonFor,
  staffingHorizonFromEvents,
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
   * Total Tier-1 asks fired for `Filling` shifts this tick (DEC-063 drip): one
   * per **widen** under pacing, or the whole remaining pool when urgent / blast
   * (`dripMs` 0). Counts asks, not seats kicked.
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
 * Is a seat due for its next drip widen (DEC-063)? An `Open` seat — a fresh birth
 * or a slot that reopened after declines/timeouts — widens **immediately**: don't
 * make the next-ranked candidate wait a fresh interval when the prior choice
 * already fell through. An `Asked` seat (a live ask still out) waits `dripMs` from
 * its most recent ask. (The blast path — urgent / interval 0 — routes around this.)
 */
function widenDue(seat: Seat, asks: Ask[], dripMs: number, now: Date): boolean {
  if (seat.state === "Open") return true;
  const lastMs = Math.max(...asks.map((a) => Date.parse(a.sentAt)));
  return now.getTime() - lastMs >= dripMs;
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
  opts?: {
    leadDays?: number;
    tz?: string;
    dripIntervalMinutes?: number;
    silentTimeoutMinutes?: number;
  },
): Promise<TickResult> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const tz = opts?.tz ?? TENANT_TIMEZONE;
  const dripMs =
    (opts?.dripIntervalMinutes ?? ASK_DRIP_INTERVAL_MINUTES) * 60_000;
  const silentTimeoutMs =
    (opts?.silentTimeoutMinutes ?? ASK_SILENT_TIMEOUT_MINUTES) * 60_000;
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

    // Past-trip guard (#147, DEC-062): once the earliest scheduled trip has
    // departed, the shift is no longer the engine's to work — never broadcast,
    // escalate, or (post-DEC-061) auto-crew a shift whose trip already left the
    // dock. `resolveShiftState` gates the *near* side of the staffing window
    // (before-horizon → Pending); this gates the *far* side. A shift with no
    // scheduled event (`null`) has no departure to be past, so it falls through.
    const ids = new Set(shift.eventIds);
    const events = allEvents.filter((e) => ids.has(e.id));
    const tripStart = earliestScheduledStart(events, tz);
    if (tripStart !== null && tripStart.getTime() <= now.getTime()) continue;

    // #151 (DEC-067): sweep silently-ignored asks BEFORE working the shift. An
    // ask unanswered past the silent-timeout is stamped `ask_ignored` and, if it
    // was the seat's last live ask, the seat reopens — so this tick's state
    // resolution and drip see the reopen (the drip widens past the ghoster; a
    // walked-then-Open seat escalates). expireAsks is idempotent + clock-injected.
    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (seat.kind === "required") {
        await expireAsks(repo, seat.id, now, silentTimeoutMs);
      }
    }

    const seats = await repo.listSeatsForShift(shift.id);
    const horizon = staffingHorizonFromEvents(events, leadDays, tz);
    const poolExhausted = await poolExhaustedFor(repo, shift, seats, now);
    const next = resolveShiftState(seats, { now, horizon, poolExhausted });

    const bornFilling = next === "Filling" && shift.state === "Pending";
    if (next !== shift.state) {
      await repo.saveShift({ ...shift, state: next });
      result.shiftsAdvanced++;
      if (next === "AtRisk") result.toAtRisk++;
    }

    if (next === "Filling") {
      if (bornFilling) result.bornFilling++;
      // Tier-1 fan-out is a staged **drip** (DEC-063): per required seat, seed the
      // top-ranked candidate, then widen by one more each `dripMs` — earlier asks
      // stay open and accumulate, first-acceptable-yes-wins still decides. Inside
      // the fills-by deadline (DEC-031) — or with `dripMs` 0 — blast the remaining
      // pool instead: urgency overrides pacing. Escalate (DEC-024) is the terminal
      // once a seat's whole pool has been walked and it sits `Open` again.
      const fillsBy = fillDeadlineFromEvents(events, FILL_DEADLINE_HOURS, tz);
      const urgent =
        dripMs === 0 || (fillsBy !== null && now.getTime() >= fillsBy.getTime());
      let seatStalled = false; // a fully-walked seat sitting `Open` → Tier-2

      for (const seat of seats) {
        if (seat.kind !== "required") continue;
        if (seat.state !== "Open" && seat.state !== "Asked") continue; // settled/bailed

        const seatAsks = await repo.listAsksForSeat(seat.id);
        const asked = new Set(seatAsks.map((a) => a.crewMemberId));
        const unAsked = await rankedEligible(repo, seat, now, asked);

        if (unAsked.length === 0) {
          // Whole pool walked. If the seat has reopened (all asks closed), it's
          // Tier-2's turn; a still-`Asked` seat just waits on its live asks.
          if (seat.state === "Open") seatStalled = true;
          continue;
        }
        if (urgent) {
          // Blast the remaining un-asked pool this tick (loop the widen primitive).
          let a: Ask | null;
          while ((a = await widenAsk(repo, seat.id, now)) !== null) {
            result.asksFired++;
            result.firedAsks.push(a);
          }
        } else if (widenDue(seat, seatAsks, dripMs, now)) {
          const a = await widenAsk(repo, seat.id, now);
          if (a) {
            result.asksFired++;
            result.firedAsks.push(a);
          }
        }
      }

      if (seatStalled) {
        // Drip walked the whole ranked list and the seat stalled → Tier-2 nudge of
        // the top ghoster (DEC-024). `escalate` self-limits (one nudge per person),
        // so an exhausted shift just re-logs the widen-stub and rides its horizon
        // to At-Risk. It only touches `Open` seats, so a sibling mid-drip `Asked`
        // seat is untouched.
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
  // advance/escalate sweep above so membership reflects this tick's state changes
  // (a bail re-ask that exhausts a pool, a seat reopened). Note (DEC-065): a fresh
  // nudge/ask no longer keeps a near-term uncrewed shift off the board — within the
  // fill deadline it boards regardless of in-flight asks, so the operator IS pinged
  // about it (the point of DEC-065). Dedup memory is one `board_landed` event per
  // (shift, reason) on the system actor's log, so a rescued shift that later
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
