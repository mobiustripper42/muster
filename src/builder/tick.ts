/**
 * The engine tick — advance shifts across their staffing horizon (DEC-023).
 *
 * `tick(repo, now)` is the **explicit** clock operation: it sweeps shifts,
 * resolves each one's state through the horizon layer (`resolveShiftState`,
 * DEC-022), persists any change, and — for a shift newly crossing into
 * `Filling` — **eagerly fires Tier-1 asks** by reusing the ask loop's
 * `widenAsk`. The advance must be eager because `Pending`→`Filling` kicks off
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
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { deriveAtRiskBoard } from "../admin/at-risk-board.js";
import { expireAsks, rankedEligible, widenAsk } from "../asks/ask-loop.js";
import { escalate } from "../asks/escalate.js";
import { buildAskSuppression } from "../asks/suppression.js";
import { poolExhaustedFor } from "../oracle/oracle.js";
import {
  logBoardLanded,
  SYSTEM_ACTOR_ID,
} from "../oracle/reliability-log.js";
import { vesselDateOf, withinCivilWindow } from "../config/tenant.js";
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

const NO_EXCLUDE: ReadonlySet<CrewMemberId> = new Set();

/** Flatten several exclude sets into one — the drip's layered suppression union. */
function unionSets(
  ...sets: ReadonlySet<CrewMemberId>[]
): Set<CrewMemberId> {
  const out = new Set<CrewMemberId>();
  for (const s of sets) for (const id of s) out.add(id);
  return out;
}

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
   * detection half of "landing on the board pings Spink".
   */
  boardLanded: number;
  /**
   * The newly-recorded landings themselves (DEC-095) — the delivery seam for the
   * operator alert, sibling to `firedAsks`. Populated ONLY in the dedup branch,
   * so it holds first-detections + regressions this tick, NEVER full board
   * membership: a steady-state board yields `[]` (no re-blast). The edge
   * (`app/lib/alert.ts`) SMSes the active admins; core stays transport-free.
   */
  boardLandings: { shiftId: string; reason: string }[];
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
    /** Test injection — defaults to the tenant CIVIL_SEND_* constants (DEC-088). */
    civilWindow?: { start: string; end: string };
  },
): Promise<TickResult> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const tz = opts?.tz ?? TENANT_TIMEZONE;
  const dripMs =
    (opts?.dripIntervalMinutes ?? ASK_DRIP_INTERVAL_MINUTES) * 60_000;
  const silentTimeoutMs =
    (opts?.silentTimeoutMinutes ?? ASK_SILENT_TIMEOUT_MINUTES) * 60_000;
  const allEvents = await repo.listEvents();
  // Send-time ask suppression (DEC-129 working, DEC-130 decline-cooldown), built
  // once per tick — the autonomous ask paths filter candidates through it below.
  // Kept out of eligibility on purpose: an all-suppressed pool still resolves
  // `Filling` (defer ≠ exhaustion), so `poolExhaustedFor`/`resolveShiftState`
  // above are unaffected.
  const suppression = await buildAskSuppression(repo, now, tz);
  const result: TickResult = {
    shiftsAdvanced: 0,
    bornFilling: 0,
    toAtRisk: 0,
    asksFired: 0,
    shiftsEscalated: 0,
    nudgesFired: 0,
    boardLanded: 0,
    boardLandings: [],
    firedAsks: [],
  };

  // One-boat-per-day (#393): a crew member holds at most one live ask across the
  // boats running a given vessel-local trip day, so same-day boats spread across
  // people instead of all seeding the top candidate. `askedOnDay` maps a trip day
  // → the crew already holding (or seeded, this tick) a live ask that day; the
  // drip excludes them. Pre-seeded from EXISTING live asks (prior ticks) so a
  // later widen can't re-ask someone already holding a same-day boat.
  const askedOnDay = new Map<string, Set<CrewMemberId>>();
  const markAskedOnDay = (day: string, crewId: CrewMemberId): void => {
    const set = askedOnDay.get(day);
    if (set) set.add(crewId);
    else askedOnDay.set(day, new Set([crewId]));
  };
  {
    const seatDay = new Map<SeatId, string>();
    for (const s of await repo.listShifts()) {
      if (s.state === "Cancelled" || s.state === "Completed") continue;
      const ids = new Set(s.eventIds);
      const ts = earliestScheduledStart(
        allEvents.filter((e) => ids.has(e.id)),
        tz,
      );
      if (ts === null) continue;
      const day = vesselDateOf(ts, tz);
      for (const seat of await repo.listSeatsForShift(s.id)) {
        // Only seats still IN PLAY reserve a person for the day. A Claimed/
        // Confirmed seat's asks must not: the winner is already kept off other
        // same-day boats by the committed-dates eligibility gate, and the LOSING
        // broadcast siblings (never swept on a filled seat, DEC-067) are free —
        // bucketing either would silently, permanently shrink every other
        // same-day boat's drip pool for anyone who ever lost a broadcast.
        if (seat.state === "Open" || seat.state === "Asked") {
          seatDay.set(seat.id, day);
        }
      }
    }
    for (const ask of await repo.listAllAsks()) {
      if (ask.respondedAt !== undefined) continue; // only LIVE asks reserve a day
      const day = seatDay.get(ask.seatId);
      if (day) markAskedOnDay(day, ask.crewMemberId);
    }
  }

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
    // The shift's vessel-local trip day — the key for the one-boat-per-day drip
    // exclusion (#393). `null` when nothing's scheduled (no day to reserve).
    const tripDay = tripStart !== null ? vesselDateOf(tripStart, tz) : null;

    // #151 (DEC-067): sweep silently-ignored asks BEFORE working the shift, but
    // ONLY on `Asked` seats — the ones with a live ask whose timeout is meaningful.
    // A FILLED seat (Claimed/Confirmed) still carries the losing recipients' live
    // sibling asks (a broadcast/blast doesn't close the losers); sweeping those
    // would wrongly log `ask_ignored` against people who never ghosted a fillable
    // seat and poison the ranker (DEC-008). On an `Asked` seat, an ask past the
    // timeout is stamped `ask_ignored` and, if it was the last live ask, the seat
    // reopens — so this tick's state resolution + drip see the reopen (drip widens
    // past the ghoster; a walked-then-Open seat escalates). Idempotent + clock-injected.
    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (seat.kind === "required" && seat.state === "Asked") {
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
      // Civil send window (DEC-088): outside vessel-local civil hours the
      // engine's own initiative defers — no drip, no blast, no Tier-2. State
      // advance and the DEC-067 timeout sweep already ran above; board-landing
      // detection is a separate pass AFTER this loop, unaffected by any
      // shift's continue. Nothing queues: the first in-window tick fires
      // naturally (`widenDue` is immediately true for an Open seat, and an
      // Asked seat's drip interval elapsed overnight).
      if (!withinCivilWindow(now, tz, opts?.civilWindow)) continue;
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
          // Urgent fills at all costs — EXCEPT a WORKING crew member is never asked
          // (DEC-129 hard, no valve even under urgency). Decliners ARE blasted: past
          // fills-by the seat is board-imminent, so the cooldown yields to urgency
          // (DEC-130). Picks still count toward #393 spreading for later drip seats.
          let a: Ask | null;
          while ((a = await widenAsk(repo, seat.id, now, suppression.working)) !== null) {
            result.asksFired++;
            result.firedAsks.push(a);
            if (tripDay !== null) markAskedOnDay(tripDay, a.crewMemberId);
          }
        } else if (widenDue(seat, seatAsks, dripMs, now)) {
          // Drip candidate-filter precedence: HARD `working` (DEC-129) + the #393
          // one-boat-per-day spread come off first; then the SOFT same-day decline
          // cooldown (DEC-130), with a last-resort valve. `widenAsk` re-derives the
          // pick from the same exclude union, so its choice equals the branch here.
          const dayExcl =
            tripDay !== null ? (askedOnDay.get(tripDay) ?? NO_EXCLUDE) : NO_EXCLUDE;
          const declined = suppression.declinedOnDay.get(shift.date) ?? NO_EXCLUDE;
          const base = unAsked.filter(
            (c) => !dayExcl.has(c.id) && !suppression.working.has(c.id),
          );
          const fresh = base.filter((c) => !declined.has(c.id));
          let excl: ReadonlySet<CrewMemberId> | null;
          if (fresh.length > 0) {
            excl = unionSets(dayExcl, suppression.working, declined);
          } else if (base.length > 0) {
            // Valve: everyone un-asked left is a same-day decliner — re-ask the top
            // one rather than let a fillable seat exhaust (DEC-130). Never a worker.
            excl = unionSets(dayExcl, suppression.working);
          } else {
            // Defer (DEC-129/130): the only un-asked candidates are working — skip
            // this tick. No stall flag (that stays keyed on the suppression-free
            // pre-check above → no false Tier-2), no AtRisk. `widenDue` re-arms next tick.
            excl = null;
          }
          if (excl !== null) {
            const a = await widenAsk(repo, seat.id, now, excl);
            if (a) {
              result.asksFired++;
              result.firedAsks.push(a);
              if (tripDay !== null) markAskedOnDay(tripDay, a.crewMemberId);
            }
          }
        }
      }

      if (seatStalled) {
        // Drip walked the whole ranked list and the seat stalled → Tier-2 nudge of
        // the top ghoster (DEC-024). `escalate` self-limits (one nudge per person),
        // so an exhausted shift just re-logs the widen-stub and rides its horizon
        // to At-Risk. It only touches `Open` seats, so a sibling mid-drip `Asked`
        // seat is untouched.
        const out = await escalate(repo, shift.id, now, suppression);
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
        // Surface the new landing for the operator alert (DEC-095). Only here —
        // inside the dedup guard — so an unchanged board re-blasts nobody.
        result.boardLandings.push({ shiftId: row.shiftId, reason });
      }
    }
  }

  return result;
}
