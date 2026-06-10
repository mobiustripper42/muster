/**
 * The lean (SPEC §2.5, #43, DEC-026) — Spink's manual Tier-2 direct nudge from
 * an At-Risk board row: "I need you on this", aimed at one specific person.
 *
 * A lean is an **ask**, not the override hammer (`manualOverride` confirms
 * regardless of pool; a lean still asks and the person still answers In/Out).
 * Mechanically it is exactly `escalate`'s per-person move — `assignPerson` +
 * `logNudged` — manually targeted, with the nudge flagged `manual: true` so the
 * one log keeps "the human had to step in" distinguishable from engine nudges
 * (DEC-026). No payment or customer-comms fallout, by construction.
 *
 * Target validation mirrors the board's `available` semantics (the server action
 * is an API — it must not accept a name the board deliberately hides):
 *  - eligible for a gap seat per `rankedEligible` (distinct-pool, DEC-003);
 *  - not holding a live ask on this shift (one pending ask per person per
 *    shift — the double-ask guard escalate gets from its mid-flight exclusion);
 *  - not someone who bailed on this shift (the re-ask already excludes them,
 *    DEC-019; the board's list does too).
 *  Decliners stay leanable — leaning on a "no" is Spink's call (§2.5).
 *
 * A resting-`Bailed` gap seat is reopened on the way in: it rested only because
 * the pool was empty at bail time (DEC-019), and a valid lean target means that
 * precondition no longer holds — reopen + ask is what `bail()` itself would
 * have done had the candidate existed then.
 *
 * No `escalation_accepted`/`at_risk_rescue` bonus on the eventual yes — both
 * stay reserved (DEC-024 amendment; DEC-026 names the lean-accept as the future
 * `at_risk_rescue` hook, derivable retroactively from the flagged log).
 */

import type { Seat } from "../domain/entities.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { logNudged } from "../oracle/reliability-log.js";
import { assignPerson, rankedEligible } from "./ask-loop.js";

export interface LeanResult {
  /** null = the nudge went out; otherwise the operator-facing reason it didn't. */
  error: string | null;
  /** The seat the person was leaned onto, on success. */
  seatId?: SeatId;
}

/** Direct-nudge `crewMemberId` onto the first gap seat of `shiftId` they can fill. */
export async function lean(
  repo: Repository,
  shiftId: ShiftId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<LeanResult> {
  const shift = await repo.getShift(shiftId);
  if (!shift || shift.state === "Cancelled" || shift.state === "Completed") {
    return { error: "This shift is no longer live." };
  }

  const required = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  // Gap = needs a body: Open, or resting Bailed (reopened below if leaned onto).
  const gapSeats = required.filter(
    (s) => s.state === "Open" || s.state === "Bailed",
  );
  if (gapSeats.length === 0) {
    return { error: "No open seat to fill — nothing to lean for." };
  }

  // Double-ask guard: a live (unanswered) ask anywhere on this shift means
  // they're already deciding — one pending ask per person per shift.
  for (const seat of required) {
    for (const ask of await repo.listAsksForSeat(seat.id)) {
      if (ask.crewMemberId === crewMemberId && ask.respondedAt === undefined) {
        return { error: "Already asked on this shift — awaiting their reply." };
      }
    }
  }

  // Bailer guard: they walked off this shift; the board doesn't offer them and
  // neither does the action.
  const events = await repo.reliabilityEventsFor(crewMemberId);
  if (
    events.some(
      (e) => e.type === "shift_bailed" && e.metadata.shiftId === shiftId,
    )
  ) {
    return { error: "They bailed on this shift — pick someone else." };
  }

  // First gap seat (seat order) whose eligible pool includes them.
  // rankedEligible enforces distinct-pool (DEC-003) internally.
  let target: Seat | undefined;
  for (const seat of gapSeats) {
    const pool = await rankedEligible(repo, seat, now);
    if (pool.some((c) => c.id === crewMemberId)) {
      target = seat;
      break;
    }
  }
  if (!target) {
    return { error: "Not eligible for this shift's open seats." };
  }

  if (target.state === "Bailed") {
    // Resting precondition (empty pool) no longer holds — reopen, then ask.
    await repo.saveSeat({ ...target, state: "Open" });
  }

  const ask = await assignPerson(repo, target.id, crewMemberId, now);
  if (!ask) {
    return { error: "That seat just changed under you — reload the board." };
  }
  await logNudged(repo, crewMemberId, target.id, shiftId, now, { manual: true });
  return { error: null, seatId: target.id };
}
