/**
 * LOOSE drift guard for the db:seed:reservation fixture (12.10) — not a value-pinned snapshot.
 * It asserts the one thing that matters: the world the builder produces still materializes
 * bookings the deriver recognizes AS booked, on the expected vessel/date, and that a block over
 * the demo window sees them as conflicts. If an entity shape or the deriver's slot-overlay
 * drifts so the fixture stops rendering a conflict, this goes red.
 */
import { describe, expect, it } from "vitest";
import type { Block } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { deriveVirtualAvailability } from "./availability.js";
import { computeBlockImpact } from "./block-impact.js";
import { RESERVATION_DEMO, buildSeededReservationWorld } from "./seed-reservation.js";

const world = buildSeededReservationWorld("2026-07-20T12:00:00Z");

describe("db:seed:reservation fixture", () => {
  it("materializes the expected bookings on vessel-brew-3", () => {
    expect(world.reservations).toHaveLength(RESERVATION_DEMO.bookings.length);
    for (const b of RESERVATION_DEMO.bookings) {
      const ev = world.events.find((e) => e.date === b.date && e.time === b.time);
      expect(ev, `event on ${b.date} ${b.time}`).toBeDefined();
      expect(String(ev?.vesselId)).toBe(RESERVATION_DEMO.vesselId);
      expect(ev?.source).toBe("muster");
    }
  });

  it("the deriver sees the demo slots as booked over the owned window", () => {
    const slots = deriveVirtualAvailability({
      offerings: [world.offering],
      vessels: [{ id: asId<"VesselId">(RESERVATION_DEMO.vesselId), name: "Brew 3", coiMaxPax: 12, manning: [] }],
      dateRange: RESERVATION_DEMO.ownedRange,
      ownedDays: world.ownedDays,
      blocks: [],
      events: world.events,
      reservations: world.reservations,
    });
    const booked = slots.filter((s) => s.status === "booked");
    expect(booked.length).toBe(RESERVATION_DEMO.bookings.length);
  });

  it("a vessel block over the demo window conflicts with both bookings", () => {
    const block: Block = {
      id: asId<"BlockId">("blk-drift"),
      kind: "vessel",
      vesselId: asId<"VesselId">(RESERVATION_DEMO.vesselId),
      startDate: RESERVATION_DEMO.vesselBlockWindow.start,
      endDate: RESERVATION_DEMO.vesselBlockWindow.end,
    };
    const impact = computeBlockImpact(block, {
      offerings: [world.offering],
      vessels: [{ id: asId<"VesselId">(RESERVATION_DEMO.vesselId), name: "Brew 3", coiMaxPax: 12, manning: [] }],
      ownedDays: world.ownedDays,
      events: world.events,
      reservations: world.reservations,
    });
    expect(impact.conflictCount).toBe(2);
    expect(impact.conflictCents).toBe(54900 + 43900);
    expect(impact.removedSlots).toBeGreaterThan(0);
  });
});
