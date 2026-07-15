/**
 * Outbox view model (DEC-030) — urgency sort, the derived why-line, and the
 * settled-ask drop. Read-model only: the view reads outbox state; it never
 * influences any domain decision.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Ask, OutboxEntry } from "../domain/entities.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import { buildOutboxView } from "./outbox-view.js";

const TENANT = asId<"TenantId">("tenant-x");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const NOW = new Date("2026-07-01T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
});

async function addCrew(id: string, name: string): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    phone: `+1555000${id.length}`,
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  return crewId;
}

/** One vessel+shift+seat with a trip `hoursOut` from NOW. */
async function addShift(key: string, hoursOut: number): Promise<{ shiftId: ShiftId; seatId: SeatId }> {
  const vesselId = asId<"VesselId">(`vessel-${key}`);
  const shiftId = asId<"ShiftId">(`shift-${key}`);
  const eventId = asId<"EventId">(`evt-${key}`);
  const seatId = asId<"SeatId">(`seat-${key}`);
  const trip = new Date(NOW.getTime() + hoursOut * 3_600_000);
  await repo.saveVessel({
    id: vesselId,
    name: `Vessel ${key}`,
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  await repo.saveEvent({
    id: eventId,
    vesselId,
    date: trip.toISOString().slice(0, 10),
    time: trip.toISOString().slice(11, 16),
    capacity: 12,
    source: "xola", status: "scheduled",
  });
  await repo.saveShift({
    id: shiftId,
    vesselId,
    date: trip.toISOString().slice(0, 10),
    state: "Filling",
    eventIds: [eventId],
  });
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role: CAPTAIN,
    kind: "required",
    state: "Asked",
  });
  return { shiftId, seatId };
}

async function addAsk(
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  sentAt: string,
  settle?: { respondedAt: string; response?: "accepted" | "declined" },
): Promise<Ask> {
  const ask: Ask = {
    id: asId<"AskId">(`ask-${seatId}-${crewMemberId}-${sentAt}`),
    seatId,
    crewMemberId,
    channel: "push",
    sentAt,
    ...(settle ?? {}),
  };
  await repo.saveAsk(ask);
  return ask;
}

async function addEntry(
  ask: Ask,
  over: Partial<OutboxEntry> = {},
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: asId<"OutboxEntryId">(`obx-${ask.id}`),
    askId: ask.id,
    seatId: ask.seatId,
    crewMemberId: ask.crewMemberId,
    body: "Muster: in or out?",
    link: "http://mill-dev:3000/crew/auth?t=x",
    status: "pending",
    createdAt: ask.sentAt,
    ...over,
  };
  await repo.saveOutboxEntry(entry);
  return entry;
}

describe("buildOutboxView", () => {
  it("sorts pending by tightness-to-trip and keeps sent below, never mixed", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const mira = await addCrew("crew-mira", "Mira");
    const far = await addShift("far", 96);
    const near = await addShift("near", 20);
    const sent = await addShift("sent", 8);
    await addEntry(await addAsk(far.seatId, mira, "2026-07-01T10:00:00.000Z"));
    await addEntry(await addAsk(near.seatId, bo, "2026-07-01T11:00:00.000Z"));
    await addEntry(await addAsk(sent.seatId, mira, "2026-07-01T09:00:00.000Z"), {
      id: asId<"OutboxEntryId">("obx-sent"),
      status: "sent",
      sentAt: "2026-07-01T09:30:00.000Z",
    });

    // tz: "UTC" — events are minted from UTC instants here (DEC-032).
    const view = await buildOutboxView(repo, NOW, { tz: "UTC" });

    // Tightest pending first (20h before 96h); the 8h SENT card stays in its
    // own muted section even though its trip is tighter than every pending one.
    expect(view.pending.map((c) => c.crewName)).toEqual(["Bo", "Mira"]);
    expect(view.pending[0]).toMatchObject({
      vesselName: "Vessel near",
      roleName: "captain",
      status: "pending",
    });
    expect(view.pending[0]!.hoursToTrip).toBeCloseTo(20, 5);
    expect(view.sent.map((c) => c.entryId)).toEqual(["obx-sent"]);
    expect(view.sent[0]!.sentAt).toBe("2026-07-01T09:30:00.000Z");
  });

  it("dismiss (removeOutboxEntry) hides the card; the ask stays live (#158)", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const near = await addShift("near", 20);
    const ask = await addAsk(near.seatId, bo, "2026-07-01T11:00:00.000Z");
    const entry = await addEntry(ask);
    expect(
      (await buildOutboxView(repo, NOW, { tz: "UTC" })).pending,
    ).toHaveLength(1);

    // What the dismiss action does: delete the outbox row only.
    await repo.removeOutboxEntry(entry.id);

    const view = await buildOutboxView(repo, NOW, { tz: "UTC" });
    expect(view.pending).toHaveLength(0); // card cleared from the worklist
    const stillLive = await repo.getAsk(ask.id);
    expect(stillLive?.respondedAt).toBeUndefined(); // ask untouched — rides to its timeout
  });

  it("carries the start–end window: tripEnd = tripStart + trip length + teardown (DEC-041, #275)", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const near = await addShift("near", 20); // trip 2026-07-02T08:00Z
    await addEntry(await addAsk(near.seatId, bo, "2026-07-01T11:00:00.000Z"));

    const view = await buildOutboxView(repo, NOW, { tz: "UTC" });
    const card = view.pending[0]!;
    expect(card.tripStart).toBe("2026-07-02T08:00:00.000Z");
    expect(card.tripEnd).toBe("2026-07-02T10:05:00.000Z"); // +100 trip +25 teardown
  });

  it("drops an entry the moment its ask settles — answered, timed out, or vanished", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const a = await addShift("a", 24);
    const b = await addShift("b", 36);
    const c = await addShift("c", 48);
    await addEntry(
      await addAsk(a.seatId, bo, "2026-07-01T10:00:00.000Z", {
        respondedAt: "2026-07-01T11:00:00.000Z",
        response: "accepted",
      }),
    );
    await addEntry(
      await addAsk(b.seatId, bo, "2026-07-01T10:00:00.000Z", {
        respondedAt: "2026-07-01T11:00:00.000Z", // no response = timed out
      }),
    );
    const ghost = await addAsk(c.seatId, bo, "2026-07-01T10:00:00.000Z");
    await addEntry(ghost, { askId: asId<"AskId">("never-existed") });

    const view = await buildOutboxView(repo, NOW);
    expect(view.pending).toEqual([]);
    expect(view.sent).toEqual([]);
  });

  it("derives the why-line: broadcast = one round, a later nudge is the 2nd ask with the prior outcome named", async () => {
    const lance = await addCrew("crew-lance", "Lance");
    const gardner = await addCrew("crew-gardner", "Gardner");
    const sub = await addCrew("crew-sub", "Marisol");
    const { seatId } = await addShift("w", 30);
    // Round 1 — a broadcast at one instant: Lance declined, Gardner went silent.
    await addAsk(seatId, lance, "2026-07-01T08:00:00.000Z", {
      respondedAt: "2026-07-01T09:00:00.000Z",
      response: "declined",
    });
    await addAsk(seatId, gardner, "2026-07-01T08:00:00.000Z", {
      respondedAt: "2026-07-01T10:00:00.000Z", // timed out
    });
    // Round 2 — the live re-ask being relayed.
    const reAsk = await addAsk(seatId, sub, "2026-07-01T11:00:00.000Z");
    await addEntry(reAsk);

    const view = await buildOutboxView(repo, NOW);
    expect(view.pending).toHaveLength(1);
    expect(view.pending[0]!.why.ordinal).toBe(2); // round, not raw ask count (3)
    expect(view.pending[0]!.why.prior).toEqual({
      crewName: "Lance",
      outcome: "declined",
    });
  });

  it("a first-round ask has ordinal 1 and no prior", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const { seatId } = await addShift("f", 30);
    const ask = await addAsk(seatId, bo, "2026-07-01T11:00:00.000Z");
    await addEntry(ask);

    const view = await buildOutboxView(repo, NOW);
    expect(view.pending[0]!.why).toEqual({ ordinal: 1, prior: null });
  });

  it("renders the stored body + link verbatim — never re-derived (DEC-030)", async () => {
    const bo = await addCrew("crew-bo", "Bo");
    const { seatId } = await addShift("v", 30);
    const ask = await addAsk(seatId, bo, "2026-07-01T11:00:00.000Z");
    await addEntry(ask, {
      body: "FROZEN BODY",
      link: "http://mill-dev:3000/crew/auth?t=frozen",
    });

    const view = await buildOutboxView(repo, NOW);
    expect(view.pending[0]!.body).toBe("FROZEN BODY");
    expect(view.pending[0]!.link).toBe("http://mill-dev:3000/crew/auth?t=frozen");
  });
});
