/**
 * The admin repair-bench doors (#627, SPEC §2.9.5/§2.9.8) — add, edit, delete a punch.
 *
 * Two invariants carry this file. **Provenance:** an admin-entered punch is `origin:
 * "admin"` and an admin-edited one stamps `adminEditedAt`, so hours nobody actually
 * punched never look identical to hours they did. **The day is immutable:** an edit
 * changes times, never which day a punch belongs to — that's what keeps the
 * auto-matched `shiftId` from going stale, and times alone can cross midnight, so it
 * has to be enforced rather than implied by the absence of a date field.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, TimePunch } from "../domain/entities.js";
import { addPunch, deletePunch, editPunch } from "./time-clock.js";

const CAP = asId<"RoleTypeId">("role-captain");
const QUINT = asId<"CrewMemberId">("crew-quint");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [CAP],
  status: "active",
  reliabilityScore: null,
});

const punch = (over: Omit<Partial<TimePunch>, "id"> & { id: string }): TimePunch => ({
  crewMemberId: QUINT,
  inAt: "2026-07-15T13:00:00.000Z", // 9:00 AM EDT
  outAt: "2026-07-15T21:00:00.000Z", // 5:00 PM EDT
  shiftId: null,
  origin: "crew",
  adminEditedAt: null,
  ...over,
  id: asId<"TimePunchId">(over.id),
});

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  return repo;
}

const pid = (s: string) => asId<"TimePunchId">(s);
const NOW = new Date("2026-07-16T14:00:00.000Z");

describe("addPunch", () => {
  it("stores a closed punch stamped origin admin (§2.9.8)", async () => {
    const repo = await seed();

    const result = await addPunch(repo, {
      id: pid("p1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-15T13:00:00.000Z"),
      outAt: new Date("2026-07-15T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch).toMatchObject({
      origin: "admin",
      inAt: "2026-07-15T13:00:00.000Z",
      outAt: "2026-07-15T21:00:00.000Z",
      adminEditedAt: null,
    });
    expect(await repo.getTimePunch(pid("p1"))).not.toBeNull();
  });

  it("refuses an outAt at or before inAt, writing nothing", async () => {
    const repo = await seed();

    const result = await addPunch(repo, {
      id: pid("p1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-15T21:00:00.000Z"),
      outAt: new Date("2026-07-15T13:00:00.000Z"),
    });

    expect(result).toEqual({ ok: false, code: "out_before_in" });
    expect(await repo.getTimePunch(pid("p1"))).toBeNull();
  });

  it("auto-matches the shift like a real clock-in does (§2.9.2)", async () => {
    const repo = await seed();
    await repo.saveShift({
      id: asId<"ShiftId">("shift-1"),
      vesselId: asId<"VesselId">("vessel-1"),
      date: "2026-07-15",
      state: "Crewed",
      eventIds: [],
    });
    await repo.saveSeat({
      id: asId<"SeatId">("seat-1"),
      shiftId: asId<"ShiftId">("shift-1"),
      role: CAP,
      kind: "required",
      state: "Confirmed",
      assignedCrewMemberId: QUINT,
    });

    const result = await addPunch(repo, {
      id: pid("p1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-15T13:00:00.000Z"),
      outAt: new Date("2026-07-15T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBe(asId<"ShiftId">("shift-1"));
  });

  it("refuses a second OPEN punch for someone already on the clock", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-open", outAt: null }));

    const result = await addPunch(repo, {
      id: pid("p2"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-16T13:00:00.000Z"),
      outAt: null,
    });

    expect(result).toEqual({ ok: false, code: "already_in" });
    expect(await repo.getTimePunch(pid("p2"))).toBeNull();
  });

  it("allows a CLOSED punch alongside an open one — the index constrains open rows only", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-open", outAt: null }));

    const result = await addPunch(repo, {
      id: pid("p2"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-14T13:00:00.000Z"),
      outAt: new Date("2026-07-14T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
  });
});

describe("editPunch", () => {
  it("changes times and stamps adminEditedAt (§2.9.8)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editPunch(repo, pid("p1"), {
      outAt: new Date("2026-07-15T22:30:00.000Z"),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch).toMatchObject({
      outAt: "2026-07-15T22:30:00.000Z",
      adminEditedAt: "2026-07-16T14:00:00.000Z",
      origin: "crew", // who CREATED it is unchanged — only who edited is new
    });
  });

  it("closes an open punch — the forgotten clock-out repair (§2.9.5)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", outAt: null }));

    const result = await editPunch(repo, pid("p1"), {
      outAt: new Date("2026-07-15T21:00:00.000Z"),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(await repo.getOpenPunchForCrew(QUINT)).toBeNull();
  });

  it("refuses an outAt at or before inAt, leaving the punch untouched", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editPunch(repo, pid("p1"), {
      outAt: new Date("2026-07-15T13:00:00.000Z"),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "out_before_in" });
    expect(await repo.getTimePunch(pid("p1"))).toMatchObject({
      outAt: "2026-07-15T21:00:00.000Z",
      adminEditedAt: null,
    });
  });

  it("gone when the id doesn't resolve", async () => {
    const repo = await seed();
    expect(await editPunch(repo, pid("nope"), { now: NOW })).toEqual({
      ok: false,
      code: "gone",
    });
  });

  // ── The day is immutable ────────────────────────────────────────────────────
  // There is no date field on the edit form, but times alone can cross the
  // vessel-local midnight — so the invariant has to be ENFORCED, not implied.
  // This is what keeps the auto-matched shiftId from silently going stale.

  it("REFUSES an inAt that lands on a different vessel-local day", async () => {
    const repo = await seed();
    // 23:50 EDT on the 15th.
    await repo.saveTimePunch(punch({ id: "p1", inAt: "2026-07-16T03:50:00.000Z", outAt: null }));

    // 00:10 EDT on the 16th — twenty minutes later, a different day.
    const result = await editPunch(repo, pid("p1"), {
      inAt: new Date("2026-07-16T04:10:00.000Z"),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "day_moved" });
    expect(await repo.getTimePunch(pid("p1"))).toMatchObject({
      inAt: "2026-07-16T03:50:00.000Z",
      adminEditedAt: null,
    });
  });

  it("ALLOWS an inAt change that stays inside the same vessel-local day", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editPunch(repo, pid("p1"), {
      inAt: new Date("2026-07-15T12:30:00.000Z"), // 8:30 AM, same day
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.inAt).toBe("2026-07-15T12:30:00.000Z");
  });

  it("an outAt may cross midnight — a night shift is one punch, and only inAt fixes the day", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", inAt: "2026-07-16T02:00:00.000Z", outAt: null }));

    // 10:00 PM EDT the 15th → 2:00 AM EDT the 16th. Legitimate.
    const result = await editPunch(repo, pid("p1"), {
      outAt: new Date("2026-07-16T06:00:00.000Z"),
      now: NOW,
    });

    expect(result.ok).toBe(true);
  });

  it("leaves the shiftId alone — the day can't move, so the tag can't go stale", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", shiftId: asId<"ShiftId">("shift-1") }));

    const result = await editPunch(repo, pid("p1"), {
      outAt: new Date("2026-07-15T22:00:00.000Z"),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBe(asId<"ShiftId">("shift-1"));
  });
});

describe("deletePunch", () => {
  it("really deletes — this is not a soft flag", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    await deletePunch(repo, pid("p1"));

    expect(await repo.getTimePunch(pid("p1"))).toBeNull();
    expect(await repo.listTimePunchesForCrew(QUINT)).toEqual([]);
  });

  it("is idempotent — a double-submitted delete is not an error", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));
    await deletePunch(repo, pid("p1"));
    await deletePunch(repo, pid("p1"));
  });

  it("deleting an open punch frees the slot", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", outAt: null }));

    await deletePunch(repo, pid("p1"));

    expect(await repo.getOpenPunchForCrew(QUINT)).toBeNull();
  });
});
