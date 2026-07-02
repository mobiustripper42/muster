/**
 * forwardNotices (DEC-084) — composes the "you're on / off a shift" relay body from
 * the shift facts and hands each to the notice channel; best-effort (a dangling ref
 * is skipped, not thrown). Sibling of forward-asks.test.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { FakeNoticeChannel } from "./fake-notice-channel.js";
import { forwardNotices } from "./forward-notices.js";
import { asId } from "../domain/ids.js";

const VESSEL = asId<"VesselId">("vessel-barrel");
const SHIFT = asId<"ShiftId">("shift-vessel-barrel-2026-07-04");
const CREW = asId<"CrewMemberId">("crew-bram");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveVessel({
    id: VESSEL,
    name: "Barrel",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  await repo.saveShift({
    id: SHIFT,
    vesselId: VESSEL,
    date: "2026-07-04",
    state: "Filling",
    eventIds: [],
  });
  await repo.saveCrewMember({
    id: CREW,
    name: "Bram",
    phone: "+15555550101",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  return repo;
}

describe("forwardNotices (DEC-084)", () => {
  it("composes an off-shift body from the shift facts and relays it", async () => {
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    const n = await forwardNotices(repo, fake, [
      { crewMemberId: CREW, action: "removed", shiftId: SHIFT },
    ]);
    expect(n).toBe(1);
    const sent = fake.last()!;
    expect(sent.body).toBe("Muster: you're off the Sat, Jul 4 · Barrel shift.");
    expect(sent.to.crewMemberId).toBe(CREW);
    expect(sent.to.phone).toBe("+15555550101");
    expect(sent.action).toBe("removed");
    expect(sent.shiftId).toBe(SHIFT);
  });

  it("phrases an added notice as on-shift", async () => {
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    await forwardNotices(repo, fake, [
      { crewMemberId: CREW, action: "added", shiftId: SHIFT },
    ]);
    expect(fake.last()!.body).toBe("Muster: you're on the Sat, Jul 4 · Barrel shift.");
  });

  it("skips a dangling crew ref (best-effort) without throwing", async () => {
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    const n = await forwardNotices(repo, fake, [
      { crewMemberId: asId<"CrewMemberId">("ghost"), action: "removed", shiftId: SHIFT },
    ]);
    expect(n).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });
});
