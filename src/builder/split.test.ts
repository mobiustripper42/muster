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

  it("rejects a malformed cut time — the partition is a lexical HH:MM compare", async () => {
    const repo = await seedDay();
    for (const bad of ["9:00", "2pm", "24:00", "12:60", ""]) {
      await expect(splitShift(repo, CANON, bad)).rejects.toThrow(/Invalid cut time/);
    }
  });

  it("rejects a non-canonical shift id — split/merge key on `shift-{vessel}-{date}`", async () => {
    const repo = await seedDay();
    // A hand-authored fixture: right vessel + day, but an id that isn't the
    // canonical form `formShifts` re-forms (the dev-seed trap, #206). Splitting it
    // would duplicate the vessel-day; refuse instead.
    await repo.saveShift({
      id: asId<"ShiftId">("shift-fixture-legacy"),
      vesselId: PARTY,
      date: DAY,
      state: "Filling",
      eventIds: [asId<"EventId">("am"), asId<"EventId">("pm")],
    });
    await expect(
      splitShift(repo, asId<"ShiftId">("shift-fixture-legacy"), "14:00"),
    ).rejects.toThrow(/not the canonical/);
  });

  /**
   * 9.2 (#226) — split-side collapse notices, netted like mergeShift. The
   * known-hazard class: telling a dual-side crew member "you're off" when
   * they're still working the day's other half bit twice in Phase 8 — every
   * case below exists to pin the who-got-dropped math.
   */
  describe("split-side collapse notices (9.2/#226, DEC-084)", () => {
    /** Confirm `who` into the first seat of `shiftId`. */
    async function confirmInto(
      repo: InMemoryRepository,
      shiftId: typeof CANON,
      who: string,
      seatIndex = 0,
    ) {
      const seat = (await repo.listSeatsForShift(shiftId))[seatIndex]!;
      await repo.saveSeat({
        ...seat,
        state: "Confirmed",
        assignedCrewMemberId: asId<"CrewMemberId">(who),
      });
    }
    async function cancelEvent(repo: InMemoryRepository, id: string) {
      const e = (await repo.getEvent(asId<"EventId">(id)))!;
      await repo.saveEvent({ ...e, status: "cancelled" });
    }
    async function reviveEvent(repo: InMemoryRepository, id: string) {
      const e = (await repo.getEvent(asId<"EventId">(id)))!;
      await repo.saveEvent({ ...e, status: "scheduled" });
    }

    it("side B collapses: a B-only person is notified (keyed to the CANONICAL id); a dual-side person surviving on A is NOT", async () => {
      const repo = await seedDay(); // am 11:00 (side A), pm 17:00 (side B)
      await splitShift(repo, CANON, "14:00");
      // dual works BOTH sides; solo works side B only.
      await confirmInto(repo, CANON, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-solo", 1);
      await cancelEvent(repo, "pm"); // side B's only trip → B collapses

      const r = await formShifts(repo);
      expect((await repo.getShift(SIDE_B))?.state).toBe("Cancelled");
      expect((await repo.getShift(CANON))?.state).not.toBe("Cancelled");
      // The who-got-dropped math (#226's hazard class): dual survives on A.
      expect(r.cancelledCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-solo") },
      ]);
    });

    it("side A collapses: netting works the other way (survivors read from side B)", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      await confirmInto(repo, CANON, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-dual", 0);
      await confirmInto(repo, CANON, "crew-a-only", 1);
      await cancelEvent(repo, "am"); // side A's only trip → A collapses

      const r = await formShifts(repo);
      expect((await repo.getShift(CANON))?.state).toBe("Cancelled");
      expect((await repo.getShift(SIDE_B))?.state).not.toBe("Cancelled");
      expect(r.cancelledCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-a-only") },
      ]);
    });

    it("the whole split day collapses: each person once, keyed canonical — a dual-sider gets ONE notice, not two", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      await confirmInto(repo, CANON, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-solo", 1);
      await cancelEvent(repo, "am");
      await cancelEvent(repo, "pm");

      const r = await formShifts(repo);
      const got = r.cancelledCrew
        .map((c) => `${c.shiftId}|${c.crewMemberId}`)
        .sort();
      expect(got).toEqual([
        `${CANON}|crew-dual`,
        `${CANON}|crew-solo`,
      ]);
    });

    it("seat-state parity with the un-split path: a Bailed occupant (assignment cleared by bail) is never notified; a Claimed one is", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      const [s1, s2] = await repo.listSeatsForShift(SIDE_B);
      // Bailed rests with assignedCrewMemberId CLEARED (ask-loop invariant) —
      // so a prior bailer can't collect a spurious "you're off."
      await repo.saveSeat({ ...s1!, state: "Bailed" });
      // Claimed carries the assignment — a claimant loses the shift for real.
      await repo.saveSeat({
        ...s2!,
        state: "Claimed",
        assignedCrewMemberId: asId<"CrewMemberId">("crew-claimant"),
      });
      await cancelEvent(repo, "pm");

      const r = await formShifts(repo);
      expect(r.cancelledCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-claimant") },
      ]);
    });

    it("transition-only: a re-pull of an already-collapsed side does not re-fire", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      await confirmInto(repo, SIDE_B, "crew-solo", 0);
      await cancelEvent(repo, "pm");

      const r1 = await formShifts(repo);
      expect(r1.cancelledCrew).toHaveLength(1);
      const r2 = await formShifts(repo);
      expect(r2.cancelledCrew).toEqual([]);
    });

    it("side B resurrects (#244): a still-assigned crew on the returned side gets 'you're on', keyed canonical, transition-only", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      await confirmInto(repo, SIDE_B, "crew-solo", 0);
      // Collapse side B → crew-solo told "you're off" (the cancel side).
      await cancelEvent(repo, "pm");
      const rCollapse = await formShifts(repo);
      expect((await repo.getShift(SIDE_B))?.state).toBe("Cancelled");
      expect(rCollapse.cancelledCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-solo") },
      ]);
      expect(rCollapse.restoredCrew).toEqual([]);

      // The pm trip returns → side B re-forms live with crew-solo still assigned on
      // the husk → reported for the matching "you're on", keyed to CANON.
      await reviveEvent(repo, "pm");
      const r = await formShifts(repo);
      expect((await repo.getShift(SIDE_B))?.state).not.toBe("Cancelled");
      expect(r.restoredCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-solo") },
      ]);
      // A steady live re-pull must NOT re-fire (transition-only).
      expect((await formShifts(repo)).restoredCrew).toEqual([]);
    });

    it("an already-Cancelled far side never counts as a survivor (its crew aren't working the day)", async () => {
      const repo = await seedDay();
      await splitShift(repo, CANON, "14:00");
      await confirmInto(repo, CANON, "crew-dual", 0);
      await confirmInto(repo, SIDE_B, "crew-dual", 0);
      // Pull 1: side A collapses — dual survives on B, no notice.
      await cancelEvent(repo, "am");
      expect((await formShifts(repo)).cancelledCrew).toEqual([]);
      // Pull 2: side B collapses too — dual is NOW genuinely off the day.
      // Side A (Cancelled) must not shield them as a "survivor."
      await cancelEvent(repo, "pm");
      expect((await formShifts(repo)).cancelledCrew).toEqual([
        { shiftId: CANON, crewMemberId: asId<"CrewMemberId">("crew-dual") },
      ]);
    });
  });
});
