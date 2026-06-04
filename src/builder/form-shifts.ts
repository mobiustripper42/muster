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
 */

import type { Event, Seat, Shift } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { deriveSeats, deriveShiftState } from "./derive.js";

export interface FormResult {
  shiftsCreated: number;
  shiftsUpdated: number;
  seatsCreated: number;
}

export async function formShifts(repo: Repository): Promise<FormResult> {
  const events = (await repo.listEvents()).filter(
    (e) => e.status === "scheduled",
  );

  // Group by vessel + day.
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const key = `${e.vesselId}|${e.date}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  const result: FormResult = {
    shiftsCreated: 0,
    shiftsUpdated: 0,
    seatsCreated: 0,
  };

  for (const evs of groups.values()) {
    const first = evs[0]!;
    const { vesselId, date } = first;
    const shiftId = asId<"ShiftId">(`shift-${vesselId}-${date}`);
    const existing = await repo.getShift(shiftId);
    const vessel = await repo.getVessel(vesselId);

    // Reconcile seats: add any missing required seat (by deterministic id),
    // preserve existing seats and their states. (Vessel manning seeded by
    // seedFleet — DEC-018; a missing vessel yields no derivable seats.)
    const current = await repo.listSeatsForShift(shiftId);
    const currentById = new Map(current.map((s) => [s.id, s]));
    const seats: Seat[] = [...current];
    if (vessel) {
      for (const desired of deriveSeats(vessel, shiftId)) {
        if (!currentById.has(desired.id)) {
          await repo.saveSeat(desired);
          seats.push(desired);
          result.seatsCreated++;
        }
      }
    }

    const shift: Shift = {
      id: shiftId,
      vesselId,
      date,
      state: deriveShiftState(seats),
      eventIds: evs.map((e) => e.id).sort(),
      ...(existing?.lockedAt ? { lockedAt: existing.lockedAt } : {}),
    };
    await repo.saveShift(shift);
    if (existing) result.shiftsUpdated++;
    else result.shiftsCreated++;
  }

  return result;
}
