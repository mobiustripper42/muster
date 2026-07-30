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

import type { Ask, Seat } from "../domain/entities.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { logNudged } from "../oracle/reliability-log.js";
import { assignPerson, rankedEligible } from "./ask-loop.js";

/** Machine-readable failure reasons — the UI maps these to its own copy. */
export type LeanErrorCode =
  | "shift_gone"
  | "no_gap"
  | "already_asked"
  | "bailed"
  | "ineligible"
  | "raced";

// ── Shared guards (one definition — lean and assignFromPool accept the same
// people, so the cockpit never renders an Assign the action refuses) ──────────

/** A live (unanswered) ask anywhere on the shift — they're already deciding. */
async function holdsLiveAskOnShift(
  repo: Repository,
  requiredSeats: Seat[],
  crewMemberId: CrewMemberId,
): Promise<boolean> {
  for (const seat of requiredSeats) {
    for (const ask of await repo.listAsksForSeat(seat.id)) {
      if (ask.crewMemberId === crewMemberId && ask.respondedAt === undefined) {
        return true;
      }
    }
  }
  return false;
}

/** They walked off this shift — the re-ask excludes them (DEC-019), so do we. */
async function bailedOnShift(
  repo: Repository,
  crewMemberId: CrewMemberId,
  shiftId: ShiftId,
): Promise<boolean> {
  const events = await repo.reliabilityEventsFor(crewMemberId);
  return events.some(
    (e) => e.type === "shift_bailed" && e.metadata.shiftId === shiftId,
  );
}

export interface LeanResult {
  /** null = the nudge went out; otherwise the operator-facing reason it didn't. */
  error: string | null;
  /** Machine twin of `error` — stable across copy edits (DEC-026 feedback). */
  code?: LeanErrorCode;
  /** The seat the person was leaned onto, on success. */
  seatId?: SeatId;
  /**
   * The ask this action fired, on success — surfaced so the EDGE caller can
   * forward it to the injected channel adapter (DEC-030). The loop itself
   * never talks to a transport (DEC-MSG-3).
   */
  ask?: Ask;
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
    return { error: "This shift is no longer live.", code: "shift_gone" };
  }

  const required = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  // Gap = needs a body: Open, resting Bailed (reopened below if leaned onto), or
  // **Asked** (#601). An outstanding ask is not a reservation: DEC-063 makes the drip
  // one candidate per interval, so `Asked` is the NORMAL state of a filling seat, not
  // a transient one. With a 120-minute silent timeout, treating it as "handled" made
  // the seat un-actionable for two hours at a stretch, repeatedly, across the entire
  // fill window — and least actionable exactly when the operator is watching it,
  // because the deadline has passed. The same premise ("a live ask means the seat is
  // covered") was already revisited once for the At-Risk board (`at-risk-board.ts:24`).
  //
  // Settled seats (Claimed/Confirmed) are still not gaps — somebody holds them.
  const gapSeats = required.filter(
    (s) => s.state === "Open" || s.state === "Bailed" || s.state === "Asked",
  );
  if (gapSeats.length === 0) {
    return {
      error: "No seat to fill — nothing to lean for.",
      code: "no_gap",
    };
  }

  // Double-ask guard: a live (unanswered) ask anywhere on this shift means
  // they're already deciding — one pending ask per person per shift.
  if (await holdsLiveAskOnShift(repo, required, crewMemberId)) {
    return {
      error: "Already asked on this shift — awaiting their reply.",
      code: "already_asked",
    };
  }

  // Bailer guard: they walked off this shift; the board doesn't offer them and
  // neither does the action.
  if (await bailedOnShift(repo, crewMemberId, shiftId)) {
    return {
      error: "They bailed on this shift — pick someone else.",
      code: "bailed",
    };
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
    return { error: "Not eligible for this shift's open seats.", code: "ineligible" };
  }

  if (target.state === "Bailed") {
    // Resting precondition (empty pool) no longer holds — reopen, then ask.
    await repo.saveSeat({ ...target, state: "Open" });
  }

  const ask = await assignPerson(repo, target.id, crewMemberId, now);
  if (!ask) {
    return {
      error: "That seat just changed under you — reload the board.",
      code: "raced",
    };
  }
  await logNudged(repo, crewMemberId, target.id, shiftId, now, { manual: true });
  return { error: null, seatId: target.id, ask };
}

/**
 * Assign-from-pool (SPEC §2.4, #54): Spink names one person into one **specific**
 * seat from the cockpit. Same accept set as `lean()` — the shared guards above
 * plus per-seat eligibility — but **no nudge log**: a plain assign is the
 * captain-flow entry (DEC-007), not an escalation. The server action calls this
 * instead of raw `assignPerson` (which deliberately checks nothing) so a crafted
 * form post can't get unlabeled override semantics — `manualOverride` stays the
 * only unguarded path, and its label is the authority trail (DEC-027 §1).
 *
 * `no_gap` here means *this seat* isn't assignable (not Open/Bailed); a Bailed
 * seat is reopened on the way in, exactly as `lean()` does.
 */
export async function assignFromPool(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<LeanResult> {
  const seat = await repo.getSeat(seatId);
  if (!seat) {
    return { error: "That seat is gone — reload.", code: "shift_gone" };
  }
  const shift = await repo.getShift(seat.shiftId);
  if (!shift || shift.state === "Cancelled" || shift.state === "Completed") {
    return { error: "This shift is no longer live.", code: "shift_gone" };
  }
  // Required seats only — same universe as lean's gap scan; a supernumerary
  // seat is unreachable from the cockpit and takes no guarded assign.
  if (
    seat.kind !== "required" ||
    (seat.state !== "Open" && seat.state !== "Bailed")
  ) {
    return {
      error: "That seat isn't open to assign into.",
      code: "no_gap",
    };
  }

  const required = (await repo.listSeatsForShift(seat.shiftId)).filter(
    (s) => s.kind === "required",
  );
  if (await holdsLiveAskOnShift(repo, required, crewMemberId)) {
    return {
      error: "Already asked on this shift — awaiting their reply.",
      code: "already_asked",
    };
  }
  if (await bailedOnShift(repo, crewMemberId, seat.shiftId)) {
    return {
      error: "They bailed on this shift — pick someone else.",
      code: "bailed",
    };
  }

  // Eligibility for THIS seat (distinct-pool enforced inside rankedEligible).
  const pool = await rankedEligible(repo, seat, now);
  if (!pool.some((c) => c.id === crewMemberId)) {
    return { error: "Not eligible for this seat.", code: "ineligible" };
  }

  if (seat.state === "Bailed") {
    // Resting precondition (empty pool) no longer holds — reopen, then ask.
    await repo.saveSeat({ ...seat, state: "Open" });
  }

  const ask = await assignPerson(repo, seat.id, crewMemberId, now);
  if (!ask) {
    return {
      error: "That seat just changed under you — reload.",
      code: "raced",
    };
  }
  return { error: null, seatId: seat.id, ask };
}
