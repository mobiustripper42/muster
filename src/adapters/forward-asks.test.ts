import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Ask } from "../domain/entities.js";
import type { ChannelPort } from "../ports/channel.js";
import { FakeChannel } from "./fake-channel.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { forwardAsks } from "./forward-asks.js";
import { WebLinkChannel } from "./web-link-channel.js";

const T0 = new Date("2026-07-01T12:00:00.000Z");
const TENANT = asId<"TenantId">("tenant-x");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const CREW = asId<"CrewMemberId">("crew-a");
const SHIFT = asId<"ShiftId">("shift-1");
const SEAT = asId<"SeatId">("seat-1");

async function seedSpine(repo: InMemoryRepository): Promise<Ask> {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveVessel({
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  await repo.saveCrewMember({
    id: CREW,
    name: "Quint",
    phone: "+15555550100",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveShift({
    id: SHIFT,
    vesselId: VESSEL,
    date: "2026-07-04",
    state: "Filling",
    eventIds: [],
  });
  await repo.saveSeat({
    id: SEAT,
    shiftId: SHIFT,
    role: CAPTAIN,
    kind: "required",
    state: "Asked",
  });
  const ask: Ask = {
    id: asId<"AskId">("ask-1"),
    seatId: SEAT,
    crewMemberId: CREW,
    channel: "push",
    sentAt: T0.toISOString(),
  };
  await repo.saveAsk(ask);
  return ask;
}

describe("forwardAsks — the edge wiring's shared seam (DEC-030)", () => {
  it("an ask fired → an OutboxEntry exists (through the real web-link adapter)", async () => {
    const repo = new InMemoryRepository();
    const ask = await seedSpine(repo);
    const channel = new WebLinkChannel(repo, {
      linkBase: "http://mill-dev:3000",
      now: () => T0,
      mintSecret: () => "secret-0",
    });

    expect(await forwardAsks(repo, channel, [ask])).toBe(1);

    const [entry] = await repo.listOutboxEntries();
    expect(entry).toMatchObject({
      askId: ask.id,
      seatId: SEAT,
      crewMemberId: CREW,
      status: "pending",
      // Human relay text from the spine — date · vessel · role.
      body: "Muster: Sat, Jul 4 · Hops · captain — in or out?",
      link: "http://mill-dev:3000/crew/auth?t=secret-0",
    });
  });

  it("addresses the message to the crew member's phone with full correlation", async () => {
    const repo = new InMemoryRepository();
    const ask = await seedSpine(repo);
    const fake = new FakeChannel(() => T0);

    await forwardAsks(repo, fake, [ask]);

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({
      kind: "ask",
      to: { crewMemberId: CREW, phone: "+15555550100" },
      seatId: SEAT,
      askId: ask.id,
    });
  });

  it("is best-effort: a rejecting channel doesn't throw, and the count says what landed", async () => {
    const repo = new InMemoryRepository();
    const ask = await seedSpine(repo);
    const broken: ChannelPort = {
      send: async () => {
        throw new Error("medium down");
      },
    };
    await expect(forwardAsks(repo, broken, [ask])).resolves.toBe(0);
  });

  it("skips an ask whose spine is gone instead of relaying a half-card", async () => {
    const repo = new InMemoryRepository();
    const ask = await seedSpine(repo);
    await repo.removeSeat(SEAT); // dangling ask
    const fake = new FakeChannel(() => T0);
    expect(await forwardAsks(repo, fake, [ask])).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });
});
