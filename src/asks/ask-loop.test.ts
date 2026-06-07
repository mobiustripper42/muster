/**
 * The Tier-1 ask/confirm loop — seat machine + bail/timeout/override
 * (§1.2, §2.4, DEC-007, DEC-019). (Task 1.4b / M3.)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Credential, CrewMember, Seat, Shift } from "../domain/entities.js";
import { logShiftCompleted } from "../oracle/reliability-log.js";
import {
  assignPerson,
  bail,
  broadcastAsk,
  confirmSeat,
  expireAsks,
  manualOverride,
  recordResponse,
  resolveProtocol,
} from "./ask-loop.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">("shift-1");
const DATE = "2026-07-01";
const T0 = new Date("2026-07-01T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(id: string, over: Partial<CrewMember> = {}): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...over,
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

async function addShift(seatCount: number): Promise<SeatId[]> {
  const shift: Shift = {
    id: SHIFT,
    vesselId: VESSEL,
    date: DATE,
    state: "Pending",
    eventIds: [],
  };
  await repo.saveShift(shift);
  const ids: SeatId[] = [];
  for (let i = 1; i <= seatCount; i++) {
    const seatId = asId<"SeatId">(`seat-${i}`);
    const seat: Seat = {
      id: seatId,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    };
    await repo.saveSeat(seat);
    ids.push(seatId);
  }
  return ids;
}

const seatState = (id: SeatId) => repo.getSeat(id).then((s) => s!.state);
const shiftState = (id: ShiftId) => repo.getShift(id).then((s) => s!.state);
const types = (crewId: CrewMemberId) =>
  repo.reliabilityEventsFor(crewId).then((es) => es.map((e) => e.type));

// Pool ranking lives in oracle/reliability-score.ts now (rankByReliability +
// effectiveRankScore), tested there. The loop just consumes the ranked order.

describe("happy path — broadcast → accept → confirm", () => {
  it("walks Open→Asked→Claimed→Confirmed and the badge to Crewed", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);

    const asks = await broadcastAsk(repo, seatId!, T0);
    expect(asks).toHaveLength(1);
    expect(await seatState(seatId!)).toBe("Asked");

    const out = await recordResponse(repo, asks[0]!.id, "accepted", later(3000));
    expect(out).toMatchObject({ claimed: true, seatState: "Claimed" });
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);

    await confirmSeat(repo, seatId!, later(4000));
    expect(await seatState(seatId!)).toBe("Confirmed");
    expect(await shiftState(SHIFT)).toBe("Crewed");
    expect(await types(a)).toEqual(["ask_sent", "ask_accepted"]);
  });
});

describe("assign-then-confirm (captain flow)", () => {
  it("names one person; accept claims, confirm locks", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const ask = await assignPerson(repo, seatId!, a, T0);
    expect(ask).not.toBeNull();
    expect((await repo.listAsksForSeat(seatId!))).toHaveLength(1);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId!, later(2000));
    expect(await seatState(seatId!)).toBe("Confirmed");
  });
});

describe("contested seat — first-acceptable-yes-wins (DEC-007)", () => {
  it("second accept loses but is still logged as responsive", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    expect(asks).toHaveLength(2);

    const first = asks.find((x) => x.crewMemberId === a)!;
    const second = asks.find((x) => x.crewMemberId === b)!;
    const w = await recordResponse(repo, first.id, "accepted", later(1000));
    const l = await recordResponse(repo, second.id, "accepted", later(2000));

    expect(w.claimed).toBe(true);
    expect(l).toMatchObject({ claimed: false, reason: "already_filled" });
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
    // The loser's positive responsiveness still counts.
    expect(await types(b)).toContain("ask_accepted");
  });

  it("ranking sets ask ORDER, not outcome: a lower-ranked first-yes still wins", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    // b is the more reliable → broadcast asks b first. But a answers yes first.
    await logShiftCompleted(repo, b, SHIFT, T0);
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    expect(asks[0]!.crewMemberId).toBe(b); // ranked first…

    const aAsk = asks.find((x) => x.crewMemberId === a)!;
    const bAsk = asks.find((x) => x.crewMemberId === b)!;
    const w = await recordResponse(repo, aAsk.id, "accepted", later(1000));
    const l = await recordResponse(repo, bAsk.id, "accepted", later(2000));

    expect(w.claimed).toBe(true);
    expect(l).toMatchObject({ claimed: false, reason: "already_filled" });
    // …but a got the seat — first acceptable yes wins regardless of rank (DEC-007).
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
  });
});

describe("intra-shift shared pool (DEC-003) — can't crew two seats on one boat", () => {
  it("a dual-rated person already on seat 1 is excluded from seat 2's asks", async () => {
    const both = await addCrew("crew-both", { ratings: [CAPTAIN] });
    await addCrew("crew-b");
    const [s1, s2] = await addShift(2);
    // Claim seat 1 for the dual-rated crew.
    const a1 = await assignPerson(repo, s1!, both, T0);
    await recordResponse(repo, a1!.id, "accepted", later(1000));
    // Broadcasting seat 2 must NOT ask the person already holding seat 1.
    const a2 = await broadcastAsk(repo, s2!, later(2000));
    expect(a2.map((x) => x.crewMemberId)).not.toContain(both);
    expect(a2.map((x) => x.crewMemberId)).toContain(asId<"CrewMemberId">("crew-b"));
  });

  it("rejects a claim that would double-book within the shift", async () => {
    const both = await addCrew("crew-both");
    const [s1, s2] = await addShift(2);
    // Fire asks to both seats BEFORE either is claimed (so the guard, not the
    // ask-time exclusion, is what catches it).
    const a1 = await assignPerson(repo, s1!, both, T0);
    const a2 = await assignPerson(repo, s2!, both, T0);
    await recordResponse(repo, a1!.id, "accepted", later(1000)); // claims s1
    const out = await recordResponse(repo, a2!.id, "accepted", later(2000));
    expect(out).toMatchObject({ claimed: false, reason: "double_booked" });
  });
});

describe("all-declined reopens the seat", () => {
  it("after every candidate declines, seat returns to Open", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, asks[0]!.id, "declined", later(1000));
    expect(await seatState(seatId!)).toBe("Asked"); // one still outstanding
    await recordResponse(repo, asks[1]!.id, "declined", later(2000));
    expect(await seatState(seatId!)).toBe("Open"); // all closed, none claimed
    void a;
    void b;
  });
});

describe("expireAsks — the clockless ask_ignored sweep", () => {
  it("logs ask_ignored, reopens the seat, and is idempotent", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);

    // Too soon — nothing expires.
    expect(await expireAsks(repo, seatId!, later(60_000), 5 * 60_000)).toBe(0);
    // Past the timeout — the silent ask expires.
    expect(await expireAsks(repo, seatId!, later(10 * 60_000), 5 * 60_000)).toBe(1);
    expect(await seatState(seatId!)).toBe("Open");
    expect(await types(a)).toContain("ask_ignored");
    // Idempotent — a second sweep expires nothing.
    expect(await expireAsks(repo, seatId!, later(20 * 60_000), 5 * 60_000)).toBe(0);
    expect(await repo.reliabilityEventsFor(a)).toHaveLength(2); // sent + ignored
    void asks;
  });
});

describe("bail (DEC-019)", () => {
  async function confirmFirst(seatId: SeatId, crewId: CrewMemberId) {
    const ask = await assignPerson(repo, seatId, crewId, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
  }

  it("re-asks the next candidate and lands the seat at Asked (happy path)", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a second eligible captain to re-ask
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await bail(repo, seatId!, later(3000), 90 * 60_000);
    expect(out.seatState).toBe("Asked");
    // Re-ask excludes the bailer.
    expect(out.reAsks.map((x) => x.crewMemberId)).toEqual([asId<"CrewMemberId">("crew-b")]);
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBeUndefined();
    expect(await types(a)).toContain("shift_bailed");
  });

  it("rests at Bailed → AtRisk when the pool is exhausted", async () => {
    const a = await addCrew("crew-a"); // the only eligible captain
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await bail(repo, seatId!, later(3000), 30 * 60_000);
    expect(out).toMatchObject({ seatState: "Bailed", reAsks: [] });
    expect(await shiftState(SHIFT)).toBe("AtRisk");
  });
});

describe("manualOverride — the authority backstop (§2.4)", () => {
  it("drops anyone into a seat straight to Confirmed, no reliability event", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    await broadcastAsk(repo, seatId!, T0); // seat now Asked
    const seat = await manualOverride(repo, seatId!, a, later(5000));
    expect(seat!.state).toBe("Confirmed");
    expect(seat!.assignedCrewMemberId).toBe(a);
    expect(await shiftState(SHIFT)).toBe("Crewed");
    expect(await types(a)).not.toContain("ask_accepted"); // override isn't responsiveness
  });
});

describe("resolveProtocol", () => {
  it("person override wins; else the per-role default", () => {
    const base: CrewMember = {
      id: asId<"CrewMemberId">("c"),
      name: "c",
      phone: "5",
      ratings: [CAPTAIN],
      status: "active",
      reliabilityScore: null,
    };
    expect(resolveProtocol(base, "ask_then_assign")).toBe("ask_then_assign");
    expect(
      resolveProtocol({ ...base, protocolOverride: "assign_then_confirm" }, "ask_then_assign"),
    ).toBe("assign_then_confirm");
  });
});
