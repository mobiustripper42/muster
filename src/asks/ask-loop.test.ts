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
  bailWithDerivedLateness,
  broadcastAsk,
  confirmSeat,
  expireAsks,
  manualOverride,
  overrideSeat,
  rankedEligible,
  recordResponse,
  recordResponseAndConfirm,
  resolveProtocol,
  vacateSeat,
  widenAsk,
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

describe("recordResponseAndConfirm — a winning in auto-confirms (DEC-061)", () => {
  it("broadcast: a winning accept lands Confirmed in one step, badge Crewed", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);

    const out = await recordResponseAndConfirm(repo, asks[0]!.id, "accepted", later(3000));
    expect(out).toMatchObject({ claimed: true, seatState: "Confirmed" });
    expect(await seatState(seatId!)).toBe("Confirmed");
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
    expect(await shiftState(SHIFT)).toBe("Crewed");
    // One accept event, NO confirm event (confirm logs nothing) — no double-count.
    expect(await types(a)).toEqual(["ask_sent", "ask_accepted"]);
  });

  it("captain (assign-then-confirm): the named person's accept auto-confirms", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const ask = await assignPerson(repo, seatId!, a, T0);
    const out = await recordResponseAndConfirm(repo, ask!.id, "accepted", later(1000));
    expect(out.seatState).toBe("Confirmed");
    expect(await seatState(seatId!)).toBe("Confirmed");
  });

  it("contested loser does NOT confirm — only the CAS winner is locked", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    const first = asks.find((x) => x.crewMemberId === a)!;
    const second = asks.find((x) => x.crewMemberId === b)!;

    const w = await recordResponseAndConfirm(repo, first.id, "accepted", later(1000));
    const l = await recordResponseAndConfirm(repo, second.id, "accepted", later(2000));

    expect(w).toMatchObject({ claimed: true, seatState: "Confirmed" });
    // The loser's response must not flip the winner's confirmed seat to the loser.
    expect(l).toMatchObject({ claimed: false, reason: "already_filled" });
    expect(await seatState(seatId!)).toBe("Confirmed");
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
  });

  it("double-booked accept does not confirm (DEC-003 shared pool)", async () => {
    const a = await addCrew("crew-a");
    const [s1, s2] = await addShift(2);
    const a1 = (await broadcastAsk(repo, s1!, T0)).find((x) => x.crewMemberId === a)!;
    const a2 = (await broadcastAsk(repo, s2!, T0)).find((x) => x.crewMemberId === a)!;
    await recordResponseAndConfirm(repo, a1.id, "accepted", later(1000)); // confirms s1
    const out = await recordResponseAndConfirm(repo, a2.id, "accepted", later(2000));
    expect(out).toMatchObject({ claimed: false, reason: "double_booked" });
    expect(await seatState(s2!)).not.toBe("Confirmed");
  });

  it("a decline never confirms (neutral, passes through)", async () => {
    await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    const out = await recordResponseAndConfirm(repo, asks[0]!.id, "declined", later(1000));
    expect(out.claimed).toBe(false);
    expect(await seatState(seatId!)).toBe("Open"); // single ask declined → reopened
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

describe("widenAsk — drip primitive (DEC-063)", () => {
  it("fires ONE ask to the top-ranked candidate and opens the seat", async () => {
    await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const ask = await widenAsk(repo, seatId!, T0);
    expect(ask).not.toBeNull();
    expect(await seatState(seatId!)).toBe("Asked");
    expect(await repo.listAsksForSeat(seatId!)).toHaveLength(1);
  });

  it("excludes already-asked crew — successive widens pick distinct people", async () => {
    await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const a1 = await widenAsk(repo, seatId!, T0);
    const a2 = await widenAsk(repo, seatId!, later(1000));
    expect(a1!.crewMemberId).not.toBe(a2!.crewMemberId);
    expect(await repo.listAsksForSeat(seatId!)).toHaveLength(2);
  });

  it("returns null once the pool is walked (nothing un-asked left)", async () => {
    await addCrew("crew-a");
    const [seatId] = await addShift(1);
    expect(await widenAsk(repo, seatId!, T0)).not.toBeNull(); // the one candidate
    expect(await widenAsk(repo, seatId!, later(1000))).toBeNull(); // nobody left
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

describe("recordResponse — re-tap is idempotent (#145)", () => {
  it("a second response to an already-answered ask doesn't re-log and reports already_answered", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);

    await recordResponse(repo, asks[0]!.id, "declined", later(1000));
    // Re-tap the same (now-answered) ask — must be a no-op, not a second log.
    const out = await recordResponse(repo, asks[0]!.id, "accepted", later(2000));

    expect(out).toEqual({
      claimed: false,
      reason: "already_answered",
      seatState: "Open",
    });
    expect(await types(a)).toEqual(["ask_sent", "ask_declined"]); // no re-logged accept
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

  it("clears seat provenance on re-open (#196)", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a re-ask pool so the seat lands Asked, not Bailed
    const [seatId] = await addShift(1);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, acquiredVia "operator"
    expect((await repo.getSeat(seatId!))!.acquiredVia).toBe("operator");

    await bail(repo, seatId!, later(3000), 90 * 60_000);
    // The provenance is the occupant's; a re-opened seat carries none, so the next
    // occupant's path sets it fresh (no stale "operator" badging an ask-accepter).
    expect((await repo.getSeat(seatId!))!.acquiredVia).toBeUndefined();
  });

  it("clears provenance even when resting Bailed — exhausted pool (#196)", async () => {
    const a = await addCrew("crew-a"); // the only eligible captain → pool exhausts on bail
    const [seatId] = await addShift(1);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, acquiredVia "operator"
    const out = await bail(repo, seatId!, later(3000), 30 * 60_000);
    expect(out.seatState).toBe("Bailed");
    expect((await repo.getSeat(seatId!))!.acquiredVia).toBeUndefined();
  });

  it("rests at Bailed → AtRisk when the pool is exhausted", async () => {
    const a = await addCrew("crew-a"); // the only eligible captain
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await bail(repo, seatId!, later(3000), 30 * 60_000);
    expect(out).toMatchObject({ seatState: "Bailed", reAsks: [] });
    expect(await shiftState(SHIFT)).toBe("AtRisk");
  });

  it("logs the raw notice alongside the derived lateness (DEC-028)", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const noticeMs = 36 * 3600_000; // 36h before the trip
    await bail(repo, seatId!, later(3000), 90 * 60_000, noticeMs);
    const bailed = (await repo.reliabilityEventsFor(a)).find(
      (e) => e.type === "shift_bailed",
    )!;
    expect(bailed.metadata.latenessMs).toBe(90 * 60_000);
    expect(bailed.metadata.noticeMs).toBe(noticeMs);
  });

  it("refuses to bail a different occupant than the caller pinned", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a); // a holds the seat; caller validated b

    await expect(bail(repo, seatId!, later(3000), 0, undefined, b)).rejects.toThrow();
    expect((await repo.getSeat(seatId!))!.state).toBe("Confirmed"); // untouched
    expect(await types(a)).not.toContain("shift_bailed"); // nobody penalized
  });
});

describe("vacateSeat — no-penalty remove (#87)", () => {
  async function confirmFirst(seatId: SeatId, crewId: CrewMemberId) {
    const ask = await assignPerson(repo, seatId, crewId, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
  }

  it("clears + re-asks the next candidate and logs NO reliability bail", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a second eligible captain to re-ask
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await vacateSeat(repo, seatId!, later(3000), a);
    expect(out.seatState).toBe("Asked");
    // Re-ask excludes the removed occupant, just like bail.
    expect(out.reAsks.map((x) => x.crewMemberId)).toEqual([asId<"CrewMemberId">("crew-b")]);
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBeUndefined();
    // The whole point: no bail logged against the removed person.
    expect(await types(a)).not.toContain("shift_bailed");
  });

  it("rests at Open (not Bailed) when the pool is exhausted — no AtRisk", async () => {
    const a = await addCrew("crew-a"); // the only eligible captain
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await vacateSeat(repo, seatId!, later(3000), a);
    expect(out).toMatchObject({ seatState: "Open", reAsks: [] });
    expect(await seatState(seatId!)).toBe("Open");
    // No bail → no immediate bail-driven AtRisk (Pending, horizon clock governs).
    expect(await shiftState(SHIFT)).not.toBe("AtRisk");
    expect(await types(a)).not.toContain("shift_bailed");
  });

  it("refuses to vacate a different occupant than the caller pinned", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a); // a holds the seat; caller validated b

    await expect(vacateSeat(repo, seatId!, later(3000), b)).rejects.toThrow();
    expect((await repo.getSeat(seatId!))!.state).toBe("Confirmed"); // untouched
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
  });
});

describe("bailWithDerivedLateness (DEC-028 glue — the one home of it)", () => {
  it("derives lateness + notice from the shift's events and logs both", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    // Anchor a trip 36h after T0 (the suite's addShift makes no events).
    const tripAt = later(36 * 3600_000);
    await repo.saveEvent({
      id: asId<"EventId">("evt-bail"),
      vesselId: VESSEL,
      date: tripAt.toISOString().slice(0, 10),
      time: tripAt.toISOString().slice(11, 16),
      capacity: 6,
      status: "scheduled",
    });
    const shift = (await repo.getShift(SHIFT))!;
    await repo.saveShift({ ...shift, eventIds: [asId<"EventId">("evt-bail")] });
    const ask = await assignPerson(repo, seatId!, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId!, later(2000));

    // tz: "UTC" — the event is minted from a UTC Date; UTC interpretation keeps
    // the 36h notice exact (DEC-032).
    const out = await bailWithDerivedLateness(repo, seatId!, T0, a, "UTC");
    expect(out.code).toBeNull();
    const event = (await repo.reliabilityEventsFor(a)).find(
      (e) => e.type === "shift_bailed",
    )!;
    expect(event.metadata.latenessMs).toBe((7 * 24 - 36) * 3600_000);
    expect(event.metadata.noticeMs).toBe(36 * 3600_000);
  });

  it("returns raced (no log, no seat change) when the occupant differs", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const [seatId] = await addShift(1);
    const ask = await assignPerson(repo, seatId!, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId!, later(2000));

    const out = await bailWithDerivedLateness(repo, seatId!, later(3000), b);
    expect(out.code).toBe("raced");
    expect((await repo.getSeat(seatId!))!.state).toBe("Confirmed");
    expect(await types(a)).not.toContain("shift_bailed");
  });

  it("returns raced on a seat that isn't Confirmed", async () => {
    await addCrew("crew-a");
    const [seatId] = await addShift(1); // Open
    const out = await bailWithDerivedLateness(repo, seatId!, T0);
    expect(out.code).toBe("raced");
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
    expect(seat!.acquiredVia).toBe("operator"); // provenance (#196) → My shifts badges it
    expect(await shiftState(SHIFT)).toBe("Crewed");
    expect(await types(a)).not.toContain("ask_accepted"); // override isn't responsiveness
  });
});

describe("overrideSeat — role-guarded override (DEC-064)", () => {
  const MATE = asId<"RoleTypeId">("role-mate");
  async function mkSeat(id: string, role: typeof CAPTAIN): Promise<SeatId> {
    const seatId = asId<"SeatId">(id);
    await repo.saveShift({
      id: SHIFT,
      vesselId: VESSEL,
      date: DATE,
      state: "Pending",
      eventIds: [],
    });
    await repo.saveSeat({
      id: seatId,
      shiftId: SHIFT,
      role,
      kind: "required",
      state: "Open",
    });
    return seatId;
  }

  it("rejects a mate placed into a captain seat (not_rated, seat untouched)", async () => {
    const mate = await addCrew("mate-1", { ratings: [MATE] });
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    const out = await overrideSeat(repo, seatId, mate, T0);
    expect(out.code).toBe("not_rated");
    expect((await repo.getSeat(seatId))!.state).toBe("Open");
    expect((await repo.getSeat(seatId))!.assignedCrewMemberId).toBeUndefined();
  });

  it("places a dual-rated captain into a MATE seat (the legit downward sub)", async () => {
    const cap = await addCrew("cap-1", { ratings: [CAPTAIN, MATE] });
    const seatId = await mkSeat("seat-mate", MATE);
    const out = await overrideSeat(repo, seatId, cap, T0);
    expect(out.code).toBeNull();
    const seat = await repo.getSeat(seatId);
    expect(seat!.state).toBe("Confirmed");
    expect(seat!.assignedCrewMemberId).toBe(cap);
  });

  it("places a captain into a captain seat", async () => {
    const cap = await addCrew("cap-1"); // ratings [CAPTAIN] by default
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    expect((await overrideSeat(repo, seatId, cap, T0)).code).toBeNull();
    expect((await repo.getSeat(seatId))!.state).toBe("Confirmed");
  });

  it("rejects an ARCHIVED crew even when rated (archived, seat untouched) — #323", async () => {
    const cap = await addCrew("cap-archived", { status: "archived" });
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    const out = await overrideSeat(repo, seatId, cap, T0);
    expect(out.code).toBe("archived");
    expect((await repo.getSeat(seatId))!.state).toBe("Open");
    expect((await repo.getSeat(seatId))!.assignedCrewMemberId).toBeUndefined();
  });

  it("still places an INACTIVE (benched) crew — disable ≠ removal (#323)", async () => {
    const cap = await addCrew("cap-inactive", { status: "inactive" });
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    expect((await overrideSeat(repo, seatId, cap, T0)).code).toBeNull();
    expect((await repo.getSeat(seatId))!.assignedCrewMemberId).toBe(cap);
  });

  it("gone for an unknown seat", async () => {
    const cap = await addCrew("cap-1");
    const out = await overrideSeat(repo, asId<"SeatId">("nope"), cap, T0);
    expect(out.code).toBe("gone");
  });
});

describe("broadcast — captains aren't asked for mate seats (#148, DEC-066)", () => {
  const MATE = asId<"RoleTypeId">("role-mate");
  async function mkSeat(id: string, role: typeof CAPTAIN): Promise<SeatId> {
    const seatId = asId<"SeatId">(id);
    await repo.saveShift({
      id: SHIFT,
      vesselId: VESSEL,
      date: DATE,
      state: "Pending",
      eventIds: [],
    });
    await repo.saveSeat({
      id: seatId,
      shiftId: SHIFT,
      role,
      kind: "required",
      state: "Open",
    });
    return seatId;
  }

  it("a mate seat is broadcast only to mates — the dual-rated captain is spared", async () => {
    const cap = await addCrew("cap-1", { ratings: [CAPTAIN, MATE] });
    const mate = await addCrew("mate-1", { ratings: [MATE] });
    const seatId = await mkSeat("seat-mate", MATE);

    const asks = await broadcastAsk(repo, seatId, T0);
    const askedIds = asks.map((a) => a.crewMemberId);
    expect(askedIds).toEqual([mate]); // only the mate is asked
    expect(askedIds).not.toContain(cap); // captain never asked for mate work
  });

  it("the same dual-rated captain IS broadcast for a captain seat", async () => {
    const cap = await addCrew("cap-1", { ratings: [CAPTAIN, MATE] });
    const seatId = await mkSeat("seat-cap", CAPTAIN);

    const asks = await broadcastAsk(repo, seatId, T0);
    expect(asks.map((a) => a.crewMemberId)).toEqual([cap]);
  });

  it("a mate seat with only captains gets no broadcast and stays Open (the reported edge)", async () => {
    await addCrew("cap-1", { ratings: [CAPTAIN, MATE] });
    await addCrew("cap-2", { ratings: [CAPTAIN, MATE] });
    const seatId = await mkSeat("seat-mate", MATE);

    const asks = await broadcastAsk(repo, seatId, T0);
    expect(asks).toEqual([]); // nobody asked — captains are spared
    expect((await repo.getSeat(seatId))!.state).toBe("Open"); // operator overrides
  });

  it("rankedEligible (the pool lean/escalate/board share) excludes the over-ranked captain", async () => {
    await addCrew("cap-1", { ratings: [CAPTAIN, MATE] });
    const mate = await addCrew("mate-1", { ratings: [MATE] });
    const seatId = await mkSeat("seat-mate", MATE);

    const pool = await rankedEligible(repo, (await repo.getSeat(seatId))!, T0);
    expect(pool.map((c) => c.id)).toEqual([mate]);
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

/**
 * Civil send window on the inline re-ask paths (9.9/#235, DEC-088) — outside
 * civil hours a bail/vacate still commits (log, occupant cleared) but the
 * engine's re-ask defers: the seat rests **Open** (never a fake `Bailed` →
 * AtRisk), and the next in-window tick's drip re-crews it. Windows injected
 * (the suite env holds the default wide open); tz UTC so wall-clock = instant.
 */
describe("bail/vacate — civil send window deferral (DEC-088)", () => {
  const NIGHT_OPTS = {
    tz: "UTC",
    civilWindow: { start: "08:00", end: "20:00" },
  };
  // T0 is 2026-06-25T12:00Z in this suite; 12:00 is inside — build a night clock.
  const NIGHT = new Date("2026-06-25T23:00:00.000Z");

  async function confirmFirst(seatId: SeatId, crewId: CrewMemberId) {
    const ask = await assignPerson(repo, seatId, crewId, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
  }

  it("a night bail logs + clears but DEFERS the re-ask: seat rests Open, zero sends", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a live pool — the deferral, not exhaustion, is why nothing fires
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await bail(repo, seatId!, NIGHT, 90 * 60_000, undefined, undefined, NIGHT_OPTS);
    expect(out.seatState).toBe("Open"); // NOT Bailed (nobody's exhausted), NOT Asked (no sends)
    expect(out.reAsks).toEqual([]);
    const seat = (await repo.getSeat(seatId!))!;
    expect(seat.assignedCrewMemberId).toBeUndefined();
    expect(seat.acquiredVia).toBeUndefined();
    expect(await types(a)).toContain("shift_bailed"); // the log is NOT deferred
  });

  it("an exhausted-pool night bail still rests Bailed → the honest AtRisk (no sends involved)", async () => {
    const a = await addCrew("crew-a"); // only captain — pool exhausts
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);
    const out = await bail(repo, seatId!, NIGHT, 90 * 60_000, undefined, undefined, NIGHT_OPTS);
    expect(out.seatState).toBe("Bailed");
  });

  it("a night vacate takes the rest-Open branch: no re-asks fired", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShift(1);
    await confirmFirst(seatId!, a);

    const out = await vacateSeat(repo, seatId!, NIGHT, a, NIGHT_OPTS);
    expect(out.seatState).toBe("Open");
    expect(out.reAsks).toEqual([]);
    expect(await types(a)).not.toContain("shift_bailed"); // vacate stays penalty-free
  });
});
