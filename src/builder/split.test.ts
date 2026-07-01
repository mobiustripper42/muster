/**
 * Manual split engine + service (8.3a, DEC-083). Covers the cut-time partition,
 * side-A crew preservation, re-import survival (new trip auto-lands by time),
 * collapse-persists / resurrection, the import-diff `splitDaysChanged` detection,
 * the cut tie-rule, and the `splitShift` guards.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { formShifts } from "./form-shifts.js";
import { splitShift } from "./split.js";

const PARTY = asId<"VesselId">("vessel-brew-2"); // 2-crew (captain + mate), fleet-seeded
const DAY = "2026-07-18";
const CANON = asId<"ShiftId">(`shift-${PARTY}-${DAY}`);
const SIDE_B = asId<"ShiftId">(`shift-${PARTY}-${DAY}-b`);

const ev = (id: string, time: string, status: Event["status"] = "scheduled"): Event => ({
  id: asId<"EventId">(id),
  vesselId: PARTY,
  date: DAY,
  time,
  capacity: 16,
  status,
});

/** A party-day with a morning + evening trip, formed into one un-split shift. */
async function seedDay(
  times: [string, string] = ["11:00", "17:00"],
): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent(ev("am", times[0]));
  await repo.saveEvent(ev("pm", times[1]));
  await formShifts(repo);
  return repo;
}

const ids = (arr?: readonly string[]) => (arr ?? []).map(String).sort();

describe("splitShift (DEC-083)", () => {
  it("splits a vessel-day into side A (before the cut) + side B (`-b`, at/after)", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");

    const a = await repo.getShift(CANON);
    const b = await repo.getShift(SIDE_B);
    expect(ids(a?.eventIds)).toEqual([String(asId("am"))]); // 11:00 < 14:00
    expect(a?.splitCutTime).toBe("14:00"); // the marker lives on canonical only
    expect(ids(b?.eventIds)).toEqual([String(asId("pm"))]); // 17:00 >= 14:00
    expect(b?.splitCutTime).toBeUndefined();
    // Each side derives its own crew — the split doubles the day's requirement.
    expect((await repo.listSeatsForShift(CANON)).length).toBe(2);
    expect((await repo.listSeatsForShift(SIDE_B)).length).toBe(2);
  });

  it("side A preserves its confirmed crew across the split (seat id + state stable)", async () => {
    const repo = await seedDay();
    const seat = (await repo.listSeatsForShift(CANON))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    await splitShift(repo, CANON, "14:00");
    const kept = (await repo.listSeatsForShift(CANON)).find((s) => s.id === seat.id);
    expect(kept?.state).toBe("Confirmed");
    expect(kept?.assignedCrewMemberId).toBe(asId<"CrewMemberId">("cap"));
  });

  it("survives re-import: a new Xola trip auto-lands on the correct side by its time", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    await repo.saveEvent(ev("noon", "12:00")); // morning
    await repo.saveEvent(ev("late", "20:00")); // evening
    const r = await formShifts(repo);

    expect(ids((await repo.getShift(CANON))?.eventIds)).toEqual(ids(["am", "noon"]));
    expect(ids((await repo.getShift(SIDE_B))?.eventIds)).toEqual(ids(["late", "pm"]));
    expect((await repo.getShift(CANON))?.splitCutTime).toBe("14:00"); // split survived
    expect(r.splitDaysChanged).toContain(String(CANON)); // an import touched it
  });

  it("a steady re-form (no trip change) reports no split-day change", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    expect((await formShifts(repo)).splitDaysChanged).toEqual([]);
  });

  it("collapse persists the split (no auto-dissolve); the cut survives to resurrect", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");

    // Cancel side B's only trip → Cancelled husk, but the split stays.
    await repo.saveEvent(ev("pm", "17:00", "cancelled"));
    const r1 = await formShifts(repo);
    expect((await repo.getShift(SIDE_B))?.state).toBe("Cancelled");
    expect((await repo.getShift(CANON))?.splitCutTime).toBe("14:00"); // NOT dissolved
    expect(r1.splitDaysChanged).toContain(String(CANON)); // collapse flagged

    // Still cancelled next pull → no re-fire (the husk reads as empty).
    expect((await formShifts(repo)).splitDaysChanged).toEqual([]);

    // The evening trip returns → side B resurrects on the correct side, flagged.
    await repo.saveEvent(ev("pm", "17:00", "scheduled"));
    const r3 = await formShifts(repo);
    expect((await repo.getShift(SIDE_B))?.state).not.toBe("Cancelled");
    expect(ids((await repo.getShift(SIDE_B))?.eventIds)).toEqual([String(asId("pm"))]);
    expect(r3.splitDaysChanged).toContain(String(CANON));
  });

  it("a trip exactly at the cut goes to side B (half-open [cut, …))", async () => {
    const repo = await seedDay(["11:00", "14:00"]); // pm is AT the cut
    await splitShift(repo, CANON, "14:00");
    expect(ids((await repo.getShift(CANON))?.eventIds)).toEqual([String(asId("am"))]);
    expect(ids((await repo.getShift(SIDE_B))?.eventIds)).toEqual([String(asId("pm"))]);
  });

  it("rejects a cut that doesn't partition into two non-empty sides", async () => {
    const repo = await seedDay(["11:00", "13:00"]); // both before 14:00
    await expect(splitShift(repo, CANON, "14:00")).rejects.toThrow(/non-empty/);
  });

  it("rejects re-splitting an already-split shift, and splitting a side-B", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    await expect(splitShift(repo, CANON, "12:00")).rejects.toThrow(/already split/);
    await expect(splitShift(repo, SIDE_B, "18:00")).rejects.toThrow(/split side/);
  });
});
