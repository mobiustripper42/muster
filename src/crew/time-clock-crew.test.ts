/**
 * The crew's own edit doors (#635, SPEC §2.9.8) — change, add and delete YOUR punches.
 *
 * Two things carry this file. **Ownership:** a forged id naming someone else's punch is
 * a silent no-op, never a write and never an oracle telling you the punch exists. And
 * **the trail**: every change appends a row saying who, when, from→to, and why, because
 * a reason is per-edit and a single column would keep only the most recent one — wrong
 * the first time a paycheck is disputed over the second edit.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, TimePunch } from "../domain/entities.js";
import { addOwnPunch, deleteOwnPunch, editOwnPunch } from "./time-clock-crew.js";

const CAP = asId<"RoleTypeId">("role-captain");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

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
  await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
  return repo;
}

const pid = (s: string) => asId<"TimePunchId">(s);
const eid = (s: string) => asId<"TimePunchEditId">(s);
const NOW = new Date("2026-07-16T14:00:00.000Z");
const REASON = "Forgot to clock out, boat was back at 5";

describe("editOwnPunch", () => {
  it("changes the times and appends a trail row saying who, when, from→to and why", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T22:30:00.000Z"),
      reason: REASON,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.outAt).toBe("2026-07-15T22:30:00.000Z");

    const trail = await repo.listTimePunchEdits(pid("p1"));
    expect(trail).toEqual([
      {
        id: eid("e1"),
        timePunchId: pid("p1"),
        actorKind: "crew",
        actorId: QUINT,
        at: "2026-07-16T14:00:00.000Z",
        action: "changed",
        fromInAt: "2026-07-15T13:00:00.000Z",
        fromOutAt: "2026-07-15T21:00:00.000Z",
        toInAt: "2026-07-15T13:00:00.000Z",
        toOutAt: "2026-07-15T22:30:00.000Z",
        reason: REASON,
      },
    ]);
  });

  it("REFUSES an empty reason, writing neither the punch nor a trail row", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T22:30:00.000Z"),
      reason: "   ",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "reason_required" });
    expect(await repo.getTimePunch(pid("p1"))).toMatchObject({ outAt: "2026-07-15T21:00:00.000Z" });
    expect(await repo.listTimePunchEdits(pid("p1"))).toEqual([]);
  });

  it("is a silent no-op on someone else's punch — never a write, never an oracle", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-theirs", crewMemberId: HOOPER }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p-theirs"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T22:30:00.000Z"),
      reason: REASON,
      now: NOW,
    });

    // `gone`, NOT `not_yours` — the same answer a nonexistent id gets, so a forged id
    // can't be used to discover whose punches exist (the ownsTimeOff posture, 10.3).
    expect(result).toEqual({ ok: false, code: "gone" });
    expect(await repo.getTimePunch(pid("p-theirs"))).toMatchObject({
      outAt: "2026-07-15T21:00:00.000Z",
    });
    expect(await repo.listTimePunchEdits(pid("p-theirs"))).toEqual([]);
  });

  it("an unknown id gets the same answer as someone else's", async () => {
    const repo = await seed();
    expect(
      await editOwnPunch(repo, {
        editId: eid("e1"),
        punchId: pid("nope"),
        crewMemberId: QUINT,
        reason: REASON,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "gone" });
  });

  it("still refuses an out at or before the in — the domain rule is shared, not restated", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T13:00:00.000Z"),
      reason: REASON,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "out_before_in" });
    expect(await repo.listTimePunchEdits(pid("p1"))).toEqual([]);
  });

  it("still refuses a change that would move the punch to another day", async () => {
    const repo = await seed();
    // 23:50 EDT on the 15th.
    await repo.saveTimePunch(punch({ id: "p1", inAt: "2026-07-16T03:50:00.000Z", outAt: null }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-16T04:10:00.000Z"), // 00:10 the next day
      reason: REASON,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "day_moved" });
  });

  it("does NOT stamp adminEditedAt — that flag means SOMEONE ELSE moved your hours", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T22:30:00.000Z"),
      reason: REASON,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.adminEditedAt).toBeNull();
    expect(result.punch.origin).toBe("crew");
  });

  it("appends rather than replaces — a second edit keeps the first one's reason", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    await editOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T22:00:00.000Z"),
      reason: "first correction",
      now: NOW,
    });
    await editOwnPunch(repo, {
      editId: eid("e2"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      outAt: new Date("2026-07-15T23:00:00.000Z"),
      reason: "second correction",
      now: new Date("2026-07-16T15:00:00.000Z"),
    });

    const trail = await repo.listTimePunchEdits(pid("p1"));
    expect(trail.map((e) => e.reason)).toEqual(["first correction", "second correction"]);
    // And the second edit's `from` is the FIRST edit's result, not the original.
    expect(trail[1]!.fromOutAt).toBe("2026-07-15T22:00:00.000Z");
  });
});

describe("addOwnPunch", () => {
  it("creates a punch marked origin crew, with a `created` trail row", async () => {
    const repo = await seed();

    const result = await addOwnPunch(repo, {
      id: pid("p-new"),
      editId: eid("e1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-15T13:00:00.000Z"),
      outAt: new Date("2026-07-15T21:00:00.000Z"),
      reason: "Worked the dock, never clocked in",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `origin: "crew"` — THEY entered it. Distinct from `origin: "admin"`, which is the
    // office entering hours on their behalf (§2.9.8).
    expect(result.punch.origin).toBe("crew");

    const trail = await repo.listTimePunchEdits(pid("p-new"));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      action: "created",
      actorKind: "crew",
      actorId: QUINT,
      fromInAt: null,
      fromOutAt: null,
      toInAt: "2026-07-15T13:00:00.000Z",
      reason: "Worked the dock, never clocked in",
    });
  });

  it("requires a reason", async () => {
    const repo = await seed();
    const result = await addOwnPunch(repo, {
      id: pid("p-new"),
      editId: eid("e1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-15T13:00:00.000Z"),
      outAt: null,
      reason: "",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "reason_required" });
    expect(await repo.getTimePunch(pid("p-new"))).toBeNull();
  });

  it("obeys the one-open-punch rule like every other door", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-open", outAt: null }));

    const result = await addOwnPunch(repo, {
      id: pid("p-new"),
      editId: eid("e1"),
      crewMemberId: QUINT,
      inAt: new Date("2026-07-14T13:00:00.000Z"),
      outAt: null,
      reason: REASON,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, code: "already_in" });
  });
});

describe("deleteOwnPunch", () => {
  it("deletes it and leaves a `deleted` row behind — the trail outlives the punch", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));

    const result = await deleteOwnPunch(repo, {
      editId: eid("e1"),
      punchId: pid("p1"),
      crewMemberId: QUINT,
      reason: "Double punch, this one is wrong",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(await repo.getTimePunch(pid("p1"))).toBeNull();

    // The whole point of an append-only trail: the hours are gone, the record of who
    // removed them and why is not.
    const trail = await repo.listTimePunchEdits(pid("p1"));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      action: "deleted",
      reason: "Double punch, this one is wrong",
      fromInAt: "2026-07-15T13:00:00.000Z",
      toInAt: null,
      toOutAt: null,
    });
  });

  it("requires a reason, and refuses someone else's silently", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" }));
    await repo.saveTimePunch(punch({ id: "p-theirs", crewMemberId: HOOPER }));

    expect(
      await deleteOwnPunch(repo, {
        editId: eid("e1"),
        punchId: pid("p1"),
        crewMemberId: QUINT,
        reason: " ",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "reason_required" });
    expect(await repo.getTimePunch(pid("p1"))).not.toBeNull();

    expect(
      await deleteOwnPunch(repo, {
        editId: eid("e2"),
        punchId: pid("p-theirs"),
        crewMemberId: QUINT,
        reason: REASON,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "gone" });
    expect(await repo.getTimePunch(pid("p-theirs"))).not.toBeNull();
  });
});
