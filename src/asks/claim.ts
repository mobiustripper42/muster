/**
 * The self-claim write door (SPEC §2.7.2/2.7.3, DEC-075/078) — the inverse of
 * `claimableSeatsFor` (the read door, `src/oracle/claimable.ts`). A crew member
 * grabs an Open seat and it auto-locks to `Confirmed`; or releases one they hold,
 * which re-opens + re-asks via the existing bail edge.
 *
 * Lives in the `asks` transition layer (not `oracle`) so it can compose both the
 * eligibility reads (`oracle`) and the seat-machine writes (`ask-loop`:
 * `refreshShiftState`, the `saveSeatIfState` CAS idiom, `bailWithDerivedLateness`)
 * — the dependency runs asks → oracle, never the reverse.
 *
 * Two domain invariants this module owns (DEC-DATA-1 — integrity lives in the
 * service, the no-FK store enforces nothing):
 *  - **First-come is atomic** (DEC-078): the claim is a guarded `Open → Confirmed`
 *    CAS, so two taps on one seat yield exactly one winner, no locking.
 *  - **The passed `seatId` is never trusted** (DEC-076): the browse list could be
 *    stale or forged, so claim re-validates the *full* claimable predicate
 *    server-side — native role, window, seat shape, and the §1.3 eligible-pool
 *    gate — before any write.
 */

import { addDays, vesselDateOf } from "../config/tenant.js";
import type { Seat } from "../domain/entities.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import {
  CLAIMABLE_SEAT_STATES,
  CLAIMABLE_SHIFT_STATES,
  CLAIMABLE_WINDOW_DAYS,
} from "../oracle/claimable.js";
import type { CandidateVerdict } from "../oracle/eligibility.js";
import { evaluateCandidate, nativeRole } from "../oracle/eligibility.js";
import { committedDatesByCrew } from "../oracle/oracle.js";
import { logSelfClaim } from "../oracle/reliability-log.js";
import type { Repository } from "../ports/repository.js";
import type { DerivedBailResult } from "./ask-loop.js";
import {
  bailWithDerivedLateness,
  refreshShiftState,
  withdrawLiveAsks,
} from "./ask-loop.js";

export interface ClaimResult {
  /**
   * null = the seat is now `Confirmed` to this crew member (`seat` is set).
   * - `gone` — no such crew/seat/shift, or the crew member is inactive.
   * - `not_claimable` — the seat isn't in this member's claimable set: shift not
   *   `Pending`/`Filling`, outside the today+window horizon, seat not `Open`, not
   *   `required`, or not the member's native role (DEC-076).
   * - `conflict` — already holds a committed seat on a *different* shift that date
   *   (the one-shift-per-date whole-day rule, DEC-078).
   * - `ineligible` — failed a §1.3 eligible-pool rule other than double-booking
   *   (inactive / unrated / lapsed MMC / on PTO); `failures` carries the detail.
   * - `requires_confirmation` — the `self_claim_requires_confirmation` gate is on,
   *   so the claim routes to the reserved Held tier — STUB ONLY, no write, tier
   *   not built (DEC-075).
   * - `just_taken` — lost the optimistic CAS race; someone confirmed it first
   *   (DEC-078). The caller should refresh the list.
   */
  code:
    | "gone"
    | "not_claimable"
    | "conflict"
    | "ineligible"
    | "requires_confirmation"
    | "just_taken"
    | null;
  seat?: Seat;
  /** The failed eligibility rules — only set alongside `ineligible`. */
  failures?: CandidateVerdict["failures"];
}

/**
 * Claim an Open seat for a crew member (`Open → Confirmed`, auto-lock — DEC-075).
 *
 * Re-validates the *whole* claimable predicate (it never trusts `seatId`), then
 * does the guarded CAS. On a win it emits `self_claim` (+4) — #570's amendment to
 * DEC-078, which had reliability earned only at `Completed`. That rule made
 * self-serve all downside: releasing a claimed seat already ran through the bail
 * edge (−3 plus lateness) while taking one scored nothing. DEC-078's adjacent
 * *"Rejected: reliability-dinging the claim"* line is untouched and still stands —
 * that was about penalizing a claim, and this is the opposite direction.
 */
export async function claimSeat(
  repo: Repository,
  crewId: CrewMemberId,
  seatId: SeatId,
  now: Date,
  windowDays: number = CLAIMABLE_WINDOW_DAYS,
): Promise<ClaimResult> {
  const crew = await repo.getCrewMember(crewId);
  if (!crew || crew.status !== "active") return { code: "gone" };

  const seat = await repo.getSeat(seatId);
  if (!seat) return { code: "gone" };
  const shift = await repo.getShift(seat.shiftId);
  if (!shift) return { code: "gone" };

  // The same filters `claimableSeatsFor` applies, per seat — shared constants so
  // the read and write doors can't drift on which shifts/window/shape qualify.
  const today = vesselDateOf(now); // vessel-local (DEC-032), not a UTC slice
  const until = addDays(today, windowDays);
  if (
    !CLAIMABLE_SHIFT_STATES.has(shift.state) ||
    shift.date < today ||
    shift.date > until ||
    !CLAIMABLE_SEAT_STATES.has(seat.state) || // uncommitted: Open/Asked/Bailed (#440)
    seat.kind !== "required" ||
    seat.role !== nativeRole(crew) // native-role-only door (DEC-076)
  ) {
    return { code: "not_claimable" };
  }

  // §1.3 eligible-pool gate (active / rating / MMC valid on date / not
  // double-booked / not on PTO). `committedDates` over Claimed+Confirmed seats:
  // its `not_double_booked` rule IS DEC-078's one-shift-per-date conflict guard
  // (a same-date commitment on another committed seat — another shift, or another
  // seat on this one). No bespoke guard — one definition of double-booked
  // (DEC-DATA-1).
  //
  // KNOWN GAP (pilot-accepted, not a closed hole): this read-then-CAS guards one
  // seat, not the cross-seat invariant. Two *concurrent* claims by the same crew
  // for *different* same-date shifts both read an empty `committedDates`, both
  // pass `notDoubleBooked`, and each per-seat CAS wins → confirmed to two boats
  // the same day. Same window class as `recordResponse`'s `committedOnShift`
  // check; the no-FK store can't enforce a crew+date uniqueness, so the cross-
  // record invariant is the integrity tripwire's job (service-layer-integrity
  // discipline), not the hot path. Narrow at pilot scale (needs two in-flight
  // taps); revisit if double-confirms actually appear.
  const [credentials, ptoWindows, committedByCrew] = await Promise.all([
    repo.listCredentialsForCrew(crewId),
    repo.listPtoWindowsForCrew(crewId),
    committedDatesByCrew(repo),
  ]);
  const committedDates = committedByCrew.get(crewId) ?? new Set<string>();
  const verdict = evaluateCandidate(
    { crew, credentials, ptoWindows, committedDates },
    seat.role,
    shift.date,
  );
  if (!verdict.eligible) {
    const doubleBooked = verdict.failures.some(
      (f) => f.ruleId === "not_double_booked",
    );
    return doubleBooked
      ? { code: "conflict" }
      : { code: "ineligible", failures: verdict.failures };
  }

  // The reserved confirm-gate seam (DEC-075): when on, a self-claim would land in
  // the Held/Claimed tier pending operator confirm. That tier is NOT built —
  // branch covered, no write. Flipping the flag later is a queue + tier, not a
  // re-architecture here.
  if (await repo.selfClaimRequiresConfirmation()) {
    return { code: "requires_confirmation" };
  }

  // Guarded first-come transition (DEC-078 / REQ-CLAIM-1): write Confirmed ONLY
  // if the seat is still in the state we validated. Loser of a race gets a clean
  // "just taken".
  //
  // Pinned to `seat.state`, not the literal `"Open"` (#440): a claimable seat can
  // now be Open, Asked or Bailed, and the CAS must guard whichever one we actually
  // read. Pinning the read state keeps first-come atomic across all three — if the
  // engine asks an Open seat, or anyone commits it, between our read and this
  // write, the swap fails rather than clobbering the newer state.
  const confirmed: Seat = {
    ...seat,
    state: "Confirmed",
    assignedCrewMemberId: crewId,
    // Provenance (#196): a self-claim is an opt-in, so My shifts must NOT badge it
    // "Added for you" — that badge fires only on `acquiredVia === "operator"`.
    acquiredVia: "self_claim",
  };
  const won = await repo.saveSeatIfState(confirmed, seat.state);
  if (!won) return { code: "just_taken" };
  // Logged only on the CAS WIN (#570) — a loser of the race took no seat, so the
  // +4 must not accrue to them. Same discipline as `recordResponse`'s contested
  // accept, inverted: that logs responsiveness regardless because answering IS the
  // behavior scored; this scores *acquiring*, which only the winner did.
  await logSelfClaim(repo, crewId, seat.id, seat.shiftId, now);
  // #600 / DEC-145: this is the THIRD fill door and it needs the same retirement as
  // the CAS win and the operator override. A claimable seat can be `Asked` (#440), so
  // a self-claim routinely lands on a seat with live asks out — and leaving them armed
  // reproduces the original bug exactly: un-swept while the seat is filled, then
  // `ask_ignored` for everyone the moment it reopens. No `exceptAskId`: the claimant
  // may hold their own live ask on this seat and took it through a different door, so
  // that one is moot too.
  await withdrawLiveAsks(repo, seat.id, now);
  await refreshShiftState(repo, seat.shiftId);
  return { code: null, seat: confirmed };
}

/**
 * Release a confirmed seat the crew member holds (`Confirmed → Open`, re-open +
 * re-ask — DEC-078). Provenance-agnostic: it bails any `Confirmed` seat they
 * occupy, whether self-claimed or operator-assigned — a "can't make it" is a bail
 * regardless of how the seat was acquired, and the release surface only ever lists
 * seats they hold. (The asymmetry with `claimSeat`, which is native-role + window
 * + Open gated, is intended.)
 *
 * A thin authorization wrapper over the existing bail edge: it pins the occupant
 * to `crewId`, so a crew member can only release a seat **they** hold — never bail
 * someone else by passing their `seatId`. The bail edge re-opens the seat and
 * emits one `shift_bailed` reliability event **lead-time-weighted** by the §1.4 /
 * DEC-008 machinery (a release weeks out barely registers; a near-departure
 * release is weighted as a real bail). Re-crewing is the tick's job now, not an
 * inline re-ask (DEC-128, #483). No new cutoff.
 *
 * Returns the bail edge's result: `code: null` = released, `code: "raced"` = the
 * seat moved underfoot or isn't this member's (reload).
 */
export async function releaseSelfClaim(
  repo: Repository,
  crewId: CrewMemberId,
  seatId: SeatId,
  now: Date,
): Promise<DerivedBailResult> {
  return bailWithDerivedLateness(repo, seatId, now, crewId);
}
