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
    const view = (await buildAssignmentView(repo, SHIFT))!;
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
    const view = (await buildAssignmentView(repo, SHIFT))!;
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
    const view = (await buildAssignmentView(repo, SHIFT))!;
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
    const view = (await buildAssignmentView(repo, SHIFT))!;
    expect(view.seats[0]!.state).toBe("Claimed");
    expect(view.seats[0]!.occupant).toBe("crew-a");
    expect(view.seats[0]!.pool).toBeUndefined();
    void a;
  });
});

describe("renderAssignmentView", () => {
  it("produces a readable card list with header badge", async () => {
    await addCrew("crew-a");
    await addSeat();
    const view = (await buildAssignmentView(repo, SHIFT))!;
    const text = renderAssignmentView(view);
    expect(text).toContain("Hops — 2026-07-01  [Pending]");
    expect(text).toContain("Open");
    expect(text).toContain("crew-a: available");
  });
});
