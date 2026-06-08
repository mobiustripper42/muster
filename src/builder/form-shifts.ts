/**
 * Auto-form shifts from events (SPEC §2.3 "Auto-grouping rule", DEC-005).
 *
 * Same vessel + same day → one candidate Shift, batching that vessel's events.
 * There is no blank-slate build step (builder fork resolved): shifts form
 * continuously; this is the mechanism. Idempotent — re-forming after bookings or
 * crewing progress **preserves existing seat states** (a Confirmed seat is never
 * reset to Open) and preserves a shift's `lockedAt`.
 *
 * Forming is how a shift is *born* into the state machine (SPEC §2.3 "Data
 * read") — here into `Pending` (all seats Open). Horizon-based birth straight
 * into `Filling`, and the "changed since you reviewed it" nudge for locked
 * shifts, arrive with the ask loop (M3 / task 1.4b).
 *
 * Re-forming also **reconciles** against edited reservations (SPEC §2.3, #20):
 *  - **Manning shrink** — a surplus required seat (manning corrected downward) is
 *    pruned when still `Open`; an *occupied* surplus seat is surfaced via
 *    `seatsStranded`, never silently deleted (don't strand a crewed seat).
 *  - **All events cancelled** — a shift whose every event has been cancelled
 *    derives to `Cancelled` (a lifecycle state, set here, not seat-derived). A
 *    `Completed` shift — the trip ran — is never resurrected and re-cancelled.
 */

import type { Event, Seat, Shift } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { deriveSeats, deriveShiftState } from "./derive.js";

export interface FormResult {
  shiftsCreated: number;
  shiftsUpdated: number;
  seatsCreated: number;
  /** Surplus `Open` required seats removed after a manning shrink. */
  seatsPruned: number;
  /**
   * Surplus required seats that were NOT pruned because they're occupied
   * (`Asked`/`Claimed`/`Confirmed`/`Bailed`) — surfaced for a human to resolve.
   */
  seatsStranded: number;
  /** Existing shifts transitioned to `Cancelled` because every event cancelled. */
  shiftsCancelled: number;
}

export async function formShifts(repo: Repository): Promise<FormResult> {
  // Group by vessel + day across ALL events (not just `scheduled`): a group whose
  // events have all cancelled must still be revisited so its shift can derive to
  // `Cancelled` (SPEC §5 reconciliation). The scheduled/cancelled split happens
  // per group below.
  const groups = new Map<string, Event[]>();
  for (const e of await repo.listEvents()) {
    const key = `${e.vesselId}|${e.date}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  const result: FormResult = {
    shiftsCreated: 0,
    shiftsUpdated: 0,
    seatsCreated: 0,
    seatsPruned: 0,
    seatsStranded: 0,
    shiftsCancelled: 0,
  };

  for (const evs of groups.values()) {
    const first = evs[0]!;
    const { vesselId, date } = first;
    const shiftId = asId<"ShiftId">(`shift-${vesselId}-${date}`);
    const scheduled = evs.filter((e) => e.status === "scheduled");

    // All events cancelled → cancel the shift (lifecycle, not seat-derived).
    // Never create a shift from cancelled-only events; never re-cancel a trip
    // that already ran (`Completed`) or one already `Cancelled` (idempotent).
    if (scheduled.length === 0) {
      const existing = await repo.getShift(shiftId);
      if (
        existing &&
        existing.state !== "Completed" &&
        existing.state !== "Cancelled"
      ) {
        await repo.saveShift({ ...existing, state: "Cancelled" });
        result.shiftsUpdated++;
        result.shiftsCancelled++;
      }
      continue;
    }

    const existing = await repo.getShift(shiftId);
    const vessel = await repo.getVessel(vesselId);

    // Reconcile seats against current manning. (Vessel manning seeded by
    // seedFleet — DEC-018; a missing vessel yields no derivable seats and is
    // left untouched — absence of a vessel is not a manning-shrank-to-zero
    // signal, so nothing is pruned in that case.)
    const current = await repo.listSeatsForShift(shiftId);
    const currentById = new Map(current.map((s) => [s.id, s]));
    let seats: Seat[] = [...current];
    if (vessel) {
      const desired = deriveSeats(vessel, shiftId);
      const desiredIds = new Set(desired.map((d) => d.id));

      // Add any missing required seat (by deterministic id); preserve existing.
      for (const d of desired) {
        if (!currentById.has(d.id)) {
          await repo.saveSeat(d);
          seats.push(d);
          result.seatsCreated++;
        }
      }

      // Prune surplus required seats (manning shrank): an `Open` orphan is
      // removed; an occupied one is left in place and surfaced (`seatsStranded`)
      // for a human — pruning it would silently strand committed crew.
      for (const s of current) {
        if (s.kind === "required" && !desiredIds.has(s.id)) {
          if (s.state === "Open") {
            await repo.removeSeat(s.id);
            seats = seats.filter((x) => x.id !== s.id);
            result.seatsPruned++;
          } else {
            result.seatsStranded++;
          }
        }
      }
    }

    const shift: Shift = {
      id: shiftId,
      vesselId,
      date,
      state: deriveShiftState(seats),
      eventIds: scheduled.map((e) => e.id).sort(),
      ...(existing?.lockedAt ? { lockedAt: existing.lockedAt } : {}),
    };
    await repo.saveShift(shift);
    if (existing) result.shiftsUpdated++;
    else result.shiftsCreated++;
  }

  return result;
}
