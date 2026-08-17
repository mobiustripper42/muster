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
    expect(sent.body).toBe("Muster: you're off the Sat, Jul 4 - Barrel shift.");
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
    expect(fake.last()!.body).toBe("Muster: you're on the Sat, Jul 4 - Barrel shift.");
  });

  it("phrases a changed notice as a shift-changed prompt when it has no detail (#350)", async () => {
    // The fallback, still reachable: a caller with no diff to hand (and the pre-watermark rows
    // described in the `earliest_start` migration) gets the original text.
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    await forwardNotices(repo, fake, [
      { crewMemberId: CREW, action: "changed", shiftId: SHIFT },
    ]);
    expect(fake.last()!.body).toBe("Muster: your Sat, Jul 4 - Barrel shift changed.");
  });

  it("says WHAT changed when the detail is there (#740)", async () => {
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    await forwardNotices(repo, fake, [
      {
        crewMemberId: CREW,
        action: "changed",
        shiftId: SHIFT,
        detail: {
          added: [asId<"EventId">("new-trip")],
          removed: [],
          startBefore: "2026-05-16T19:30:00.000Z", // 3:30 PM local → 2:45 call
          startAfter: "2026-05-16T18:00:00.000Z", // 2:00 PM local → 1:15 call
        },
      },
    ]);
    expect(fake.last()!.body).toBe(
      "Muster: your Sat, Jul 4 - Barrel shift changed: call 2:45->1:15, +1 trip.",
    );
  });

  it("stays one GSM-7 segment, falling back rather than splitting (#740, #619)", async () => {
    // #619 was bitten by a single character silently doubling the segment count. The summary is
    // fitted against the REAL remaining budget — the opener, the date and the vessel name are all
    // already spent — so this asserts the finished body, not the fragment.
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    await forwardNotices(repo, fake, [
      {
        crewMemberId: CREW,
        action: "changed",
        shiftId: SHIFT,
        detail: {
          added: Array.from({ length: 9 }, (_, i) => asId<"EventId">(`t${i}`)),
          removed: [],
          startBefore: "2026-05-16T19:30:00.000Z",
          startAfter: "2026-05-16T18:00:00.000Z",
        },
      },
    ]);
    const body = fake.last()!.body;
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toMatch(/^[ -~]*$/); // printable ASCII — a strict subset of GSM-7
  });

  it("does not claim a call-time change on a shift whose start is unknown (#740)", async () => {
    // A row written before the `earliest_start` watermark existed reads absent. Unknown is not
    // "moved": the notice reports the trip count and says nothing about the clock.
    const repo = await seed();
    const fake = new FakeNoticeChannel();
    await forwardNotices(repo, fake, [
      {
        crewMemberId: CREW,
        action: "changed",
        shiftId: SHIFT,
        detail: {
          added: [asId<"EventId">("new-trip")],
          removed: [],
          startBefore: null,
          startAfter: "2026-05-16T18:00:00.000Z",
        },
      },
    ]);
    expect(fake.last()!.body).toBe(
      "Muster: your Sat, Jul 4 - Barrel shift changed: +1 trip.",
    );
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
