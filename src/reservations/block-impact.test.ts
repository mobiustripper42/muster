/**
 * computeBlockImpact (task 12.10, DEC-125) — removes-N + conflict math over a small fixture:
 * one live offering (one vessel, three daily departures, owned every day) plus a single booked
 * trip. A block over that window must remove the OPEN slots and flag the booked one as a
 * conflict (never remove it — committed state beats blocks).
 */
import { describe, expect, it } from "vitest";
import type { Block, Event, Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { eventIdForSlot } from "./availability.js";
import { computeBlockImpact, type BlockImpactInput } from "./block-impact.js";

const LOC = asId<"LocationId">("loc-1");
const VESSEL = asId<"VesselId">("vessel-1");
const TENANT = asId<"TenantId">("tenant-1");
const TIMES = ["13:30", "15:30", "17:30"];
const DAYS = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];

const vessel: Vessel = { id: VESSEL, name: "Brew", coiMaxPax: 12, manning: [] };

const offering: Offering = {
  id: asId<"OfferingId">("off-1"),
  tenantId: TENANT,
  name: "Cruise",
  status: "live",
  vesselIds: [VESSEL],
  locationId: LOC,
  schedule: {
    seasonStart: "2026-01-01",
    seasonEnd: "2026-12-31",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    departureTimes: TIMES,
  },
  basePriceCents: 49900,
  priceVariations: [],
  extraGuestPriceCents: 5000,
};


/** A booked trip on `date`/`time`: a materialized muster Event + an active reservation. */
function booking(date: string, time: string, priceCents: number): { event: Event; reservation: Reservation } {
  const event: Event = {
    id: eventIdForSlot(VESSEL, date, time),
    vesselId: VESSEL,
    date,
    time,
    capacity: 12,
    status: "scheduled",
    source: "muster",
    price: priceCents,
  };
  const reservation: Reservation = {
    id: asId<"ReservationId">(`resv-${date}-${time}`),
    eventId: event.id,
    source: "muster",
    customerName: "Booker",
    partySize: 4,
    status: "booked",
  };
  return { event, reservation };
}

function inputWith(bookings: { event: Event; reservation: Reservation }[]): BlockImpactInput {
  return {
    offerings: [offering],
    vessels: [vessel],
    events: bookings.map((b) => b.event),
    reservations: bookings.map((b) => b.reservation),
  };
}

describe("computeBlockImpact", () => {
  it("vessel block over a range removes the open slots and conflicts with the booked one", () => {
    // One booking on Aug 12 @ 13:30. Block Brew Aug 11–14 (4 days × 3 times = 12 slots).
    const b = booking("2026-08-12", "13:30", 54900);
    const block: Block = {
      id: asId<"BlockId">("blk-1"),
      kind: "vessel",
      vesselId: VESSEL,
      startDate: "2026-08-11",
      endDate: "2026-08-14",
    };
    const impact = computeBlockImpact(block, inputWith([b]));
    // 12 grid slots − 1 materialized (booked) = 11 virtual open removed; the booking conflicts.
    expect(impact.removedSlots).toBe(11);
    expect(impact.conflictCount).toBe(1);
    expect(impact.conflictCents).toBe(54900);
  });

  it("location block on one day + window removes only the slots inside the window", () => {
    // Block loc-1 on Aug 12, 13:00–16:00 → covers 13:30 + 15:30 (not 17:30). 13:30 is booked.
    const b = booking("2026-08-12", "13:30", 54900);
    const block: Block = {
      id: asId<"BlockId">("blk-2"),
      kind: "location",
      locationId: LOC,
      date: "2026-08-12",
      startTime: "13:00",
      endTime: "16:00",
    };
    const impact = computeBlockImpact(block, inputWith([b]));
    // In-window: 13:30 (booked → conflict) + 15:30 (open → removed). 17:30 is outside.
    expect(impact.removedSlots).toBe(1);
    expect(impact.conflictCount).toBe(1);
    expect(impact.conflictCents).toBe(54900);
  });

  it("sums the fare across multiple conflicting bookings", () => {
    const b1 = booking("2026-08-12", "13:30", 54900);
    const b2 = booking("2026-08-13", "15:30", 43900);
    const block: Block = {
      id: asId<"BlockId">("blk-3"),
      kind: "vessel",
      vesselId: VESSEL,
      startDate: "2026-08-11",
      endDate: "2026-08-14",
    };
    const impact = computeBlockImpact(block, inputWith([b1, b2]));
    expect(impact.conflictCount).toBe(2);
    expect(impact.conflictCents).toBe(54900 + 43900);
    expect(impact.removedSlots).toBe(10); // 12 grid − 2 booked
  });

  it("a block outside any owned/scheduled window removes nothing", () => {
    const block: Block = {
      id: asId<"BlockId">("blk-4"),
      kind: "vessel",
      vesselId: VESSEL,
      startDate: "2027-01-01",
      endDate: "2027-01-02",
    };
    const impact = computeBlockImpact(block, inputWith([]));
    expect(impact).toEqual({ removedSlots: 0, conflictCount: 0, conflictCents: 0 });
  });
});
