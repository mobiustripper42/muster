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
import type { ShiftId, SeatId, RoleTypeId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { refreshShiftState } from "../asks/ask-loop.js";

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
