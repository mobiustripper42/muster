/**
 * Send-time ask suppression — #341 on-shift (DEC-129, hard) + #342 same-day
 * decline cooldown (DEC-130, soft/valved). Unit tests over `buildAskSuppression`,
 * plus integration through `tick` for the precedence + defer-vs-exhausted cases.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, VesselId } from "../domain/ids.js";
import type { CrewMember, Event, Vessel } from "../domain/entities.js";
import { buildAskSuppression } from "./suppression.js";
import { assignPerson, manualOverride, recordResponse } from "./ask-loop.js";
import { formShifts } from "../builder/form-shifts.js";
import { tick } from "../builder/tick.js";
import { poolExhaustedFor } from "../oracle/oracle.js";

const CAP = asId<"RoleTypeId">("role-captain");
const UTC = "UTC";

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function vessel(id: string): Promise<VesselId> {
  const vid = asId<"VesselId">(id);
  const v: Vessel = { id: vid, name: id, coiMaxPax: 16, manning: [{ roleTypeId: CAP, count: 1 }] };
  await repo.saveVessel(v);
  return vid;
}
async function event(vid: VesselId, id: string, date: string, time: string): Promise<void> {
  await repo.saveEvent({
    id: asId<"EventId">(id), vesselId: vid, date, time,
    capacity: 16, source: "xola", status: "scheduled",
  } as Event);
}
async function captain(id: string, over: Partial<CrewMember> = {}): Promise<CrewMemberId> {
  const cid = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: cid, name: id, phone: "555", ratings: [CAP],
    status: "active", reliabilityScore: null, ...over,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`), crewMemberId: cid, type: "MMC", expiry: "2026-12-31",
  });
  return cid;
}
const seatOf = async (shiftId: string): Promise<SeatId> =>
  (await repo.listSeatsForShift(asId<"ShiftId">(shiftId)))[0]!.id;
const askedIds = async (seatId: SeatId): Promise<string[]> =>
  (await repo.listAsksForSeat(seatId)).map((a) => String(a.crewMemberId));

// tz UTC so wall-clock = instant; civil window held wide open by the suite env.
const TICK = { tz: UTC, civilWindow: { start: "00:00", end: "23:59" } };

describe("buildAskSuppression — working window (#341 / DEC-129)", () => {
  // Event 2026-07-01T15:00Z → call = 14:15Z, end = 15:00 + 125min = 17:05Z. [call, end).
  const LIAM = asId<"CrewMemberId">("liam");
  async function confirmedShift(): Promise<void> {
    const v = await vessel("boat-a");
    await event(v, "ea", "2026-07-01", "15:00");
    await formShifts(repo);
    await manualOverride(repo, await seatOf(`shift-${v}-2026-07-01`), await captain("liam"), new Date("2026-06-25T00:00:00Z"));
  }

  it("includes a Confirmed occupant when now is inside [call, end)", async () => {
    await confirmedShift();
    const s = await buildAskSuppression(repo, new Date("2026-07-01T15:30:00Z"), UTC);
    expect(s.working.has(LIAM)).toBe(true);
  });
  it("excludes before call time", async () => {
    await confirmedShift();
    const s = await buildAskSuppression(repo, new Date("2026-07-01T14:00:00Z"), UTC);
    expect(s.working.has(LIAM)).toBe(false);
  });
  it("half-open: inclusive at call, exclusive at end", async () => {
    await confirmedShift();
    const atCall = await buildAskSuppression(repo, new Date("2026-07-01T14:15:00Z"), UTC);
    const atEnd = await buildAskSuppression(repo, new Date("2026-07-01T17:05:00Z"), UTC);
    expect(atCall.working.has(LIAM)).toBe(true);
    expect(atEnd.working.has(LIAM)).toBe(false);
  });
  it("an Open (uncommitted) seat contributes nobody", async () => {
    const v = await vessel("boat-a");
    await event(v, "ea", "2026-07-01", "15:00");
    await formShifts(repo); // seat Open, nobody assigned
    const s = await buildAskSuppression(repo, new Date("2026-07-01T15:30:00Z"), UTC);
    expect(s.working.size).toBe(0);
  });
});

describe("buildAskSuppression — decline cooldown (#342 / DEC-130)", () => {
  it("maps a declined ask to the declined shift's vessel-date", async () => {
    const v = await vessel("boat-a");
    await event(v, "ea", "2026-07-01", "13:00");
    await formShifts(repo);
    const seat = await seatOf(`shift-${v}-2026-07-01`);
    const dana = await captain("dana");
    const ask = await assignPerson(repo, seat, dana, new Date("2026-06-25T00:00:00Z"));
    await recordResponse(repo, ask!.id, "declined", new Date("2026-06-25T01:00:00Z"));

    const s = await buildAskSuppression(repo, new Date("2026-06-26T00:00:00Z"), UTC);
    expect(s.declinedOnDay.get("2026-07-01")?.has(dana)).toBe(true);
    expect(s.declinedOnDay.has("2026-07-02")).toBe(false);
  });
});

describe("#341 on-shift suppression through tick (DEC-129)", () => {
  // boat-a trip 07-01 15:00 (Liam mid-cruise at 15:30); boat-b trip 07-08 15:00,
  // horizon 07-01 15:00 → Filling at 15:30, fills-by 07-06 → drip (not urgent).
  // Different dates, so Liam is eligible for boat-b by double-book rules — only #341
  // keeps him off it. boat-a has departed at 15:30 → past-trip-guarded, no contention.
  async function twoBoats(): Promise<{ seatB: SeatId }> {
    const va = await vessel("boat-a");
    const vb = await vessel("boat-b");
    await event(va, "ea", "2026-07-01", "15:00");
    await event(vb, "eb", "2026-07-08", "15:00");
    await formShifts(repo);
    await manualOverride(repo, await seatOf(`shift-${va}-2026-07-01`), await captain("liam"), new Date("2026-06-25T00:00:00Z"));
    return { seatB: await seatOf(`shift-${vb}-2026-07-08`) };
  }
  const NOW = new Date("2026-07-01T15:30:00Z");

  it("skips the working captain and asks a free one instead", async () => {
    const { seatB } = await twoBoats();
    await captain("evan"); // free
    await tick(repo, NOW, TICK);
    const asked = await askedIds(seatB);
    expect(asked).toContain("evan");
    expect(asked).not.toContain("liam");
  });

  it("sole working candidate → DEFERS: 0 asks, stays Filling (not AtRisk), pool not exhausted", async () => {
    const { seatB } = await twoBoats(); // Liam is the ONLY captain
    const r = await tick(repo, NOW, TICK);
    const shiftB = asId<"ShiftId">("shift-boat-b-2026-07-08");
    expect(await askedIds(seatB)).toEqual([]);
    expect((await repo.getShift(shiftB))!.state).toBe("Filling"); // NOT AtRisk
    expect(r.shiftsEscalated).toBe(0); // defer ≠ stall → no Tier-2
    const seats = await repo.listSeatsForShift(shiftB);
    expect(await poolExhaustedFor(repo, (await repo.getShift(shiftB))!, seats, NOW)).toBe(false);
  });

  it("re-asks the worker once their shift has ended", async () => {
    const { seatB } = await twoBoats(); // Liam sole captain
    await tick(repo, new Date("2026-07-01T17:30:00Z"), TICK); // past boat-a end 17:05
    expect(await askedIds(seatB)).toContain("liam");
  });
});

describe("#342 same-day decline cooldown through tick (DEC-130)", () => {
  // Drip window: past 06-24 horizon, before 06-29 fills-by, nobody working.
  const NOW = new Date("2026-06-27T12:00:00Z");

  // boat-a (07-01) is CREWED by an anchor so it never competes in the drip and its
  // filled seat reserves no one (#393); dana declined an ask on it → on 07-01
  // cooldown. boat-b (07-01) is the Open seat under test.
  async function setup(opts: { withEvan: boolean }): Promise<SeatId> {
    const va = await vessel("boat-a");
    const vb = await vessel("boat-b");
    await event(va, "ea", "2026-07-01", "13:00");
    await event(vb, "eb", "2026-07-01", "17:00");
    await formShifts(repo);
    await captain("dana");
    const anchor = await captain("anchor");
    if (opts.withEvan) await captain("evan");
    const seatA = await seatOf("shift-boat-a-2026-07-01");
    const ask = await assignPerson(repo, seatA, asId<"CrewMemberId">("dana"), new Date("2026-06-26T00:00:00Z"));
    await recordResponse(repo, ask!.id, "declined", new Date("2026-06-26T01:00:00Z")); // dana declines boat-a
    await manualOverride(repo, seatA, anchor, new Date("2026-06-26T02:00:00Z")); // boat-a → Crewed
    return await seatOf("shift-boat-b-2026-07-01");
  }

  it("skips a same-day decliner for the other boat and asks a free candidate", async () => {
    const seatB = await setup({ withEvan: true });
    await tick(repo, NOW, TICK);
    const asked = await askedIds(seatB);
    expect(asked).toContain("evan");
    expect(asked).not.toContain("dana"); // cooled down for 07-01
  });

  it("valve: re-asks the decliner when they're the sole remaining candidate", async () => {
    const seatB = await setup({ withEvan: false }); // dana is the only non-anchor captain
    await tick(repo, NOW, TICK);
    expect(await askedIds(seatB)).toContain("dana"); // valve opened — better than exhaust
  });

  it("cooldown does not carry to the next day", async () => {
    const va = await vessel("boat-a");
    const vc = await vessel("boat-c");
    await event(va, "ea", "2026-07-01", "13:00");
    await event(vc, "ec", "2026-07-02", "13:00"); // horizon 06-25, fills-by 06-30 → drip at 06-27
    await formShifts(repo);
    const dana = await captain("dana");
    const seatA = await seatOf("shift-boat-a-2026-07-01");
    const ask = await assignPerson(repo, seatA, dana, new Date("2026-06-26T00:00:00Z"));
    await recordResponse(repo, ask!.id, "declined", new Date("2026-06-26T01:00:00Z"));

    await tick(repo, NOW, TICK);
    const seatC = await seatOf("shift-boat-c-2026-07-02");
    expect(await askedIds(seatC)).toContain("dana"); // 07-02 is a clean day
  });
});

describe("precedence — urgent blast (DEC-129 hard, even under urgency)", () => {
  // Urgent seat U: trip 07-03 15:00 → fills-by 07-01 15:00. Blast at 07-01 15:30
  // (≥ fills-by → urgent) while Wendy is mid-cruise on a 07-01 boat.
  it("blast fills a free captain but never the mid-cruise worker", async () => {
    const vu = await vessel("boat-u");
    const vw = await vessel("boat-w");
    await event(vu, "eu", "2026-07-03", "15:00");
    await event(vw, "ew", "2026-07-01", "15:00");
    await formShifts(repo);
    await manualOverride(repo, await seatOf("shift-boat-w-2026-07-01"), await captain("wendy"), new Date("2026-06-25T00:00:00Z"));
    await captain("free");
    const seatU = await seatOf("shift-boat-u-2026-07-03");

    await tick(repo, new Date("2026-07-01T15:30:00Z"), TICK);
    const asked = await askedIds(seatU);
    expect(asked).toContain("free"); // free captain blasted
    expect(asked).not.toContain("wendy"); // worker never blasted (hard)
  });
});
