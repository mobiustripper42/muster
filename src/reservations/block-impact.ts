/**
 * Block impact math (task 12.10, DEC-125) — the server-computed "what does this block take off
 * the calendar" number that the /admin/blocks registry shows on every row. Two figures per
 * block:
 *
 *  - **removes N slots** — how many virtual (UNMATERIALIZED) open departures the block
 *    subtracts. This is the availability-subtraction the operator is committing to.
 *  - **M booked trips ($X) conflict** — materialized bookings (Event + active Reservation)
 *    whose slot falls inside the block's scope. DEC-125: committed state beats blocks ("you
 *    can't block away a booking"), so these are surfaced as CONFLICTS to triage, not silently
 *    cancelled; the block is still created. We report the COUNT + summed fare only. The
 *    per-trip drill-down (View → each reservation) is DEFERRED — it needs the reservation
 *    detail page (#465), not built yet.
 *
 * Pure — reuses `deriveVirtualAvailability` + `isSlotBlocked` so the count agrees exactly with
 * what the calendar will render. O(blocks × slots), fine for a season (a few dozen slots).
 */
import type { Block, Event, Offering, Reservation, Vessel } from "../domain/entities.js";
import type { VesselId } from "../domain/ids.js";
import { deriveVirtualAvailability, isSlotBlocked } from "./availability.js";

export interface BlockImpactInput {
  offerings: readonly Offering[];
  vessels: readonly Vessel[];
  events: readonly Event[];
  reservations: readonly Reservation[];
}

export interface BlockImpact {
  /** Virtual (unmaterialized) open slots this block removes. */
  removedSlots: number;
  /** Materialized bookings inside the block's scope — surfaced for triage (DEC-125). */
  conflictCount: number;
  /** Summed fare (integer cents) of the conflicting bookings — the "$X" in the badge. */
  conflictCents: number;
}

/** The inclusive ISO-day window a block covers — the range the deriver enumerates over. */
export function blockDateSpan(block: Block): { start: string; end: string } {
  switch (block.kind) {
    case "location":
      return { start: block.date, end: block.date };
    case "vesselHold":
      return { start: block.date, end: block.date };
    case "vessel":
      return { start: block.startDate, end: block.endDate };
  }
}

/**
 * Compute one block's impact. Runs the deriver over the block's own date span with an EMPTY
 * block set (so every enumerable slot is visible), then attributes each slot to THIS block via
 * `isSlotBlocked`:
 *  - a virtual open slot it covers  → removed (the availability it subtracts);
 *  - a booked slot it covers        → a conflict (count + fare).
 * A slot backed by a materialized (override) Event is neither — it's committed state the block
 * doesn't subtract.
 */
export function computeBlockImpact(block: Block, input: BlockImpactInput): BlockImpact {
  const span = blockDateSpan(block);
  const slots = deriveVirtualAvailability({
    offerings: input.offerings,
    vessels: input.vessels,
    dateRange: span,
    blocks: [], // attribute to THIS block alone — see below
    events: input.events,
    reservations: input.reservations,
  });

  // The deriver keys a location block on the OFFERING's location; recover it per slot.
  const locByOffering = new Map(
    input.offerings.map((o) => [String(o.id), String(o.locationId)]),
  );

  let removedSlots = 0;
  let conflictCount = 0;
  let conflictCents = 0;
  for (const s of slots) {
    const locationId = locByOffering.get(String(s.offeringId)) ?? "";
    if (!isSlotBlocked([block], locationId, s.vesselId, s.date, s.time)) continue;
    if (s.status === "booked") {
      conflictCount += 1;
      conflictCents += s.priceCents;
    } else if (s.status === "available" && s.eventId === undefined) {
      // Virtual (no materialized Event) + open → this is what the block removes.
      removedSlots += 1;
    }
    // `unavailable` (#615/#691) is deliberately NEITHER, and this is the third answer it has
    // had — worth stating so the next person doesn't "fix" it back.
    //   · Not REMOVED: the boat is already out on an overlapping trip, so the block takes away
    //     nothing that was on sale. Counting it would inflate the number the operator uses to
    //     judge whether a block is cheap.
    //   · Not a CONFLICT: there is no Muster booking here. The occupying trip is someone
    //     else's — usually an imported Xola charter — and `s.priceCents` is the offering's
    //     DISPLAY price, not money anyone paid. Adding it to `conflictCents` invents revenue.
    // A block landing on a day an imported charter runs is still worth telling the operator
    // about; that is a different number than either of these, and it is #700's territory.
  }
  return { removedSlots, conflictCount, conflictCents };
}
