/**
 * Seat/manning override (8.5). Covers: an added required hand gates Crewed and
 * SURVIVES a re-form (the prune exemption); a supernumerary adds + survives; remove
 * an Open override seat; and the guards (not-override / occupied).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import { refreshShiftState } from "../asks/ask-loop.js";
import { formShifts } from "./form-shifts.js";
import { addOverrideSeat, removeOverrideSeat } from "./manning.js";

const PARTY = asId<"VesselId">("vessel-brew-2"); // 2-crew (captain + mate), fleet-seeded
const DAY = "2026-07-18";
const CANON = asId<"ShiftId">(`shift-${PARTY}-${DAY}`);
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

async function seedShift(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent({
    id: asId<"EventId">("am"),
    vesselId: PARTY,
    date: DAY,
    time: "11:00",
    capacity: 16,
    status: "scheduled",
  });
  await formShifts(repo);
  return repo;
}

describe("manning override (8.5)", () => {
  it("adds a required hand + it SURVIVES a re-form (prune-exempt)", async () => {
    const repo = await seedShift();
    const before = (await repo.listSeatsForShift(CANON)).length; // COI: captain + mate
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    expect(seat.override).toBe(true);
    expect(seat.state).toBe("Open");
    expect((await repo.listSeatsForShift(CANON)).length).toBe(before + 1);

    // Re-form (Xola re-import) must NOT prune the override seat.
    await formShifts(repo);
    const seats = await repo.listSeatsForShift(CANON);
    expect(seats.find((s) => s.id === seat.id)).toBeTruthy();
    expect(seats.length).toBe(before + 1);
  });

  it("a required override drops a fully-crewed shift out of Crewed (gates)", async () => {
    const repo = await seedShift();
    for (const s of await repo.listSeatsForShift(CANON)) {
      await repo.saveSeat({
        ...s,
        state: "Confirmed",
        assignedCrewMemberId: asId<"CrewMemberId">("x"),
      });
    }
    await refreshShiftState(repo, CANON);
    expect((await repo.getShift(CANON))?.state).toBe("Crewed");

    await addOverrideSeat(repo, CANON, "required", MATE);
    expect((await repo.getShift(CANON))?.state).not.toBe("Crewed"); // new Open required un-crews it
  });

  it("adds a supernumerary seat (non-gating) that survives a re-form", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "supernumerary", CAPTAIN);
    expect(seat.kind).toBe("supernumerary");
    await formShifts(repo);
    expect(
      (await repo.listSeatsForShift(CANON)).find((s) => s.id === seat.id),
    ).toBeTruthy();
  });

  it("removes an Open override seat", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    await removeOverrideSeat(repo, seat.id);
    expect(await repo.getSeat(seat.id)).toBeNull();
  });

  it("refuses to remove a derived (non-override) seat", async () => {
    const repo = await seedShift();
    const derived = (await repo.listSeatsForShift(CANON))[0]!;
    await expect(removeOverrideSeat(repo, derived.id)).rejects.toThrow(/not an override/);
  });

  it("refuses to remove an occupied override seat — vacate first", async () => {
    const repo = await seedShift();
    const seat = await addOverrideSeat(repo, CANON, "required", MATE);
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("someone"),
    });
    await expect(removeOverrideSeat(repo, seat.id)).rejects.toThrow(/vacate/);
  });
});
