import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
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
      // Human relay text from the spine — GSM-7 only (1-segment SMS).
      body: "Muster: Sat, Jul 4 - Hops - captain. Yes or no?",
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

// ── Per-recipient batching (#393) ────────────────────────────────────────────

async function addSeatAsk(
  repo: InMemoryRepository,
  crewId: CrewMemberId,
  seat: string,
  ask: string,
): Promise<Ask> {
  await repo.saveSeat({
    id: asId<"SeatId">(seat),
    shiftId: SHIFT,
    role: CAPTAIN,
    kind: "required",
    state: "Asked",
  });
  const a: Ask = {
    id: asId<"AskId">(ask),
    seatId: asId<"SeatId">(seat),
    crewMemberId: crewId,
    channel: "push",
    sentAt: T0.toISOString(),
  };
  await repo.saveAsk(a);
  return a;
}

describe("forwardAsks — per-recipient batching (#393)", () => {
  it("coalesces one person's multiple asks into a single send with a count body", async () => {
    const repo = new InMemoryRepository();
    const a1 = await seedSpine(repo); // CREW, seat-1
    const a2 = await addSeatAsk(repo, CREW, "seat-2", "ask-2");
    const a3 = await addSeatAsk(repo, CREW, "seat-3", "ask-3");
    const fake = new FakeChannel(() => T0);

    // 3 asks covered, but only ONE message goes out.
    expect(await forwardAsks(repo, fake, [a1, a2, a3])).toBe(3);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.body).toBe("Muster: 3 shifts need you. Tap to answer.");
    // Correlates to the representative (first) ask; link is crew-scoped → /crew.
    expect(fake.sent[0]).toMatchObject({ kind: "ask", askId: a1.id, seatId: a1.seatId });
    expect(fake.sent[0]!.to.crewMemberId).toBe(CREW);
  });

  it("a lone ask still sends the per-seat 'Yes or no?' body (no batching)", async () => {
    const repo = new InMemoryRepository();
    const ask = await seedSpine(repo);
    const fake = new FakeChannel(() => T0);
    await forwardAsks(repo, fake, [ask]);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.body).toContain("Yes or no?");
  });

  it("batches per recipient — two people get two sends, not one blob", async () => {
    const repo = new InMemoryRepository();
    const a1 = await seedSpine(repo); // CREW
    const a2 = await addSeatAsk(repo, CREW, "seat-2", "ask-2"); // CREW again
    const crewB = asId<"CrewMemberId">("crew-b");
    await repo.saveCrewMember({
      id: crewB,
      name: "Hooper",
      phone: "+15555550111",
      ratings: [CAPTAIN],
      status: "active",
      reliabilityScore: null,
    });
    const b1 = await addSeatAsk(repo, crewB, "seat-b", "ask-b");
    const fake = new FakeChannel(() => T0);

    expect(await forwardAsks(repo, fake, [a1, a2, b1])).toBe(3);
    expect(fake.sent).toHaveLength(2); // CREW batched (1) + crewB single (1)
    const bodyByCrew = Object.fromEntries(
      fake.sent.map((s) => [s.to.crewMemberId, s.body]),
    );
    expect(bodyByCrew[CREW]).toBe("Muster: 2 shifts need you. Tap to answer.");
    expect(bodyByCrew[crewB]).toContain("Yes or no?");
  });

  it("anchors a batch to a surviving ask when the first ask's seat vanished", async () => {
    const repo = new InMemoryRepository();
    const a1 = await seedSpine(repo); // CREW, seat-1
    const a2 = await addSeatAsk(repo, CREW, "seat-2", "ask-2");
    await repo.removeSeat(SEAT); // a1's seat gone between firing and forwarding
    const fake = new FakeChannel(() => T0);

    expect(await forwardAsks(repo, fake, [a1, a2])).toBe(2);
    expect(fake.sent).toHaveLength(1);
    // Correlates to the SURVIVING ask (a2/seat-2), never the stale a1/seat-1 —
    // no orphan outbox entry.
    expect(fake.sent[0]!.seatId).toBe(a2.seatId);
    expect(fake.sent[0]!.body).toBe("Muster: 2 shifts need you. Tap to answer.");
  });
});
