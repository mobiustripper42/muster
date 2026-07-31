/**
 * The Tier-1 ask/confirm loop — seat machine + bail/timeout/override
 * (§1.2, §2.4, DEC-007, DEC-019). (Task 1.4b / M3.)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Credential, CrewMember, Event, Seat, Shift } from "../domain/entities.js";
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

/**
 * A shift anchored to a real scheduled trip on `tripDate` — so the horizon-aware
 * refresh (DEC-128) has an event to compute a staffing horizon from. `addShift`'s
 * `eventIds: []` yields a `null` horizon (seat-fold fallback); this yields a live
 * one. With the default 7-day lead (America/New_York): a trip far out sits
 * pre-horizon (→ Pending); a trip a few days out sits past-horizon (→ Filling /
 * AtRisk). `now` in these tests is T0 = 2026-07-01T12:00Z.
 */
async function addShiftWithTrip(tripDate: string, seatCount = 1): Promise<SeatId[]> {
  const eventId = asId<"EventId">(`ev-${tripDate}`);
  const event: Event = {
    id: eventId,
    vesselId: VESSEL,
    date: tripDate,
    time: "15:00",
    capacity: 16,
    source: "xola",
    status: "scheduled",
  };
  await repo.saveEvent(event);
  const shift: Shift = {
    id: SHIFT,
    vesselId: VESSEL,
    date: tripDate,
    state: "Pending",
    eventIds: [eventId],
  };
  await repo.saveShift(shift);
  const ids: SeatId[] = [];
  for (let i = 1; i <= seatCount; i++) {
    const seatId = asId<"SeatId">(`seat-${i}`);
    await repo.saveSeat({
      id: seatId,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    ids.push(seatId);
  }
  return ids;
}

/** Trip dates relative to T0 (2026-07-01) under the default 7-day horizon lead. */
const PRE_HORIZON_TRIP = "2026-09-01"; // ~2 months out → horizon not yet reached
const PAST_HORIZON_TRIP = "2026-07-05"; // 4 days out → horizon (Jun 28) already passed

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

describe("cross-shift double-book on accept (#522 sweep 3)", () => {
  /** A second shift on the SAME date, different vessel — the two-boats-one-day shape. */
  async function addSecondBoatSameDay(): Promise<SeatId> {
    const shiftId = asId<"ShiftId">("shift-2");
    await repo.saveShift({
      id: shiftId,
      vesselId: asId<"VesselId">("vessel-y"),
      date: DATE,
      state: "Pending",
      eventIds: [],
    });
    const seatId = asId<"SeatId">("seat-boat2");
    await repo.saveSeat({
      id: seatId,
      shiftId,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });
    return seatId;
  }

  it("refuses the second accept when both asks are already outstanding", async () => {
    // THE hole. `committedOnShift` scans one shift, and `notDoubleBooked` runs at
    // fan-out time when the candidate is committed nowhere — so the accept path was
    // the one seating path with no cross-shift guard. The tick's #393 day-spread
    // normally stops two same-day asks reaching one person, but the urgent blast
    // path drops it. Two texts, two taps, both shifts green, one boat with nobody
    // at the dock — and the At-Risk board can't see it, because both resolve Crewed.
    const captain = await addCrew("crew-captain");
    const [s1] = await addShift(1);
    const s2 = await addSecondBoatSameDay();

    // Both asks fired BEFORE either is answered — an outstanding ask is not a
    // commitment, so ask-time eligibility can't catch this.
    const a1 = await assignPerson(repo, s1!, captain, T0);
    const a2 = await assignPerson(repo, s2, captain, T0);

    const first = await recordResponse(repo, a1!.id, "accepted", later(1000));
    expect(first).toMatchObject({ claimed: true });

    // 60 seconds later — sequential and deterministic, not a race.
    const second = await recordResponse(repo, a2!.id, "accepted", later(61_000));
    expect(second).toMatchObject({ claimed: false, reason: "double_booked" });

    expect(await shiftState(asId<"ShiftId">("shift-2"))).not.toBe("Crewed");
    expect(await seatState(s2)).toBe("Asked");
  });

  it("still allows the same person on the same date's OTHER seat set on a different date", async () => {
    // The guard is date-scoped, not person-scoped: a commitment on one day must not
    // bar the next. Cheap, and it's the assertion that fails if someone reaches for
    // a blunter "already committed anywhere" check.
    const captain = await addCrew("crew-captain");
    const [s1] = await addShift(1);
    const a1 = await assignPerson(repo, s1!, captain, T0);
    await recordResponse(repo, a1!.id, "accepted", later(1000));

    const otherDayShift = asId<"ShiftId">("shift-next-day");
    await repo.saveShift({
      id: otherDayShift,
      vesselId: asId<"VesselId">("vessel-y"),
      date: "2026-07-02",
      state: "Pending",
      eventIds: [],
    });
    const seatId = asId<"SeatId">("seat-next-day");
    await repo.saveSeat({
      id: seatId,
      shiftId: otherDayShift,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    });

    const a2 = await assignPerson(repo, seatId, captain, later(2000));
    const out = await recordResponse(repo, a2!.id, "accepted", later(3000));
    expect(out).toMatchObject({ claimed: true });
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

describe("bail (DEC-019, DEC-128 #483 — fires no asks, defers to the tick)", () => {
  async function confirmFirst(seatId: SeatId, crewId: CrewMemberId) {
    const ask = await assignPerson(repo, seatId, crewId, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
  }

  it("logs the bail, clears the occupant, rests the seat Open — and fires NO asks", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a live pool — proof the deferral, not exhaustion, is why nothing fires
    const [seatId] = await addShift(1);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, no ask minted

    await bail(repo, seatId!, later(3000), 90 * 60_000);

    expect(await seatState(seatId!)).toBe("Open"); // NOT Asked (no re-ask), NOT Bailed
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBeUndefined();
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]); // the crux: zero re-asks
    expect(await types(a)).toContain("shift_bailed"); // the log still happens
  });

  it("clears seat provenance on re-open (#196)", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShift(1);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, acquiredVia "operator"
    expect((await repo.getSeat(seatId!))!.acquiredVia).toBe("operator");

    await bail(repo, seatId!, later(3000), 90 * 60_000);
    // The provenance is the occupant's; a re-opened seat carries none, so the next
    // occupant's path sets it fresh (no stale "operator" badging an ask-accepter).
    expect((await repo.getSeat(seatId!))!.acquiredVia).toBeUndefined();
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

/**
 * The #483 fix, end to end: bail/vacate rest the seat Open and the horizon-aware
 * refresh (DEC-128) lands the shift in its correct badge synchronously — Pending
 * pre-horizon (the silent fix), Filling in-horizon with a live pool, AtRisk only
 * for a past-horizon exhausted pool (via `resolveShiftState`, never a resting
 * `Bailed` seat). No asks are minted on any path — the tick re-crews.
 */
describe("bail/vacate — horizon-aware refresh, no inline asks (DEC-128 #483)", () => {
  it("PRE-HORIZON bail rests Open + resolves Pending + fires nothing (the prod repro)", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // pool is live; being pre-horizon (not empty) is why it's silent
    const [seatId] = await addShiftWithTrip(PRE_HORIZON_TRIP);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, no ask

    await bail(repo, seatId!, later(3000), 90 * 60_000);

    expect(await seatState(seatId!)).toBe("Open");
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]); // no pool blast weeks out
    expect(await shiftState(SHIFT)).toBe("Pending"); // silent — engine abstains pre-horizon
  });

  it("PAST-HORIZON bail with a live pool rests Open + resolves Filling (tick will drip)", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShiftWithTrip(PAST_HORIZON_TRIP);
    await manualOverride(repo, seatId!, a, T0);

    await bail(repo, seatId!, later(3000), 90 * 60_000);

    expect(await seatState(seatId!)).toBe("Open");
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]); // still no inline re-ask
    expect(await shiftState(SHIFT)).toBe("Filling"); // in-horizon: worked, next tick drips
  });

  it("PAST-HORIZON bail with an exhausted pool resolves AtRisk via resolveShiftState (not a Bailed seat)", async () => {
    const a = await addCrew("crew-a"); // eligible, but committed elsewhere the same day →
    // once they bail this seat they're the only captain AND already booked → pool empty.
    // Second shift, same date, holds crew-a Confirmed (fixtured) so the target shift's
    // pool excludes them (committed-dates gate, oracle.ts).
    const otherShift = asId<"ShiftId">("shift-other");
    await repo.saveShift({
      id: otherShift,
      vesselId: VESSEL,
      date: PAST_HORIZON_TRIP,
      state: "Crewed",
      eventIds: [],
    });
    await repo.saveSeat({
      id: asId<"SeatId">("seat-other"),
      shiftId: otherShift,
      role: CAPTAIN,
      kind: "required",
      state: "Confirmed",
      assignedCrewMemberId: a,
    });
    const [seatId] = await addShiftWithTrip(PAST_HORIZON_TRIP);
    await manualOverride(repo, seatId!, a, T0); // Confirmed on the target seat too

    await bail(repo, seatId!, later(3000), 90 * 60_000);

    expect(await seatState(seatId!)).toBe("Open"); // NOT Bailed — retired as a resting state
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]);
    expect(await shiftState(SHIFT)).toBe("AtRisk"); // past horizon + exhausted pool
  });

  it("PRE-HORIZON vacate rests Open + resolves Pending + fires nothing, no penalty", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b");
    const [seatId] = await addShiftWithTrip(PRE_HORIZON_TRIP);
    await manualOverride(repo, seatId!, a, T0);

    const out = await vacateSeat(repo, seatId!, later(3000), a);

    expect(out.removed).toBe(a);
    expect(await seatState(seatId!)).toBe("Open");
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]);
    expect(await shiftState(SHIFT)).toBe("Pending");
    expect(await types(a)).not.toContain("shift_bailed"); // vacate stays penalty-free
  });
});

describe("vacateSeat — no-penalty remove (#87)", () => {
  async function confirmFirst(seatId: SeatId, crewId: CrewMemberId) {
    const ask = await assignPerson(repo, seatId, crewId, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId, later(2000));
  }

  it("clears the occupant, rests Open, fires NO asks, logs NO reliability bail", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a live pool — nothing fires because vacate defers, not exhausts
    const [seatId] = await addShift(1);
    await manualOverride(repo, seatId!, a, T0); // Confirmed, no ask minted

    const out = await vacateSeat(repo, seatId!, later(3000), a);
    expect(out.removed).toBe(a); // the audit `crew_removed` subject (#400, DEC-118)
    expect(await seatState(seatId!)).toBe("Open"); // rests Open — never re-asked
    expect(await repo.listAsksForSeat(seatId!)).toEqual([]); // re-crewing left to the tick
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBeUndefined();
    // The whole point: no bail logged against the removed person.
    expect(await types(a)).not.toContain("shift_bailed");
  });

  it("rests at Open (never Bailed) — no bail-driven AtRisk (horizon clock governs)", async () => {
    const a = await addCrew("crew-a"); // the only eligible captain
    const [seatId] = await addShift(1); // no events → null horizon → seat-fold fallback

    await manualOverride(repo, seatId!, a, T0);
    const out = await vacateSeat(repo, seatId!, later(3000), a);
    expect(out.removed).toBe(a);
    expect(await seatState(seatId!)).toBe("Open");
    // No bail, no events → seat-fold on an Open seat = Pending, never AtRisk.
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
      source: "xola", status: "scheduled",
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

  it("refuses to bail a Completed shift — you can't back out of work you did (#570)", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const ask = await assignPerson(repo, seatId!, a, T0);
    await recordResponse(repo, ask!.id, "accepted", later(1000));
    await confirmSeat(repo, seatId!, later(2000));
    const shift = (await repo.getShift(SHIFT))!;
    await repo.saveShift({ ...shift, state: "Completed" });

    const out = await bailWithDerivedLateness(repo, seatId!, later(3000), a);

    // Without the guard this logs the FULL penalty: notice is negative once the trip
    // has run, so `bailLatenessMs` saturates at the whole lead (−11.4 at the default
    // horizon) — on top of the +5 the completion sweep already granted for the same
    // trip. And since `refreshShiftStateHorizon` returns early on a terminal state,
    // the shift would be left `Completed` with an `Open` seat beneath it.
    expect(out.code).toBe("shift_over");
    expect(await types(a)).not.toContain("shift_bailed");
    expect((await repo.getSeat(seatId!))!.state).toBe("Confirmed");
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(a);
    expect((await repo.getShift(SHIFT))!.state).toBe("Completed");
  });
});

describe("manualOverride — the authority backstop (§2.4)", () => {
  it("drops anyone into a seat straight to Confirmed, no reliability event", async () => {
    const a = await addCrew("crew-a");
    const [seatId] = await addShift(1);
    await broadcastAsk(repo, seatId!, T0); // seat now Asked
    const placed = await manualOverride(repo, seatId!, a, later(5000));
    const seat = placed!.seat;
    expect(seat.state).toBe("Confirmed");
    expect(seat.assignedCrewMemberId).toBe(a);
    expect(seat.acquiredVia).toBe("operator"); // provenance (#196) → My shifts badges it
    expect(placed!.displaced).toBeUndefined(); // seat was Asked/empty — no bump
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

  it("reports the displaced prior occupant when an override bumps someone (#400, DEC-118)", async () => {
    const first = await addCrew("cap-first");
    const second = await addCrew("cap-second");
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    // Seat first Confirmed to `first`, then overridden to `second`.
    expect((await overrideSeat(repo, seatId, first, T0)).displaced).toBeUndefined();
    const out = await overrideSeat(repo, seatId, second, later(1000));
    expect(out.code).toBeNull();
    expect(out.displaced).toBe(first); // captured before the overwrite
    expect((await repo.getSeat(seatId))!.assignedCrewMemberId).toBe(second);
  });

  it("no displacement when the override re-places the SAME occupant (#400)", async () => {
    const cap = await addCrew("cap-1");
    const seatId = await mkSeat("seat-cap", CAPTAIN);
    await overrideSeat(repo, seatId, cap, T0);
    const out = await overrideSeat(repo, seatId, cap, later(1000));
    expect(out.code).toBeNull();
    expect(out.displaced).toBeUndefined(); // same person → nobody bumped
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

// A Xola cancellation makes a shift terminal, but DEC-084 leaves its seats. A seat
// mutation afterwards runs `refreshShiftState`, whose pure seat-fold can't yield
// Cancelled — so without the lifecycle guard it overwrote `Cancelled` with a live
// state, un-hiding the shift and re-arming the tick's ask loop. Prod repro: a crew
// "no" on a leftover ask auto-resurrected a cancelled trip (brew-1/19th), and an
// operator bail did the same (brew-3/18th).
describe("refreshShiftState — terminal shifts never resurrect (cancel/complete guard)", () => {
  async function cancel(state: Shift["state"] = "Cancelled") {
    const shift = (await repo.getShift(SHIFT))!;
    await repo.saveShift({ ...shift, state });
  }

  it("a crew decline on a leftover ask does NOT un-cancel the shift", async () => {
    await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0); // live ask on the seat
    await cancel(); // Xola cancels the trip out from under the ask (seat stays, DEC-084)

    await recordResponse(repo, asks[0]!.id, "declined", later(1000)); // the crew taps "no"

    expect(await shiftState(SHIFT)).toBe("Cancelled");
  });

  it("an operator bail on a leftover confirmed seat does NOT un-cancel the shift", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b"); // a pool exists to re-ask, so the bail path runs fully
    const [seatId] = await addShift(1);
    const seat = (await repo.getSeat(seatId!))!;
    await repo.saveSeat({ ...seat, state: "Confirmed", assignedCrewMemberId: a });
    await cancel();

    await bail(repo, seatId!, later(1000), 0);

    expect(await shiftState(SHIFT)).toBe("Cancelled");
  });

  it("a Completed shift is equally inert to a seat mutation", async () => {
    await addCrew("crew-a");
    const [seatId] = await addShift(1);
    const asks = await broadcastAsk(repo, seatId!, T0);
    await cancel("Completed");

    await recordResponse(repo, asks[0]!.id, "declined", later(1000));

    expect(await shiftState(SHIFT)).toBe("Completed");
  });
});

describe("out-raced by a self-claim (#440)", () => {
  // #440 lets a crew member self-claim a seat that already has an outstanding
  // ask, so an asked member can answer a seat that's already gone. The operator
  // rule: ANY In or Out scores a + — the response is credited on its own terms,
  // regardless of whether the seat survived. Silence is the only sin.
  it("an 'In' to a seat someone else already took still credits ask_accepted", async () => {
    const asked = await addCrew("crew-asked");
    const claimer = await addCrew("crew-claimer");
    const [seatId] = await addShift(1);

    const asks = await broadcastAsk(repo, seatId!, T0);
    const theirAsk = asks.find((a) => a.crewMemberId === asked)!;

    // Somebody else takes the seat out from under the ask (what claimSeat does).
    await repo.saveSeat({
      ...(await repo.getSeat(seatId!))!,
      state: "Confirmed",
      assignedCrewMemberId: claimer,
      acquiredVia: "self_claim",
    });

    const out = await recordResponse(repo, theirAsk.id, "accepted", later(3000));
    expect(out).toMatchObject({ claimed: false, reason: "already_filled" });
    // The seat didn't move — but the willingness was still scored.
    expect(await types(asked)).toEqual(["ask_sent", "ask_accepted"]);
    expect((await repo.getSeat(seatId!))!.assignedCrewMemberId).toBe(claimer);
  });

  it("an 'Out' to a seat someone else already took still credits ask_declined", async () => {
    const asked = await addCrew("crew-asked");
    const claimer = await addCrew("crew-claimer");
    const [seatId] = await addShift(1);

    const asks = await broadcastAsk(repo, seatId!, T0);
    const theirAsk = asks.find((a) => a.crewMemberId === asked)!;

    await repo.saveSeat({
      ...(await repo.getSeat(seatId!))!,
      state: "Confirmed",
      assignedCrewMemberId: claimer,
      acquiredVia: "self_claim",
    });

    await recordResponse(repo, theirAsk.id, "declined", later(3000));
    expect(await types(asked)).toEqual(["ask_sent", "ask_declined"]);
    // The claimer keeps the seat — a decline never reopens a held seat.
    expect(await seatState(seatId!)).toBe("Confirmed");
  });
});
