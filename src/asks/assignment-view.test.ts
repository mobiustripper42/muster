/**
 * Assignment view — seat cards, ranked pool, ask-status vocabulary (§2.4).
 * The headline: `silent` is first-class and distinct from `declined`.
 * (Task 1.4b / M3.)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Credential, CrewMember, Seat, Shift, Vessel } from "../domain/entities.js";
import {
  assignPerson,
  bail,
  broadcastAsk,
  confirmSeat,
  expireAsks,
  recordResponse,
} from "./ask-loop.js";
import { buildAssignmentView, renderAssignmentView } from "./assignment-view.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">("shift-1");
const DATE = "2026-07-01";
const T0 = new Date("2026-07-01T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  const vessel: Vessel = {
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  };
  await repo.saveVessel(vessel);
  const shift: Shift = {
    id: SHIFT,
    vesselId: VESSEL,
    date: DATE,
    state: "Pending",
    eventIds: [],
  };
  await repo.saveShift(shift);
});

async function addCrew(id: string): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  const cred: Credential = {
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  };
  await repo.saveCredential(cred);
  return crewId;
}

async function addSeat(): Promise<SeatId> {
  const seatId = asId<"SeatId">("seat-1");
  const seat: Seat = {
    id: seatId,
    shiftId: SHIFT,
    role: CAPTAIN,
    kind: "required",
    state: "Open",
  };
  await repo.saveSeat(seat);
  return seatId;
}

describe("buildAssignmentView", () => {
  it("renders an Open seat with the ranked eligible pool, all 'available'", async () => {
    await addCrew("crew-a");
    await addCrew("crew-b");
    const seatId = await addSeat();
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    expect(view.vesselName).toBe("Hops");
    expect(view.badge).toBe("Pending");
    expect(view.seats).toHaveLength(1);
    const card = view.seats[0]!;
    expect(card.state).toBe("Open");
    expect(card.pool!.map((p) => p.crewMemberId)).toEqual([
      asId<"CrewMemberId">("crew-a"),
      asId<"CrewMemberId">("crew-b"),
    ]); // ranked (neutral → id order)
    expect(card.pool!.every((p) => p.status === "available")).toBe(true);
    void seatId;
  });

  it("distinguishes silent (timed out) from declined — both first-class", async () => {
    const a = await addCrew("crew-a"); // will decline
    const b = await addCrew("crew-b"); // will go silent
    const seatId = await addSeat();
    const asks = await broadcastAsk(repo, seatId, T0);
    const aAsk = asks.find((x) => x.crewMemberId === a)!;
    await recordResponse(repo, aAsk.id, "declined", later(2000));
    // b never answers; sweep past the timeout.
    await expireAsks(repo, seatId, later(10 * 60_000), 5 * 60_000);
    // Seat reopened (all asks closed) → pool shows both statuses.
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    const pool = view.seats[0]!.pool!;
    const byId = Object.fromEntries(pool.map((p) => [p.crewMemberId, p.status]));
    expect(byId[a]).toBe("declined");
    expect(byId[b]).toBe("silent");
    // The decliner carries a reply latency; the ghost does not.
    expect(pool.find((p) => p.crewMemberId === a)!.replyMs).toBe(2000);
    expect(pool.find((p) => p.crewMemberId === b)!.replyMs).toBeUndefined();
  });

  it("shows occupant name + state for a confirmed seat (no pool)", async () => {
    const a = await addCrew("crew-a");
    const seatId = await addSeat();
    const ask = await assignPerson(repo, seatId, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    const card = view.seats[0]!;
    expect(card.state).toBe("Confirmed");
    expect(card.occupant).toBe("crew-a");
    expect(card.pool).toBeUndefined();
    expect(view.badge).toBe("Crewed");
  });

  it("a Claimed seat shows occupant and no pool", async () => {
    const a = await addCrew("crew-a");
    const seatId = await addSeat();
    const asks = await broadcastAsk(repo, seatId, T0);
    await recordResponse(repo, asks[0]!.id, "accepted", later(7000));
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    expect(view.seats[0]!.state).toBe("Claimed");
    expect(view.seats[0]!.occupant).toBe("crew-a");
    expect(view.seats[0]!.pool).toBeUndefined();
    void a;
  });
});

describe("buildAssignmentView — cockpit additions (#54)", () => {
  it("carries header facts: trips + booked pax, tripStart, horizon", async () => {
    await addCrew("crew-a");
    await addSeat();
    const e1 = asId<"EventId">("event-1");
    const e2 = asId<"EventId">("event-2");
    await repo.saveEvent({
      id: e1,
      vesselId: VESSEL,
      date: DATE,
      time: "15:00",
      capacity: 12,
      status: "scheduled",
    });
    await repo.saveEvent({
      id: e2,
      vesselId: VESSEL,
      date: DATE,
      time: "13:00",
      capacity: 12,
      status: "scheduled",
    });
    await repo.saveReservation({
      id: asId<"ReservationId">("res-1"),
      eventId: e2,
      customerName: "Pat",
      partySize: 5,
      status: "booked",
    });
    await repo.saveReservation({
      id: asId<"ReservationId">("res-2"),
      eventId: e2,
      customerName: "Quinn",
      partySize: 3,
      status: "cancelled", // not aboard, not counted
    });
    const shift = (await repo.getShift(SHIFT))!;
    await repo.saveShift({ ...shift, eventIds: [e1, e2] });

    // tz: "UTC" — assert against UTC-interpreted instants (DEC-032).
    const view = (await buildAssignmentView(repo, SHIFT, T0, "UTC"))!;
    expect(view.trips).toEqual([
      { departureTime: "13:00", pax: 5 },
      { departureTime: "15:00", pax: 0 },
    ]);
    expect(view.paxTotal).toBe(5);
    expect(view.tripStart).toEqual(new Date(`${DATE}T13:00:00.000Z`));
    // Horizon = earliest start − 7d lead (DEC-022).
    expect(view.horizon).toEqual(new Date("2026-06-24T13:00:00.000Z"));
  });

  it("an event-less shift has empty trips and null time anchors", async () => {
    await addSeat();
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    expect(view.trips).toEqual([]);
    expect(view.paxTotal).toBe(0);
    expect(view.tripStart).toBeNull();
    expect(view.horizon).toBeNull();
  });

  it("labels each seat card with its role", async () => {
    await addSeat();
    await repo.saveRoleType({
      id: CAPTAIN,
      tenantId: asId<"TenantId">("tenant-1"),
      name: "Captain",
    });
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    expect(view.seats[0]!.role).toBe(CAPTAIN);
    expect(view.seats[0]!.roleName).toBe("Captain");
  });

  it("an Asked seat shows its pool — the monitor view of who's in flight", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b");
    const seatId = await addSeat();
    await broadcastAsk(repo, seatId, T0);
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    const card = view.seats[0]!;
    expect(card.state).toBe("Asked");
    expect(card.pool!.map((p) => p.status)).toEqual(["asked", "asked"]);
    void a;
  });

  it("a Bailed seat lists its bailer as 'bailed' (context, not re-asked) before who can step in (#3.3)", async () => {
    const a = await addCrew("crew-a");
    const seatId = await addSeat();
    const ask = await assignPerson(repo, seatId, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
    await bail(repo, seatId, later(3000), 0); // alone in the pool → rests Bailed
    const b = await addCrew("crew-b"); // a candidate exists now

    const view = (await buildAssignmentView(repo, SHIFT, later(4000)))!;
    const card = view.seats[0]!;
    expect(card.state).toBe("Bailed");
    // Bailer listed first as `bailed` (seen, not re-asked — DEC-019), then the
    // eligible candidate as `available` (the actionable one).
    expect(card.pool!.map((p) => [p.crewMemberId, p.status])).toEqual([
      [a, "bailed"],
      [b, "available"],
    ]);
  });

  it("excludes a bailer from EVERY pool on the shift — never 'said yes' on the seat they walked", async () => {
    const a = await addCrew("crew-a"); // will bail seat-1
    const b = await addCrew("crew-b"); // gets the re-ask (live on seat-1)
    const c = await addCrew("crew-c"); // free
    const seat1 = await addSeat();
    const seat2 = asId<"SeatId">("seat-2");
    await repo.saveSeat({
      id: seat2,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    const ask = await assignPerson(repo, seat1, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seat1, later(2000));
    await bail(repo, seat1, later(3000), 0); // pool non-empty → seat-1 → Asked

    const view = (await buildAssignmentView(repo, SHIFT, later(4000)))!;
    const s1 = view.seats.find((s) => s.seatId === seat1)!;
    const s2 = view.seats.find((s) => s.seatId === seat2)!;
    expect(s1.state).toBe("Asked");
    // The bailer's stale 'accepted' must NOT surface as "in" — they're gone.
    expect(s1.pool!.map((p) => p.crewMemberId)).not.toContain(a);
    expect(s2.pool!.map((p) => p.crewMemberId)).not.toContain(a);
    // bail() re-asked the whole remaining pool (b AND c) — both visible as
    // asked on seat-1, both held out of seat-2 while those asks are live.
    expect(s1.pool!.map((p) => p.status)).toEqual(["asked", "asked"]);
    expect(s1.pool!.map((p) => p.crewMemberId)).toEqual([b, c]);
    expect(s2.pool).toEqual([]);
  });

  it("shows a live-ask holder only on the seat their ask is on", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const seat1 = await addSeat();
    const seat2 = asId<"SeatId">("seat-2");
    await repo.saveSeat({
      id: seat2,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    await assignPerson(repo, seat1, a, T0); // a is live on seat-1

    const view = (await buildAssignmentView(repo, SHIFT, later(1000)))!;
    const s1 = view.seats.find((s) => s.seatId === seat1)!;
    const s2 = view.seats.find((s) => s.seatId === seat2)!;
    expect(s1.pool!.find((p) => p.crewMemberId === a)?.status).toBe("asked");
    expect(s2.pool!.map((p) => p.crewMemberId)).toEqual([b]); // a held out
  });

  it("excludes crew already committed on another seat of this shift", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const seatId = await addSeat();
    const seat2 = asId<"SeatId">("seat-2");
    await repo.saveSeat({
      id: seat2,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    const ask = await assignPerson(repo, seatId, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000)); // a → Claimed

    const view = (await buildAssignmentView(repo, SHIFT, later(2000)))!;
    const open = view.seats.find((s) => s.seatId === seat2)!;
    expect(open.pool!.map((p) => p.crewMemberId)).toEqual([b]); // a is taken
  });
});

describe("renderAssignmentView", () => {
  it("produces a readable card list with header badge", async () => {
    await addCrew("crew-a");
    await addSeat();
    const view = (await buildAssignmentView(repo, SHIFT, T0))!;
    const text = renderAssignmentView(view);
    expect(text).toContain("Hops — 2026-07-01  [Pending]");
    expect(text).toContain("Open");
    expect(text).toContain("crew-a: available");
  });
});
