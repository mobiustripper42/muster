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

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

/** Re-seed the party vessel with captain-only manning (a manning shrink). */
async function shrinkPartyToCaptainOnly(repo: InMemoryRepository): Promise<void> {
  const v = await repo.getVessel(PARTY);
  await repo.saveVessel({ ...v!, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
}

async function cancelEvent(repo: InMemoryRepository, id: string): Promise<void> {
  const e = await repo.getEvent(asId<"EventId">(id));
  await repo.saveEvent({ ...e!, status: "cancelled" });
}

describe("formShifts — reconciliation (#20)", () => {
  const day1 = asId<"ShiftId">(`shift-${PARTY}-2026-05-16`);

  it("prunes a surplus Open seat when manning shrinks", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await shrinkPartyToCaptainOnly(repo);
    const r = await formShifts(repo);

    // Both party-day shifts (05-16, 05-17) lose their now-surplus mate seat.
    expect(r.seatsPruned).toBe(2);
    expect(r.seatsStranded).toBe(0);
    const seats = await repo.listSeatsForShift(day1);
    expect(seats).toHaveLength(1);
    expect(seats[0]!.role).toBe(CAPTAIN);
    expect((await repo.getShift(day1))?.state).toBe("Pending"); // lone Open seat
  });

  it("does not strand an occupied surplus seat — surfaces it instead", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    // Confirm the mate on 05-16; leave 05-17's mate Open.
    const mate = (await repo.listSeatsForShift(day1)).find((s) => s.role === MATE)!;
    await repo.saveSeat({
      ...mate,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("crew-1"),
    });

    await shrinkPartyToCaptainOnly(repo);
    const r = await formShifts(repo);

    // 05-16 mate is Confirmed → stranded (kept); 05-17 mate is Open → pruned.
    expect(r.seatsStranded).toBe(1);
    expect(r.seatsPruned).toBe(1);
    const after = await repo.listSeatsForShift(day1);
    expect(after.map((s) => s.role).sort()).toEqual([CAPTAIN, MATE]);
    expect(after.find((s) => s.role === MATE)?.state).toBe("Confirmed");
  });

  it("cancels a shift whose every event has been cancelled", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2"); // both 05-16 events gone
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(1);
    expect((await repo.getShift(day1))?.state).toBe("Cancelled");
  });

  it("never forms a shift from cancelled-only events (no prior shift)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    // Cancel 05-17's lone event before it was ever formed.
    await cancelEvent(repo, "e3");
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    expect(await repo.getShift(asId(`shift-${PARTY}-2026-05-17`))).toBeNull();
  });

  it("never re-cancels a Completed shift (the trip ran)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);
    const shift = await repo.getShift(day1);
    await repo.saveShift({ ...shift!, state: "Completed" });

    await cancelEvent(repo, "e1");
    await cancelEvent(repo, "e2");
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    expect((await repo.getShift(day1))?.state).toBe("Completed");
  });

  it("births a past-horizon shift into Filling when a clock is supplied (DEC-022)", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    // 05-16 events; horizon = earliest (15:30) − 7d = 2026-05-09T15:30Z.
    const past = new Date("2026-05-10T00:00:00.000Z");
    await formShifts(repo, { now: past });
    expect((await repo.getShift(day1))?.state).toBe("Filling"); // born working

    // Without a clock, birth stays Pending (backward-compatible).
    const repo2 = new InMemoryRepository();
    await seedEvents(repo2);
    await formShifts(repo2);
    expect((await repo2.getShift(day1))?.state).toBe("Pending");
  });

  it("keeps a partially-cancelled shift live, dropping only the cancelled event", async () => {
    const repo = new InMemoryRepository();
    await seedEvents(repo);
    await formShifts(repo);

    await cancelEvent(repo, "e1"); // e2 still scheduled
    const r = await formShifts(repo);

    expect(r.shiftsCancelled).toBe(0);
    const shift = await repo.getShift(day1);
    expect(shift?.state).not.toBe("Cancelled");
    expect(shift?.eventIds).toEqual([asId("e2")]);
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
