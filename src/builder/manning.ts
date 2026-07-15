/**
 * Seat/manning override (SPEC §2.3, 8.5) — the operator adjusts a shift's manning
 * beyond the derived COI minimum. `deriveSeats` builds only the vessel's COI manning;
 * these are ADDITIVE, operator-owned seats marked `override` so `formShifts`' prune
 * leaves them alone (they survive Xola re-import, like the split cut). A required
 * override gates `Crewed` (deriveShiftState folds all required seats); a
 * supernumerary/trainee doesn't (DEC-005).
 *
 * Distinct from `overrideSeat` (asks/ask-loop) — that force-places a PERSON into a
 * seat (DEC-064); this adds/removes the SEAT itself.
 */

import type { Repository } from "../ports/repository.js";
import type { Seat } from "../domain/entities.js";
import type { SeatKind } from "../domain/states.js";
import type { CrewMemberId, ShiftId, SeatId, RoleTypeId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { manualOverride, refreshShiftState } from "../asks/ask-loop.js";
import { evaluateTraineeCandidate } from "../oracle/eligibility.js";
import { committedDatesByCrew } from "../oracle/oracle.js";

/**
 * Add an operator-override seat (a required hand or a supernumerary/trainee) to a
 * shift. Born `Open` + `override:true`; returns the new seat. Throws if the shift is
 * gone. Its id is namespaced `seat-{shiftId}-ovr-{role}-{n}` so it can't collide with
 * a derived `seat-{shiftId}-{role}-{n}`.
 */
export async function addOverrideSeat(
  repo: Repository,
  shiftId: ShiftId,
  kind: SeatKind,
  role: RoleTypeId,
): Promise<Seat> {
  const shift = await repo.getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);

  // `n` = next index for this (shift, role) override family. Non-atomic (two
  // simultaneous adds would compute the same `n`; the second upsert overwrites the
  // first) — fine under single-operator pilot use; revisit with a monotonic suffix
  // if adds ever go concurrent.
  const prefix = `seat-${shiftId}-ovr-${role}-`;
  const n =
    (await repo.listSeatsForShift(shiftId)).filter((s) =>
      String(s.id).startsWith(prefix),
    ).length + 1;
  const seat: Seat = {
    id: asId<"SeatId">(`${prefix}${n}`),
    shiftId,
    role,
    kind,
    state: "Open",
    override: true,
  };
  await repo.saveSeat(seat);
  // A new REQUIRED seat can drop the shift out of Crewed; re-derive (DEC-005). A
  // supernumerary changes nothing (it doesn't gate), but re-deriving is harmless.
  await refreshShiftState(repo, shiftId);
  return seat;
}

/**
 * Remove an operator-override seat. Guards: the seat must exist, be an `override`
 * seat (a derived COI seat is not removable this way), and be `Open` — an occupied
 * override seat must be VACATED first (the cockpit's no-penalty Remove), so this
 * never strands crew or orphans a live ask (the automationPaused question is
 * sidestepped for the slice). Throws otherwise; the caller maps to inline feedback.
 */
export async function removeOverrideSeat(
  repo: Repository,
  seatId: SeatId,
): Promise<void> {
  const seat = await repo.getSeat(seatId);
  if (!seat) throw new Error(`No seat ${seatId}`);
  if (!seat.override) throw new Error(`Seat ${seatId} is not an override seat`);
  if (seat.state !== "Open") {
    throw new Error(`Seat ${seatId} is occupied — vacate the crew before removing it`);
  }
  await repo.removeSeat(seatId);
  await refreshShiftState(repo, seat.shiftId);
}

export interface StaffTraineeResult {
  /**
   * null = staffed. `not_trainee_seat` = the seat isn't supernumerary (the
   * DEC-064-guarded `overrideSeat` is the required-seat path). `occupied` =
   * someone's already riding it. `ineligible` = failed the trainee rule set.
   * `gone` = no such seat/crew/shift.
   */
  code: "not_trainee_seat" | "occupied" | "ineligible" | "gone" | null;
  seat?: Seat;
}

/**
 * Staff a named person into a supernumerary/trainee seat (9.3/#224, DEC-087) —
 * the person-placer the 8.5 placeholder seats were waiting for. Guards, then
 * composes `manualOverride` (straight to `Confirmed`, `acquiredVia:"operator"`
 * → the my-shifts "Added for you" badge, no reliability event, no ask
 * round-trip — the operator-authority posture).
 *
 * Eligibility is `evaluateTraineeCandidate` (DEC-087): active + valid MMC +
 * not on PTO + not double-booked — NO rating requirement (trainees are unrated
 * by definition; DEC-064's floor is scoped to required manning). The
 * committed-date set is built with NO shift exclusion, so crew already
 * confirmed anywhere that date — including this shift's own required seats —
 * fail `notDoubleBooked` with zero bespoke same-shift code. Server-side
 * re-check: the picker scopes at the edge, this re-derives (a crafted form
 * post can't slip an ineligible rider through).
 */
export async function staffTraineeSeat(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<StaffTraineeResult> {
  const seat = await repo.getSeat(seatId);
  if (!seat) return { code: "gone" };
  if (seat.kind !== "supernumerary") return { code: "not_trainee_seat" };
  if (seat.state !== "Open") return { code: "occupied" };
  const crew = await repo.getCrewMember(crewMemberId);
  if (!crew) return { code: "gone" };
  const shift = await repo.getShift(seat.shiftId);
  if (!shift) return { code: "gone" };

  const [credentials, ptoWindows, committedByCrew] = await Promise.all([
    repo.listCredentialsForCrew(crew.id),
    repo.listPtoWindowsForCrew(crew.id),
    committedDatesByCrew(repo), // no exclusion — same-shift commitments count (DEC-087)
  ]);
  const verdict = evaluateTraineeCandidate(
    {
      crew,
      credentials,
      ptoWindows,
      committedDates: committedByCrew.get(crew.id) ?? new Set<string>(),
    },
    shift.date,
  );
  if (!verdict.eligible) return { code: "ineligible" };

  // Trainee seats are always Open here (guarded above), so a placement never
  // displaces anyone — `placed.displaced` is unused (#400, DEC-118).
  const placed = await manualOverride(repo, seatId, crewMemberId, now);
  return placed ? { code: null, seat: placed.seat } : { code: "gone" };
}

export interface UnstaffTraineeResult {
  /** null = unstaffed. `raced` = the occupant changed (or nobody's riding) between
   * the operator's read and this write — reload, don't clear a different person. */
  code: "not_trainee_seat" | "raced" | "gone" | null;
  seat?: Seat;
}

/**
 * Take a trainee back off a supernumerary seat (DEC-087) — bespoke on purpose,
 * NEVER `vacateSeat`: that path re-asks the vacated seat via the kind-blind
 * `rankedEligible`, which would fire real asks at the roster for a seat the
 * ask engine is supposed to ignore. This is the vacate-exhausted branch only:
 * clear occupant + provenance, rest `Open`, no reliability event, no re-ask.
 * After this, the seat is `Open` again and 8.5's Remove works.
 *
 * `expectedOccupant` is the same race pin `vacateSeat` uses — the operator
 * unstaffs the person they SAW, never whoever swapped in between reads.
 */
export async function unstaffTraineeSeat(
  repo: Repository,
  seatId: SeatId,
  expectedOccupant: CrewMemberId,
): Promise<UnstaffTraineeResult> {
  const seat = await repo.getSeat(seatId);
  if (!seat) return { code: "gone" };
  if (seat.kind !== "supernumerary") return { code: "not_trainee_seat" };
  if (
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    String(seat.assignedCrewMemberId) !== String(expectedOccupant)
  ) {
    return { code: "raced" };
  }
  const reopened: Seat = { ...seat, state: "Open" };
  delete reopened.assignedCrewMemberId;
  delete reopened.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
  await repo.saveSeat(reopened);
  await refreshShiftState(repo, seat.shiftId);
  return { code: null, seat: reopened };
}
