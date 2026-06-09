/**
 * The engine tick — horizon-driven shift advance + Tier-1 kick (DEC-022/023).
 * (Task 3.1a / Phase 3.)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { CrewMember, Event, Shift, Vessel } from "../domain/entities.js";
import { formShifts } from "./form-shifts.js";
import { tick } from "./tick.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">(`shift-${VESSEL}-2026-07-01`);
// Event 2026-07-01T15:00Z; horizon = −7d = 2026-06-24T15:00Z.
const BEFORE = new Date("2026-06-01T00:00:00.000Z");
const AFTER = new Date("2026-06-30T00:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function seedVesselEvent(): Promise<void> {
  const vessel: Vessel = {
    id: VESSEL,
    name: "X",
    coiMaxPax: 16,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  };
  await repo.saveVessel(vessel);
  const event: Event = {
    id: asId<"EventId">("e1"),
    vesselId: VESSEL,
    date: "2026-07-01",
    time: "15:00",
    capacity: 16,
    status: "scheduled",
  };
  await repo.saveEvent(event);
}

async function addCaptain(id: string, over: Partial<CrewMember> = {}): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...over,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return crewId;
}

const shiftState = () => repo.getShift(SHIFT).then((s) => s!.state);
const seatState = () =>
  repo.listSeatsForShift(SHIFT).then((seats) => seats[0]!.state);

describe("tick — horizon advance", () => {
  it("births a past-horizon shift into Filling and fires Tier-1 asks", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo); // Pending, one Open captain seat

    const r = await tick(repo, AFTER);

    expect(r.bornFilling).toBe(1);
    expect(r.shiftsAdvanced).toBe(1);
    expect(r.asksFired).toBe(1);
    expect(await shiftState()).toBe("Filling");
    expect(await seatState()).toBe("Asked"); // broadcastAsk moved it
  });

  it("leaves a pre-horizon shift Pending and asks no one", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);

    const r = await tick(repo, BEFORE);

    expect(r.shiftsAdvanced).toBe(0);
    expect(r.asksFired).toBe(0);
    expect(await shiftState()).toBe("Pending");
    expect(await seatState()).toBe("Open");
  });

  it("marks a past-horizon shift AtRisk when the pool is exhausted", async () => {
    await seedVesselEvent();
    // No eligible crew at all → empty pool.
    await formShifts(repo);

    const r = await tick(repo, AFTER);

    expect(r.toAtRisk).toBe(1);
    expect(r.asksFired).toBe(0);
    expect(await shiftState()).toBe("AtRisk");
  });

  it("is idempotent — a second tick after birth advances nothing", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);
    await tick(repo, AFTER); // born Filling, seat Asked

    const second = await tick(repo, AFTER);

    expect(second.shiftsAdvanced).toBe(0);
    expect(await shiftState()).toBe("Filling");
  });

  it("is AtRisk when the last candidate is already committed to a sibling seat (DEC-003)", async () => {
    // Two captain seats, exactly one eligible captain. Per-seat pools would call
    // seat 2 fillable (cap-1 is captain-rated); the distinct-assignment solve
    // knows cap-1 can't crew both → exhausted → AtRisk.
    const vessel: Vessel = {
      id: VESSEL,
      name: "X",
      coiMaxPax: 16,
      manning: [{ roleTypeId: CAPTAIN, count: 2 }],
    };
    await repo.saveVessel(vessel);
    await repo.saveEvent({
      id: asId<"EventId">("e1"),
      vesselId: VESSEL,
      date: "2026-07-01",
      time: "15:00",
      capacity: 16,
      status: "scheduled",
    });
    const cap = await addCaptain("cap-1");
    await formShifts(repo);
    // Confirm cap-1 into seat 1; leave seat 2 Open.
    const seats = await repo.listSeatsForShift(SHIFT);
    await repo.saveSeat({ ...seats[0]!, state: "Confirmed", assignedCrewMemberId: cap });

    const r = await tick(repo, AFTER);

    expect(r.toAtRisk).toBe(1);
    expect(await shiftState()).toBe("AtRisk");
  });

  it("aggregates counters across multiple shifts in one sweep", async () => {
    // Shift A: captain vessel with an eligible captain → births Filling + asks.
    // Shift B: needs a MATE and no mate exists → AtRisk. (cap-1 is captain-only,
    // and not double-booked, so a captain seat on B would just pull cap-1 again.)
    await seedVesselEvent();
    await addCaptain("cap-1");
    const VESSEL_B = asId<"VesselId">("vessel-b");
    await repo.saveVessel({
      id: VESSEL_B,
      name: "B",
      coiMaxPax: 12,
      manning: [{ roleTypeId: MATE, count: 1 }],
    });
    await repo.saveEvent({
      id: asId<"EventId">("eb"),
      vesselId: VESSEL_B,
      date: "2026-07-02",
      time: "10:00",
      capacity: 12,
      status: "scheduled",
    });
    await formShifts(repo);

    const r = await tick(repo, AFTER);

    expect(r.shiftsAdvanced).toBe(2);
    expect(r.bornFilling).toBe(1); // shift A (has a captain)
    expect(r.toAtRisk).toBe(1); // shift B (no crew)
    expect(r.asksFired).toBe(1);
  });

  it("never resurrects a Cancelled or Completed shift", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);
    const shift = await repo.getShift(SHIFT);
    await repo.saveShift({ ...(shift as Shift), state: "Cancelled" });

    const r = await tick(repo, AFTER);

    expect(r.shiftsAdvanced).toBe(0);
    expect(await shiftState()).toBe("Cancelled");
  });
});
