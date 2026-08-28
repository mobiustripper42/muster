/**
 * The X Shore boats — captain-only, 6 pax, and TWO hulls (DEC-043).
 *
 * Xola modelled both hulls as one Resource with `Count 2`, which Muster has no way to
 * express: the resource id IS the vessel axis, so one id means one vessel and one
 * `vesselId|date` shift for two boats running the same day — one captain seat for two
 * captains. Split in Xola into two Resources; these pin that they stay two vessels here.
 *
 * The manning assertion is the other half. Every prior boat in the map is captain+mate,
 * and the map said so in prose ("2 crew, no exceptions"); X Shore is the first that
 * isn't, and `deriveSeats` loops manning blind (DEC-ROLE-1) so nothing branches — which
 * is exactly why a wrong manning row would ship silently.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { formShifts } from "../builder/form-shifts.js";
import { asId } from "../domain/ids.js";
import { importRecords, type RawReservationRecord } from "./import-reservations.js";
import { resolveResource, seedFleet, X_SHORE_1, X_SHORE_2 } from "./resource-map.js";

describe("X Shore — two hulls, captain-only, 6 pax", () => {
  it("the two Xola resources resolve to two DIFFERENT vessels", () => {
    const a = resolveResource(X_SHORE_1);
    const b = resolveResource(X_SHORE_2);
    expect(a.kind).toBe("mapped");
    expect(b.kind).toBe("mapped");
    if (a.kind !== "mapped" || b.kind !== "mapped") return;
    // The whole point of the Xola split: one resource for both hulls collapsed them.
    expect(a.vessel.vesselId).not.toBe(b.vessel.vesselId);
  });

  it("carries COI 6 and a captain-only manning row — not the fleet's captain+mate", () => {
    const r = resolveResource(X_SHORE_1);
    expect(r.kind).toBe("mapped");
    if (r.kind !== "mapped") return;
    expect(r.vessel.capacity).toBe(6);
    expect(r.vessel.manning).toHaveLength(1);
    expect(r.vessel.manning[0]?.count).toBe(1);
  });

  it("an imported X Shore trip forms a shift with exactly one Open captain seat", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);

    const resolved = resolveResource(X_SHORE_1);
    if (resolved.kind !== "mapped") throw new Error("X Shore 1 is not in the resource map");

    const rec: RawReservationRecord = {
      reservationId: "xs-r1",
      product: "X Shore",
      date: "2026-09-06",
      time: "13:00",
      eventId: "evt-xshore-1",
      vesselId: resolved.vessel.vesselId,
      customerName: "Ada",
      partySize: 4,
      status: "booked",
    };
    await importRecords(repo, [rec]);
    await formShifts(repo);

    const shiftId = asId<"ShiftId">(`shift-${resolved.vessel.vesselId}-2026-09-06`);
    const seats = await repo.listSeatsForShift(shiftId);
    expect(seats).toHaveLength(1); // captain only — a captain+mate row would give 2
    expect(seats[0]?.state).toBe("Open");

    const role = await repo.getRoleType(seats[0]!.role);
    expect(role?.name).toBe("captain");
  });

  it("stamps the boat's 120-minute trip length onto the imported event", async () => {
    const repo = new InMemoryRepository();
    const resolved = resolveResource(X_SHORE_1);
    if (resolved.kind !== "mapped") throw new Error("X Shore 1 is not in the resource map");

    await importRecords(repo, [
      {
        reservationId: "xs-len",
        product: "X Shore",
        date: "2026-09-06",
        time: "13:00",
        eventId: "evt-xshore-len",
        vesselId: resolved.vessel.vesselId,
        customerName: "Ada",
        partySize: 4,
        status: "booked",
      },
    ]);

    const event = await repo.getEvent(asId<"EventId">("evt-xshore-len"));
    expect(event?.durationMinutes).toBe(120);
  });

  it("a BrewBoat event leaves durationMinutes ABSENT — never a literal 100", async () => {
    const repo = new InMemoryRepository();
    // Writing the fallback explicitly would freeze today's constant onto every row
    // forever, and `undefined` breaks the omitted-not-undefined round-trip contract.
    await importRecords(repo, [
      {
        reservationId: "brew-len",
        product: "Brew Boat Party Boats with Captain",
        date: "2026-09-06",
        time: "13:00",
        eventId: "evt-brew-len",
        vesselId: asId<"VesselId">("vessel-brew-2"),
        customerName: "Nora",
        partySize: 8,
        status: "booked",
      },
    ]);

    const event = await repo.getEvent(asId<"EventId">("evt-brew-len"));
    expect(event).not.toBeNull();
    expect("durationMinutes" in event!).toBe(false);
  });

  it("the event carries the boat's COI of 6, not a BrewBoat capacity", async () => {
    const repo = new InMemoryRepository();
    const resolved = resolveResource(X_SHORE_2);
    if (resolved.kind !== "mapped") throw new Error("X Shore 2 is not in the resource map");

    await importRecords(repo, [
      {
        reservationId: "xs-r2",
        product: "X Shore",
        date: "2026-09-06",
        time: "15:30",
        eventId: "evt-xshore-2",
        vesselId: resolved.vessel.vesselId,
        customerName: "Nora",
        partySize: 2,
        status: "booked",
      },
    ]);

    const event = await repo.getEvent(asId<"EventId">("evt-xshore-2"));
    expect(event?.capacity).toBe(6);
  });
});
