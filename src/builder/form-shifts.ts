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
import type { VesselId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  deriveSeats,
  deriveShiftState,
  resolveShiftState,
  staffingHorizonFromEvents,
  STAFFING_HORIZON_LEAD_DAYS,
} from "./derive.js";

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
  /** Identity behind the counts (#128) — the shift ids created / cancelled this
   * run, for the import audit. `.length` equals the matching count. */
  createdShiftIds: string[];
  cancelledShiftIds: string[];
  /** Canonical shift ids of SPLIT vessel-days whose trip composition changed this
   * run (DEC-083) — the "changed in the last pull" cue the Builder View reads when
   * the run is an import. `.length` = how many split days an import touched. */
  splitDaysChanged: string[];
}

/**
 * Form/reconcile shifts. Pass `opts.now` to make birth **horizon-aware** (DEC-022):
 * a shift whose staffing horizon is already past is born straight into `Filling`
 * rather than `Pending`. Omit it (the default) and birth uses the pure seat-fold —
 * backward-compatible with callers that don't carry a clock.
 */
export async function formShifts(
  repo: Repository,
  opts?: { now?: Date; leadDays?: number },
): Promise<FormResult> {
  // Group by vessel + day across ALL events (not just `scheduled`): a group whose
  // events have all cancelled must still be revisited so its shift can derive to
  // `Cancelled` (SPEC §5 reconciliation). The scheduled/cancelled split happens
  // per group below.
  const groups = new Map<string, { vesselId: VesselId; date: string; events: Event[] }>();
  for (const e of await repo.listEvents()) {
    const key = `${e.vesselId}|${e.date}`;
    const g = groups.get(key);
    if (g) g.events.push(e);
    else groups.set(key, { vesselId: e.vesselId, date: e.date, events: [e] });
  }
  // DEC-043: an existing shift whose every event has RELOCATED (a reassigned boat)
  // or vanished now has no events in its vessel+day — seed it with an empty set so
  // the loop below derives it to `Cancelled`, instead of orphaning a ghost shift on
  // the old boat. (The new boat's vessel+day forms its own shift from the events.)
  for (const s of await repo.listShifts()) {
    const key = `${s.vesselId}|${s.date}`;
    if (!groups.has(key)) groups.set(key, { vesselId: s.vesselId, date: s.date, events: [] });
  }

  const result: FormResult = {
    shiftsCreated: 0,
    shiftsUpdated: 0,
    seatsCreated: 0,
    seatsPruned: 0,
    seatsStranded: 0,
    shiftsCancelled: 0,
    createdShiftIds: [],
    cancelledShiftIds: [],
    splitDaysChanged: [],
  };

  for (const g of groups.values()) {
    const { vesselId, date } = g;
    const canonicalId = asId<"ShiftId">(`shift-${vesselId}-${date}`);
    const scheduled = g.events.filter((e) => e.status === "scheduled");
    const canonical = await repo.getShift(canonicalId);
    const cut = canonical?.splitCutTime;

    // Un-split (the byte-identical path): one shift for the whole vessel-day.
    // (A brand-new vessel-day, `canonical == null`, is un-split too.)
    if (canonical == null || cut == null) {
      await formOneShift(repo, canonicalId, vesselId, date, scheduled, opts, result, {
        existing: canonical,
      });
      continue;
    }

    // Split (DEC-083): partition this day's trips by the cut — side A (`< cut`)
    // keeps the canonical id + its crew; side B (`>= cut`) is `{id}-b`, born fresh.
    // Re-derived every pull, so a new Xola trip auto-lands on the correct side by
    // its own time and the split survives re-import (Xola never sees the split).
    const sideBId = asId<"ShiftId">(`${canonicalId}-b`);
    const sideA = scheduled.filter((e) => e.time < cut);
    const sideB = scheduled.filter((e) => e.time >= cut);

    // "Changed in the last pull" (import-diff cue, DEC-082/083): a side whose
    // SCHEDULED trip set differs from what it held last pull. A Cancelled husk
    // reads as [] so a steady collapse doesn't re-fire, but a resurrection does.
    const existingB = await repo.getShift(sideBId);
    const prevA =
      canonical.state === "Cancelled" ? [] : canonical.eventIds.map(String);
    const prevB =
      !existingB || existingB.state === "Cancelled"
        ? []
        : existingB.eventIds.map(String);
    if (
      !idSetEq(prevA, sideA.map((e) => String(e.id))) ||
      !idSetEq(prevB, sideB.map((e) => String(e.id)))
    ) {
      result.splitDaysChanged.push(String(canonicalId));
    }

    await formOneShift(repo, canonicalId, vesselId, date, sideA, opts, result, {
      splitCutTime: cut,
      existing: canonical,
    });
    await formOneShift(repo, sideBId, vesselId, date, sideB, opts, result, {
      existing: existingB,
    });
  }

  return result;
}

/** Set-equality on two id lists (order-independent; ids are unique, no dups). */
const idSetEq = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/**
 * Form / reconcile ONE shift from a given set of that shift's scheduled events
 * (DEC-083). Extracted verbatim from the per-vessel-day body so the un-split path
 * calls it once and the split path twice — the un-split behaviour is unchanged by
 * construction. `carry.splitCutTime` is stamped on the saved row (the canonical
 * side of a split); side B and the un-split path pass none. Mutates `result`.
 */
async function formOneShift(
  repo: Repository,
  shiftId: ShiftId,
  vesselId: VesselId,
  date: string,
  scheduled: Event[],
  opts: { now?: Date; leadDays?: number } | undefined,
  result: FormResult,
  extra?: { splitCutTime?: string; existing?: Shift | null },
): Promise<void> {
  // The loop already fetched this shift — reuse it to avoid a second PK lookup in
  // the hot import path (`existing` is passed explicitly, `null` for a new day).
  const existing =
    extra?.existing !== undefined ? extra.existing : await repo.getShift(shiftId);

  // All events cancelled → cancel the shift (lifecycle, not seat-derived). Never
  // create a shift from cancelled-only events; never re-cancel a Completed/Cancelled.
  if (scheduled.length === 0) {
    if (
      existing &&
      existing.state !== "Completed" &&
      existing.state !== "Cancelled"
    ) {
      await repo.saveShift({ ...existing, state: "Cancelled" });
      result.shiftsUpdated++;
      result.shiftsCancelled++;
      result.cancelledShiftIds.push(String(shiftId));
    }
    return;
  }

  const vessel = await repo.getVessel(vesselId);

  // Reconcile seats against current manning (a missing vessel yields no derivable
  // seats and is left untouched — absence isn't a manning-shrank-to-zero signal).
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
    // Prune a surplus `Open` required seat (manning shrank); an occupied one is
    // surfaced (`seatsStranded`), never silently deleted — don't strand crew.
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

  // Birth/refresh state: horizon-aware when a clock is supplied (DEC-022), else the
  // pure seat-fold (DEC-032: tz default-only, tenant zone).
  const state = opts?.now
    ? resolveShiftState(seats, {
        now: opts.now,
        horizon: staffingHorizonFromEvents(
          scheduled,
          opts.leadDays ?? STAFFING_HORIZON_LEAD_DAYS,
        ),
        poolExhausted: false,
      })
    : deriveShiftState(seats);

  const shift: Shift = {
    id: shiftId,
    vesselId,
    date,
    state,
    eventIds: scheduled.map((e) => e.id).sort(),
    ...(existing?.lockedAt ? { lockedAt: existing.lockedAt } : {}),
    ...(extra?.splitCutTime ? { splitCutTime: extra.splitCutTime } : {}),
  };
  await repo.saveShift(shift);
  if (existing) {
    result.shiftsUpdated++;
  } else {
    result.shiftsCreated++;
    result.createdShiftIds.push(String(shiftId));
  }
}
