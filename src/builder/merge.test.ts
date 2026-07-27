/**
 * Manual merge engine (8.4, DEC-083 inverse + DEC-084). Covers the round-trip back
 * to one un-split shift (side-B teardown + re-form with all trips), side-A crew
 * preservation, the `freedCrew` report (side-B assigned crew → the release notice),
 * and the guards (not-split / `…-b` / non-canonical).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { formShifts } from "./form-shifts.js";
import { splitShift } from "./split.js";
import { mergeShift } from "./merge.js";

const PARTY = asId<"VesselId">("vessel-brew-2"); // 2-crew (captain + mate), fleet-seeded
const DAY = "2026-07-18";
const CANON = asId<"ShiftId">(`shift-${PARTY}-${DAY}`);
const SIDE_B = asId<"ShiftId">(`shift-${PARTY}-${DAY}-b`);

const ev = (id: string, time: string): Event => ({
  id: asId<"EventId">(id),
  vesselId: PARTY,
  date: DAY,
  time,
  capacity: 16,
  source: "xola", status: "scheduled",
});

/** A party-day with a morning + evening trip, formed into one un-split shift. */
async function seedDay(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent(ev("am", "11:00"));
  await repo.saveEvent(ev("pm", "17:00"));
  await formShifts(repo);
  return repo;
}

const ids = (arr?: readonly string[]) => (arr ?? []).map(String).sort();
const gone = async (repo: InMemoryRepository, id: typeof SIDE_B) =>
  (await repo.getShift(id)) ?? null; // normalize undefined → null

describe("mergeShift (DEC-083 inverse / DEC-084)", () => {
  // C2.3-8, the merge half — see the matching pair in split.test.ts. The merge's
  // re-form re-births the surviving vessel-day shift, so the same clock rule applies:
  // horizon-aware with `now`, pure seat-fold without.
  it("re-births the merged shift horizon-aware when given a clock (Filling inside the horizon)", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    // DAY is 2026-07-18; default lead is 7 days, so 3 days out is inside the horizon.
    await mergeShift(repo, CANON, new Date("2026-07-15T12:00:00Z"));

    expect((await repo.getShift(CANON))?.state).toBe("Filling");
  });

  it("re-births Pending with no clock — why the edge must pass `now`", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    await mergeShift(repo, CANON);

    expect((await repo.getShift(CANON))?.state).toBe("Pending");
  });

  it("merges a split back into one un-split shift — tears down `-b`, re-forms with all trips", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    expect(await gone(repo, SIDE_B)).not.toBeNull(); // side B exists after the split

    const { form } = await mergeShift(repo, CANON);

    const merged = await repo.getShift(CANON);
    expect(merged?.splitCutTime).toBeUndefined(); // cut cleared
    expect(ids(merged?.eventIds)).toEqual([String(asId("am")), String(asId("pm"))]); // both trips
    expect(await gone(repo, SIDE_B)).toBeNull(); // `-b` shift removed
    expect((await repo.listSeatsForShift(SIDE_B)).length).toBe(0); // its seats gone
    expect(form.shiftsUpdated).toBeGreaterThanOrEqual(1); // the re-form ran
  });

  it("preserves side A's confirmed crew through the merge", async () => {
    const repo = await seedDay();
    const seat = (await repo.listSeatsForShift(CANON))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });

    await splitShift(repo, CANON, "14:00");
    await mergeShift(repo, CANON);

    const kept = (await repo.listSeatsForShift(CANON)).find((s) => s.id === seat.id);
    expect(kept?.state).toBe("Confirmed");
    expect(String(kept?.assignedCrewMemberId)).toBe("cap");
  });

  it("notifies the surviving side-A crew that their shift changed — now the longer day (#350)", async () => {
    const repo = await seedDay();
    const seat = (await repo.listSeatsForShift(CANON))[0]!;
    await repo.saveSeat({
      ...seat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("cap"),
    });
    await splitShift(repo, CANON, "14:00");
    // Merging folds side B's trips back → side A's crew's day grew, so they get a
    // "your shift changed" notice (distinct from side B's dropped crew, who'd get
    // "you're off" via `freedCrew`).
    const { form } = await mergeShift(repo, CANON);
    expect(form.changedCrew).toEqual([
      { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("cap") },
    ]);
  });

  it("reports side B's assigned crew as freed (the release-notice list)", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    const bSeat = (await repo.listSeatsForShift(SIDE_B))[0]!;
    await repo.saveSeat({
      ...bSeat,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("mate-b"),
    });

    const { freedCrew } = await mergeShift(repo, CANON);
    expect(freedCrew.map(String)).toEqual(["mate-b"]);
  });

  it("does NOT free a crew member who also holds a side-A seat (still on the day)", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    // The same person confirmed on BOTH halves — a mate working morning + evening.
    const aSeat = (await repo.listSeatsForShift(CANON))[0]!;
    const bSeat = (await repo.listSeatsForShift(SIDE_B))[0]!;
    const dual = asId<"CrewMemberId">("dual");
    await repo.saveSeat({ ...aSeat, state: "Confirmed", assignedCrewMemberId: dual });
    await repo.saveSeat({ ...bSeat, state: "Confirmed", assignedCrewMemberId: dual });

    const { freedCrew } = await mergeShift(repo, CANON);
    expect(freedCrew.map(String)).toEqual([]); // survives on side A → not "off"
  });

  it("frees nobody when side B is uncrewed", async () => {
    const repo = await seedDay();
    await splitShift(repo, CANON, "14:00");
    const { freedCrew } = await mergeShift(repo, CANON);
    expect(freedCrew).toEqual([]);
  });

  it("rejects merging an un-split shift, a `-b` side, or a non-canonical id", async () => {
    const repo = await seedDay();
    await expect(mergeShift(repo, CANON)).rejects.toThrow(/not split/); // not split yet
    await splitShift(repo, CANON, "14:00");
    await expect(mergeShift(repo, SIDE_B)).rejects.toThrow(/split side/);
    await repo.saveShift({
      id: asId<"ShiftId">("shift-legacy"),
      vesselId: PARTY,
      date: DAY,
      state: "Filling",
      eventIds: [],
    });
    await expect(
      mergeShift(repo, asId<"ShiftId">("shift-legacy")),
    ).rejects.toThrow(/not the canonical/);
  });
});
