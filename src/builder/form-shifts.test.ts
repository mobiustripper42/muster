/**
 * Auto-form + lock (Task 1.3 / M2, SPEC §2.3, DEC-005).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event, Seat } from "../domain/entities.js";
import { seedFleet } from "../import/product-map.js";
import { formShifts } from "./form-shifts.js";
import { isLocked, lockShift } from "./lock.js";

const PARTY = asId<"VesselId">("vessel-brewboat-party"); // 2-crew, per product-map
const DUFFY = asId<"VesselId">("vessel-duffy-rental"); // 0-crew, self-captained

const event = (id: string, vesselId: typeof PARTY, date: string, time: string): Event => ({
  id: asId<"EventId">(id),
  vesselId,
  date,
  time,
  capacity: 16,
  status: "scheduled",
});

async function seedEvents(repo: InMemoryRepository): Promise<void> {
  await seedFleet(repo);
  // Two party-boat trips same day → one shift; a third on another day → separate.
  await repo.saveEvent(event("e1", PARTY, "2026-05-16", "15:30"));
  await repo.saveEvent(event("e2", PARTY, "2026-05-16", "19:30"));
  await repo.saveEvent(event("e3", PARTY, "2026-05-17", "13:30"));
  // A zero-crew rental on its own day.
  await repo.saveEvent(event("e4", DUFFY, "2026-06-27", "18:30"));
}

describe("formShifts", () => {
  it("groups same-vessel-same-day events into one shift and derives seats", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    const result = await formShifts(repo);

    expect(result.shiftsCreated).toBe(3); // party 05-16, party 05-17, duffy 06-27
    const partyDay1 = await repo.getShift(asId(`shift-${PARTY}-2026-05-16`));
    expect(partyDay1?.eventIds.sort()).toEqual([asId("e1"), asId("e2")]);
    expect((await repo.listSeatsForShift(partyDay1!.id)).length).toBe(2); // captain + mate
    expect(partyDay1?.state).toBe("Pending"); // born all-Open
  });

  it("forms a zero-crew rental into a vacuously-Crewed shift with no seats", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const duffy = await repo.getShift(asId(`shift-${DUFFY}-2026-06-27`));
    expect(await repo.listSeatsForShift(duffy!.id)).toHaveLength(0);
    expect(duffy?.state).toBe("Crewed");
  });

  it("is idempotent — re-form preserves a Confirmed seat and does not duplicate", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    const shiftId = asId<"ShiftId">(`shift-${PARTY}-2026-05-16`);
    const seats = await repo.listSeatsForShift(shiftId);
    const confirmed: Seat = { ...seats[0]!, state: "Confirmed" };
    await repo.saveSeat(confirmed);

    const second = await formShifts(repo);
    expect(second.shiftsCreated).toBe(0);
    expect(second.shiftsUpdated).toBe(3);
    expect(second.seatsCreated).toBe(0); // no duplicate seats

    const after = await repo.listSeatsForShift(shiftId);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.id === confirmed.id)?.state).toBe("Confirmed");
    // One Confirmed + one Open → Filling.
    expect((await repo.getShift(shiftId))?.state).toBe("Filling");
  });
});

describe("lockShift", () => {
  it("stamps lockedAt and survives a re-form", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const shiftId = asId<"ShiftId">(`shift-${PARTY}-2026-05-16`);

    const locked = await lockShift(repo, shiftId, new Date("2026-05-10T09:00:00Z"));
    expect(isLocked(locked)).toBe(true);
    expect(locked.lockedAt).toBe("2026-05-10T09:00:00.000Z");

    await formShifts(repo); // re-form must not clear the lock
    expect((await repo.getShift(shiftId))?.lockedAt).toBe("2026-05-10T09:00:00.000Z");
  });

  it("throws on an unknown shift", async () => {
    const repo = new InMemoryRepository();
    await expect(
      lockShift(repo, asId("shift-none"), new Date("2026-05-10T09:00:00Z")),
    ).rejects.toThrow(/No shift/);
  });
});
