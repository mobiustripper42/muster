/**
 * The engine tick — horizon-driven shift advance + Tier-1 kick (DEC-022/023).
 * (Task 3.1a / Phase 3.)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { CrewMember, Event, Shift, Vessel } from "../domain/entities.js";
import { formShifts } from "./form-shifts.js";
import { resolveShiftStateOnRead, tick } from "./tick.js";
import {
  bail,
  confirmSeat,
  expireAsks,
  manualOverride,
  recordResponse,
} from "../asks/ask-loop.js";
import { SYSTEM_ACTOR_ID } from "../oracle/reliability-log.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">(`shift-${VESSEL}-2026-07-01`);
// Event 2026-07-01T15:00Z; horizon = −7d = 2026-06-24T15:00Z.
const BEFORE = new Date("2026-06-01T00:00:00.000Z");
const AFTER = new Date("2026-06-30T00:00:00.000Z");
const DEPARTED = new Date("2026-07-02T00:00:00.000Z"); // after the 2026-07-01 trip

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function seedVesselEvent(): Promise<void> {
  const vessel: Vessel = {
    id: VESSEL,
    name: "X",
    coiMaxPax: 16,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  };
  await repo.saveVessel(vessel);
  const event: Event = {
    id: asId<"EventId">("e1"),
    vesselId: VESSEL,
    date: "2026-07-01",
    time: "15:00",
    capacity: 16,
    source: "xola", status: "scheduled",
  };
  await repo.saveEvent(event);
}

async function addCaptain(id: string, over: Partial<CrewMember> = {}): Promise<CrewMemberId> {
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
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return crewId;
}

async function addMate(id: string): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [MATE],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return crewId;
}

const shiftState = () => repo.getShift(SHIFT).then((s) => s!.state);
const seatState = () =>
  repo.listSeatsForShift(SHIFT).then((seats) => seats[0]!.state);

describe("tick — horizon advance", () => {
  it("births a past-horizon shift into Filling and fires Tier-1 asks", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo); // Pending, one Open captain seat

    const r = await tick(repo, AFTER);

    expect(r.bornFilling).toBe(1);
    expect(r.shiftsAdvanced).toBe(1);
    expect(r.asksFired).toBe(1);
    expect(await shiftState()).toBe("Filling");
    expect(await seatState()).toBe("Asked"); // broadcastAsk moved it
    // The fired asks themselves are surfaced so the tick's trigger can forward
    // them to the channel adapter (DEC-030) — the core never sends.
    expect(r.firedAsks).toHaveLength(1);
    const seatAsks = await repo.listAsksForSeat(r.firedAsks[0]!.seatId);
    expect(seatAsks).toEqual(r.firedAsks);
  });

  it("never works a shift whose trip has already departed (#147, DEC-062)", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo); // Pending, one Open captain seat

    // `now` is AFTER the 2026-07-01 trip start — its horizon is long crossed, so
    // without the past-trip guard the shift would broadcast and (post-DEC-061)
    // auto-crew a departed trip. The guard skips it entirely.
    const r = await tick(repo, DEPARTED);

    expect(r.asksFired).toBe(0);
    expect(r.bornFilling).toBe(0);
    expect(r.shiftsAdvanced).toBe(0);
    expect(r.firedAsks).toHaveLength(0);
    expect(await shiftState()).toBe("Pending"); // untouched
    expect(await seatState()).toBe("Open"); // never asked
  });

  it("leaves a pre-horizon shift Pending and asks no one", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);

    const r = await tick(repo, BEFORE);

    expect(r.shiftsAdvanced).toBe(0);
    expect(r.asksFired).toBe(0);
    expect(await shiftState()).toBe("Pending");
    expect(await seatState()).toBe("Open");
  });

  it("marks a past-horizon shift AtRisk when the pool is exhausted", async () => {
    await seedVesselEvent();
    // No eligible crew at all → empty pool.
    await formShifts(repo);

    const r = await tick(repo, AFTER);

    expect(r.toAtRisk).toBe(1);
    expect(r.asksFired).toBe(0);
    expect(await shiftState()).toBe("AtRisk");
    // DEC-095: the landing is surfaced once for the operator alert…
    expect(r.boardLanded).toBe(1);
    expect(r.boardLandings).toEqual([{ shiftId: SHIFT, reason: "core" }]);
  });

  it("board landing is surfaced ONCE — a second tick on an unchanged board re-blasts nobody (DEC-095)", async () => {
    await seedVesselEvent();
    await formShifts(repo);
    const first = await tick(repo, AFTER);
    expect(first.boardLandings).toHaveLength(1);

    const second = await tick(repo, AFTER);
    // Still AtRisk, but already recorded → no new landing → the alert edge sends nothing.
    expect(await shiftState()).toBe("AtRisk");
    expect(second.boardLanded).toBe(0);
    expect(second.boardLandings).toEqual([]);
  });

  it("is idempotent — a second tick after birth advances nothing", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);
    await tick(repo, AFTER); // born Filling, seat Asked

    const second = await tick(repo, AFTER);

    expect(second.shiftsAdvanced).toBe(0);
    expect(await shiftState()).toBe("Filling");
  });

  it("is AtRisk when the last candidate is already committed to a sibling seat (DEC-003)", async () => {
    // Two captain seats, exactly one eligible captain. Per-seat pools would call
    // seat 2 fillable (cap-1 is captain-rated); the distinct-assignment solve
    // knows cap-1 can't crew both → exhausted → AtRisk.
    const vessel: Vessel = {
      id: VESSEL,
      name: "X",
      coiMaxPax: 16,
      manning: [{ roleTypeId: CAPTAIN, count: 2 }],
    };
    await repo.saveVessel(vessel);
    await repo.saveEvent({
      id: asId<"EventId">("e1"),
      vesselId: VESSEL,
      date: "2026-07-01",
      time: "15:00",
      capacity: 16,
      source: "xola", status: "scheduled",
    });
    const cap = await addCaptain("cap-1");
    await formShifts(repo);
    // Confirm cap-1 into seat 1; leave seat 2 Open.
    const seats = await repo.listSeatsForShift(SHIFT);
    await repo.saveSeat({ ...seats[0]!, state: "Confirmed", assignedCrewMemberId: cap });

    const r = await tick(repo, AFTER);

    expect(r.toAtRisk).toBe(1);
    expect(await shiftState()).toBe("AtRisk");
  });

  it("aggregates counters across multiple shifts in one sweep", async () => {
    // Shift A: captain vessel with an eligible captain → births Filling + asks.
    // Shift B: needs a MATE and no mate exists → AtRisk. (cap-1 is captain-only,
    // and not double-booked, so a captain seat on B would just pull cap-1 again.)
    await seedVesselEvent();
    await addCaptain("cap-1");
    const VESSEL_B = asId<"VesselId">("vessel-b");
    await repo.saveVessel({
      id: VESSEL_B,
      name: "B",
      coiMaxPax: 12,
      manning: [{ roleTypeId: MATE, count: 1 }],
    });
    await repo.saveEvent({
      id: asId<"EventId">("eb"),
      vesselId: VESSEL_B,
      date: "2026-07-02",
      time: "10:00",
      capacity: 12,
      source: "xola", status: "scheduled",
    });
    await formShifts(repo);

    const r = await tick(repo, AFTER);

    expect(r.shiftsAdvanced).toBe(2);
    expect(r.bornFilling).toBe(1); // shift A (has a captain)
    expect(r.toAtRisk).toBe(1); // shift B (no crew)
    expect(r.asksFired).toBe(1);
  });

  it("never resurrects a Cancelled or Completed shift", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);
    const shift = await repo.getShift(SHIFT);
    await repo.saveShift({ ...(shift as Shift), state: "Cancelled" });

    const r = await tick(repo, AFTER);

    expect(r.shiftsAdvanced).toBe(0);
    expect(await shiftState()).toBe("Cancelled");
  });
});

describe("tick — Tier-2 stall escalation (DEC-024)", () => {
  const T1 = new Date(AFTER.getTime() + 2 * 60 * 60_000); // +2h
  const T2 = new Date(AFTER.getTime() + 4 * 60 * 60_000); // +4h
  const T3 = new Date(AFTER.getTime() + 6 * 60 * 60_000); // +6h
  const HOUR = 60 * 60_000;

  const seatId = () => repo.listSeatsForShift(SHIFT).then((s) => s[0]!.id);
  /** The seat's one live (unanswered) ask — the nudge after escalate. */
  const liveAsk = async () =>
    (await repo.listAsksForSeat(await seatId())).find(
      (a) => a.respondedAt === undefined,
    )!;

  /** Birth Filling + Tier-1, then time the broadcast out → stalled, seat Open. */
  async function bornThenSilent() {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);
    await tick(repo, AFTER); // born Filling, cap-1 asked
    await expireAsks(repo, await seatId(), T1, HOUR); // cap-1 ghosts → seat Open
  }

  it("escalates a stalled Filling shift and nudges the silent captain", async () => {
    await bornThenSilent();
    expect(await seatState()).toBe("Open");

    const r = await tick(repo, T2);

    expect(r.shiftsEscalated).toBe(1);
    expect(r.nudgesFired).toBe(1);
    // The Tier-2 nudge ask rides the same forwarding seam (DEC-030).
    expect(r.firedAsks).toHaveLength(1);
    expect(r.firedAsks[0]!.crewMemberId).toBe(asId<"CrewMemberId">("cap-1"));
    expect(await seatState()).toBe("Asked"); // direct-nudged
    expect(await shiftState()).toBe("Filling"); // still autonomous, no Eric
    const events = await repo.reliabilityEventsFor(asId<"CrewMemberId">("cap-1"));
    expect(events.some((e) => e.type === "nudged")).toBe(true);
  });

  it("a nudge accepted rescues the shift to Crewed", async () => {
    await bornThenSilent();
    await tick(repo, T2); // nudges cap-1
    const nudge = await liveAsk();

    await recordResponse(repo, nudge.id, "accepted", T3); // Asked → Claimed
    await confirmSeat(repo, await seatId(), T3); // Claimed → Confirmed → Crewed

    expect(await seatState()).toBe("Confirmed");
    expect(await shiftState()).toBe("Crewed");
  });

  it("a nudge declined exhausts Tier-2 — escalate goes dry, shift stays Filling", async () => {
    await bornThenSilent();
    await tick(repo, T2); // nudges cap-1
    const nudge = await liveAsk();
    await recordResponse(repo, nudge.id, "declined", T3); // → seat reopens Open
    expect(await seatState()).toBe("Open");

    // Next tick: cap-1 is now both declined and already-nudged → no candidate.
    const r = await tick(repo, T3);

    expect(r.shiftsEscalated).toBe(1); // widen-stub still fires
    expect(r.nudgesFired).toBe(0); // nobody left to nudge
    // Stays Filling, NOT AtRisk: the oracle's exhaustion is eligibility-based and
    // cap-1 is still eligible. Willingness-exhaustion ("everyone passed") is the
    // At-Risk board's call (#41, 3.3), read off this escalation trail — not tick's.
    expect(await shiftState()).toBe("Filling");
  });
});

describe("tick — board-landing detection (DEC-026)", () => {
  it("records one board_landed per (shift, reason); a re-tick stays quiet", async () => {
    await seedVesselEvent();
    await formShifts(repo); // no crew at all → exhausted → resolved AtRisk

    const r1 = await tick(repo, AFTER);
    expect(r1.boardLanded).toBe(1);

    const r2 = await tick(repo, AFTER);
    expect(r2.boardLanded).toBe(0);

    const landings = (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID)).filter(
      (e) => e.type === "board_landed",
    );
    expect(landings).toHaveLength(1);
    expect(landings[0]!.metadata.shiftId).toBe(SHIFT);
    expect(landings[0]!.metadata.reason).toBe("core");
  });

  it("two reasons landing in ONE tick mint two distinct events (pg pkey regression)", async () => {
    // A Bailed seat past horizon lands core + regression in the same tick: both
    // events share crew (system), type, and timestamp — only `reason` separates
    // their ids. Without reason in the mint this was a Postgres pkey collision
    // the in-memory adapter silently swallowed.
    await seedVesselEvent();
    await formShifts(repo);
    const seats = await repo.listSeatsForShift(SHIFT);
    await repo.saveSeat({ ...seats[0]!, state: "Bailed" });

    const r = await tick(repo, AFTER);

    expect(r.boardLanded).toBe(2);
    const landings = (await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID)).filter(
      (e) => e.type === "board_landed",
    );
    expect(landings).toHaveLength(2);
    expect(new Set(landings.map((e) => e.id)).size).toBe(2); // distinct ids
    expect(landings.map((e) => e.metadata.reason).sort()).toEqual([
      "core",
      "regression",
    ]);
  });

  it("re-pings when a NEW reason appears (landed core, later regresses)", async () => {
    await seedVesselEvent();
    await formShifts(repo);
    await tick(repo, AFTER); // lands: core

    // The shift later regresses — a required seat rests Bailed.
    const seats = await repo.listSeatsForShift(SHIFT);
    await repo.saveSeat({ ...seats[0]!, state: "Bailed" });

    const r = await tick(repo, AFTER);
    expect(r.boardLanded).toBe(1); // regression is new; core already recorded
  });

  it("a near-term uncrewed shift lands even while worked (DEC-065); a Crewed one never does", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);

    // Born Filling with a live ask out, uncrewed, ~39h to the trip (inside the
    // 48h fills-by). DEC-065: a live ask no longer hides it — the operator IS
    // pinged about a near-term uncrewed shift, mid-ask.
    const r1 = await tick(repo, AFTER);
    expect(r1.boardLanded).toBe(1);

    const asks = await repo.listAsksForSeat(
      (await repo.listSeatsForShift(SHIFT))[0]!.id,
    );
    await recordResponse(repo, asks[0]!.id, "accepted", AFTER);
    await confirmSeat(repo, (await repo.listSeatsForShift(SHIFT))[0]!.id, AFTER);

    const r2 = await tick(repo, AFTER); // now Crewed and healthy → off the board
    expect(r2.boardLanded).toBe(0);
  });
});

describe("tick — completion sweep (#570)", () => {
  /** Crew the shift's single captain seat and confirm it, as of `AFTER`. */
  async function crewIt(): Promise<{ crew: CrewMemberId; seat: SeatId }> {
    const crew = await addCaptain("cap-1");
    await formShifts(repo);
    await tick(repo, AFTER); // births Filling + fires the ask
    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const asks = await repo.listAsksForSeat(seatId);
    await recordResponse(repo, asks[0]!.id, "accepted", AFTER);
    await confirmSeat(repo, seatId, AFTER);
    return { crew, seat: seatId };
  }

  it("completes a departed shift whose crew was still aboard, and scores each of them", async () => {
    await seedVesselEvent();
    const { crew, seat } = await crewIt();
    expect(await shiftState()).toBe("Crewed");

    // Departure is 15:00 TENANT-local (America/New_York) = 19:00Z, so the flat
    // shift end is 19:00Z + 100 trip + 25 teardown = 21:05Z on 07-01. DEPARTED is
    // 07-02T00:00Z, past it.
    const r = await tick(repo, DEPARTED);

    expect(r.shiftsCompleted).toBe(1);
    expect(await shiftState()).toBe("Completed");
    const completed = (await repo.reliabilityEventsFor(crew)).filter(
      (e) => e.type === "shift_completed",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]!.metadata.seatId).toBe(seat);
    expect(completed[0]!.metadata.shiftId).toBe(SHIFT);
  });

  it("does NOT complete before the shift end — a trip mid-water is not done", async () => {
    await seedVesselEvent();
    await crewIt();

    // 20:00Z: genuinely mid-trip — after the 19:00Z departure, before the 21:05Z end.
    const r = await tick(repo, new Date("2026-07-01T20:00:00.000Z"));

    expect(r.shiftsCompleted).toBe(0);
    expect(await shiftState()).toBe("Crewed");
  });

  it("respects the event's own duration — a long charter is still out when a flat shift would be done (#570)", async () => {
    await seedVesselEvent();
    // Same departure, but a 6-hour charter: ends 19:00Z + 360 + 25 = 01:25Z on 07-02.
    const e = (await repo.listEvents())[0]!;
    await repo.saveEvent({ ...e, durationMinutes: 360 });
    await crewIt();

    // DEPARTED (07-02T00:00Z) is the exact instant that completes a FLAT shift in
    // the first test. This charter is still on the water, so it must not complete —
    // this assertion is the whole point of per-event duration.
    expect((await tick(repo, DEPARTED)).shiftsCompleted).toBe(0);
    expect(await shiftState()).toBe("Crewed");

    expect(
      (await tick(repo, new Date("2026-07-02T02:00:00.000Z"))).shiftsCompleted,
    ).toBe(1);
    expect(await shiftState()).toBe("Completed");
  });

  it("is idempotent — a second sweep neither re-completes nor double-scores", async () => {
    await seedVesselEvent();
    const { crew } = await crewIt();

    await tick(repo, DEPARTED);
    const r2 = await tick(repo, DEPARTED);

    expect(r2.shiftsCompleted).toBe(0);
    expect(
      (await repo.reliabilityEventsFor(crew)).filter((e) => e.type === "shift_completed"),
    ).toHaveLength(1);
  });

  it("leaves a departed shift nobody crewed alone — no +5 for an empty boat", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo); // Pending, seat Open, never filled

    const r = await tick(repo, DEPARTED);

    expect(r.shiftsCompleted).toBe(0);
    expect(await shiftState()).toBe("Pending");
    expect(await repo.reliabilityEventsFor(asId<"CrewMemberId">("cap-1"))).toEqual([]);
  });

  it("scores only required seats — a supernumerary rider didn't crew it (DEC-087)", async () => {
    await seedVesselEvent();
    const { crew } = await crewIt();
    const rider = await addMate("rider");
    const seats = await repo.listSeatsForShift(SHIFT);
    await repo.saveSeat({
      ...seats[0]!,
      id: asId<"SeatId">("seat-super"),
      kind: "supernumerary",
      role: MATE,
      state: "Confirmed",
      assignedCrewMemberId: rider,
    });

    const r = await tick(repo, DEPARTED);

    expect(r.shiftsCompleted).toBe(1);
    expect(
      (await repo.reliabilityEventsFor(crew)).filter((e) => e.type === "shift_completed"),
    ).toHaveLength(1);
    expect(
      (await repo.reliabilityEventsFor(rider)).filter((e) => e.type === "shift_completed"),
    ).toEqual([]);
  });
});

describe("resolveShiftStateOnRead (DEC-023 corollary)", () => {
  it("resolves past-horizon exhaustion to AtRisk even when the badge is stale", async () => {
    await seedVesselEvent();
    await formShifts(repo); // persisted: Pending; no crew, past horizon

    expect(await resolveShiftStateOnRead(repo, SHIFT, AFTER)).toBe("AtRisk");
    expect((await repo.getShift(SHIFT))!.state).toBe("Pending"); // untouched
  });

  it("returns null for an unknown shift", async () => {
    expect(
      await resolveShiftStateOnRead(repo, asId<"ShiftId">("nope"), AFTER),
    ).toBeNull();
  });
});

describe("tick — silent-ask sweep (#151, DEC-067)", () => {
  it("expires an unanswered ask past the timeout: stamps it silent + logs ask_ignored", async () => {
    await seedVesselEvent();
    const cap = await addCaptain("cap-1");
    await formShifts(repo);

    // Tick 1 (~39h out, inside fills-by → urgent-blasts the lone captain): seeds the ask.
    await tick(repo, AFTER, { silentTimeoutMinutes: 60 });
    expect(await seatState()).toBe("Asked");

    // cap-1 ghosts. A tick 61 min later — past the 60-min timeout — sweeps the ask.
    const later61 = new Date(AFTER.getTime() + 61 * 60_000);
    await tick(repo, later61, { silentTimeoutMinutes: 60 });

    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const ghost = (await repo.listAsksForSeat(seatId)).find(
      (a) => a.crewMemberId === cap,
    )!;
    expect(ghost.respondedAt).toBeDefined(); // timed out (stamped)
    expect(ghost.response).toBeUndefined(); // silent, not a real response
    const evTypes = (await repo.reliabilityEventsFor(cap)).map((e) => e.type);
    expect(evTypes).toContain("ask_ignored"); // the negative silent signal
  });

  it("leaves an ask still inside the timeout untouched", async () => {
    await seedVesselEvent();
    const cap = await addCaptain("cap-1");
    await formShifts(repo);

    await tick(repo, AFTER, { silentTimeoutMinutes: 120 });
    // 30 min later, well within the 120-min timeout: the ask stays live.
    await tick(repo, new Date(AFTER.getTime() + 30 * 60_000), {
      silentTimeoutMinutes: 120,
    });

    expect(await seatState()).toBe("Asked");
    const evTypes = (await repo.reliabilityEventsFor(cap)).map((e) => e.type);
    expect(evTypes).not.toContain("ask_ignored");
  });

  it("does NOT sweep a FILLED seat — losing broadcast siblings keep a clean record", async () => {
    await seedVesselEvent();
    const a = await addCaptain("cap-1");
    const b = await addCaptain("cap-2");
    await formShifts(repo);

    // Urgent blast at AFTER asks both captains; cap-1 accepts → seat Claimed.
    await tick(repo, AFTER, { silentTimeoutMinutes: 60 });
    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const aAsk = (await repo.listAsksForSeat(seatId)).find(
      (k) => k.crewMemberId === a,
    )!;
    await recordResponse(repo, aAsk.id, "accepted", AFTER);
    expect(await seatState()).toBe("Claimed");

    // A tick well past the timeout: cap-2's losing ask is still live, but the seat
    // is filled, so it is NOT swept — cap-2 is never dinged for not answering.
    await tick(repo, new Date(AFTER.getTime() + 61 * 60_000), {
      silentTimeoutMinutes: 60,
    });
    const bTypes = (await repo.reliabilityEventsFor(b)).map((e) => e.type);
    expect(bTypes).not.toContain("ask_ignored");
  });

  it("reopens a ghosted seat and the SAME tick widens to the next candidate (drip)", async () => {
    // Non-urgent window (post-horizon, pre-fills-by) so the engine drips one at a time.
    const DRIP = new Date("2026-06-26T12:00:00.000Z");
    await seedVesselEvent();
    await addCaptain("cap-1");
    await addCaptain("cap-2");
    await formShifts(repo);

    await tick(repo, DRIP, { silentTimeoutMinutes: 60 }); // seeds ONE top-ranked ask
    const seatId = (await repo.listSeatsForShift(SHIFT))[0]!.id;
    const seeded = await repo.listAsksForSeat(seatId);
    expect(seeded).toHaveLength(1);
    const ghostId = seeded[0]!.crewMemberId;

    // The seeded candidate ghosts. A tick past the timeout expires the ask,
    // reopens the seat, and widens to the OTHER captain — all this same tick.
    const r = await tick(repo, new Date(DRIP.getTime() + 61 * 60_000), {
      silentTimeoutMinutes: 60,
    });
    expect(r.asksFired).toBe(1); // widened to the next candidate this tick

    const asks = await repo.listAsksForSeat(seatId);
    const live = asks.filter((k) => k.respondedAt === undefined);
    expect(live).toHaveLength(1); // one live ask — the fresh candidate
    expect(live[0]!.crewMemberId).not.toBe(ghostId); // a DIFFERENT captain
    const ghost = asks.find((k) => k.crewMemberId === ghostId)!;
    expect(ghost.response).toBeUndefined(); // silent, not a real answer
    expect(ghost.respondedAt).toBeDefined();
  });
});

describe("tick — Tier-1 drip (DEC-063)", () => {
  // Post-horizon (≥ trip−7d = 2026-06-24T19:00Z) but well before fills-by
  // (trip−48h = 2026-06-29T19:00Z), so the tick drips rather than urgent-blasts.
  const DRIP = new Date("2026-06-26T12:00:00.000Z");
  const MIN = 60_000;
  const after = (ms: number) => new Date(DRIP.getTime() + ms);
  const seatId = () => repo.listSeatsForShift(SHIFT).then((s) => s[0]!.id);
  const askCount = async () =>
    (await repo.listAsksForSeat(await seatId())).length;

  async function seededShift(nCrew: number): Promise<void> {
    await seedVesselEvent();
    for (let i = 1; i <= nCrew; i++) await addCaptain(`cap-${i}`);
    await formShifts(repo); // Pending, one Open captain seat
  }

  it("seeds ONE ask (top-ranked), not the whole pool", async () => {
    await seededShift(3);
    const r = await tick(repo, DRIP);
    expect(r.bornFilling).toBe(1);
    expect(r.asksFired).toBe(1); // drip seeds one; blast would be 3
    expect(await askCount()).toBe(1);
    expect(await seatState()).toBe("Asked");
  });

  it("widens by one after the interval, accumulating (default 15m)", async () => {
    await seededShift(3);
    await tick(repo, DRIP); // seed #1
    const early = await tick(repo, after(5 * MIN)); // before interval → no widen
    expect(early.asksFired).toBe(0);
    expect(await askCount()).toBe(1);
    const due = await tick(repo, after(16 * MIN)); // past interval → widen #2
    expect(due.asksFired).toBe(1);
    expect(await askCount()).toBe(2); // accumulated — #1 still open
  });

  it("interval 0 blasts the whole pool (the pre-drip rollback)", async () => {
    await seededShift(3);
    const r = await tick(repo, DRIP, { dripIntervalMinutes: 0 });
    expect(r.asksFired).toBe(3);
    expect(await askCount()).toBe(3);
  });

  it("blasts inside the fills-by deadline, even with a drip interval", async () => {
    await seededShift(3);
    const r = await tick(repo, AFTER); // AFTER is within trip−48h → urgent
    expect(r.asksFired).toBe(3);
    expect(await askCount()).toBe(3);
  });

  it("a decline reopens the seat and widens immediately (no fresh interval wait)", async () => {
    await seededShift(3);
    await tick(repo, DRIP); // seed #1
    const [first] = await repo.listAsksForSeat(await seatId());
    await recordResponse(repo, first!.id, "declined", after(MIN)); // #1 says no
    expect(await seatState()).toBe("Open"); // single ask closed → reopened
    const r = await tick(repo, after(2 * MIN)); // only 2m later, but Open → widen now
    expect(r.asksFired).toBe(1);
    expect(await seatState()).toBe("Asked");
    expect(await askCount()).toBe(2); // #1 (declined) + #2 (fresh)
  });

  it("a pool of one seeds then never widens (nothing to widen to)", async () => {
    await seededShift(1);
    await tick(repo, DRIP); // seed the only candidate
    expect(await askCount()).toBe(1);
    const r = await tick(repo, after(20 * MIN)); // interval passed, no un-asked left
    expect(r.asksFired).toBe(0);
    expect(await askCount()).toBe(1);
  });

  it("two seats drip independently; escalating a walked seat leaves the sibling untouched", async () => {
    // 2-role vessel: a captain seat + a mate seat, distinct pools.
    await repo.saveVessel({
      id: VESSEL,
      name: "X",
      coiMaxPax: 16,
      manning: [
        { roleTypeId: CAPTAIN, count: 1 },
        { roleTypeId: MATE, count: 1 },
      ],
    });
    await repo.saveEvent({
      id: asId<"EventId">("e1"),
      vesselId: VESSEL,
      date: "2026-07-01",
      time: "15:00",
      capacity: 16,
      source: "xola", status: "scheduled",
    });
    await addCaptain("cap-1");
    await addCaptain("cap-2");
    await addMate("mate-1");
    await addMate("mate-2");
    await formShifts(repo);

    const seatRole = async (role: typeof CAPTAIN | typeof MATE) =>
      (await repo.listSeatsForShift(SHIFT)).find((s) => s.role === role)!.id;
    const liveAsk = async (seat: SeatId) =>
      (await repo.listAsksForSeat(seat)).find((a) => a.respondedAt === undefined);

    // Tick 1: each seat seeds ONE ask from its OWN pool — independent drip.
    const r1 = await tick(repo, DRIP);
    expect(r1.asksFired).toBe(2);
    const capSeat = await seatRole(CAPTAIN);
    const mateSeat = await seatRole(MATE);
    expect(await repo.listAsksForSeat(capSeat)).toHaveLength(1);
    expect(await repo.listAsksForSeat(mateSeat)).toHaveLength(1);

    // Walk the captain pool by declines, all within the mate's 15m interval so the
    // mate seat never widens — it sits at its single mid-drip ask the whole time.
    await recordResponse(repo, (await liveAsk(capSeat))!.id, "declined", after(MIN));
    await tick(repo, after(2 * MIN)); // captain seat Open → widen cap-2 (mate not due)
    await recordResponse(repo, (await liveAsk(capSeat))!.id, "declined", after(3 * MIN));

    // Tick: captain pool walked + seat Open → escalate; mate seat is mid-drip Asked.
    const r = await tick(repo, after(4 * MIN));
    expect(r.shiftsEscalated).toBe(1); // the captain seat escalated
    // The mate seat is provably untouched — escalate only acts on Open seats.
    expect(await repo.listAsksForSeat(mateSeat)).toHaveLength(1);
    expect((await repo.getSeat(mateSeat))!.state).toBe("Asked");
  });
});

/**
 * Civil send window (9.9/#235, DEC-088) — outside vessel-local civil hours the
 * engine's own initiative defers; state advance, the DEC-067 sweep, and the
 * next in-window pickup all keep working. Windows injected explicitly (the
 * suite-wide env holds the default wide open); tz pinned UTC so the wall-clock
 * IS the instant.
 */
describe("tick — civil send window (DEC-088)", () => {
  const WINDOW = { start: "08:00", end: "20:00" };
  const NIGHT = new Date("2026-06-30T03:00:00.000Z"); // 03:00 UTC — outside
  const MORNING = new Date("2026-06-30T08:00:00.000Z"); // 08:00 — half-open start: fires
  const CLOSE = new Date("2026-06-30T20:00:00.000Z"); // 20:00 — half-open end: defers
  const civil = { tz: "UTC", civilWindow: WINDOW };

  it("defers sends outside the window but still advances state (Pending → Filling, zero asks)", async () => {
    await seedVesselEvent();
    await addCaptain("cpt-a");
    await formShifts(repo);

    const r = await tick(repo, NIGHT, civil);
    expect(await shiftState()).toBe("Filling"); // the runway is untouched…
    expect(r.asksFired).toBe(0); // …only the sends defer
    expect(r.nudgesFired).toBe(0);
    expect(await seatState()).toBe("Open");
  });

  it("the first in-window tick fires what the night deferred — no queue needed", async () => {
    await seedVesselEvent();
    await addCaptain("cpt-a");
    await formShifts(repo);
    await tick(repo, NIGHT, civil);

    const r = await tick(repo, MORNING, civil);
    expect(r.asksFired).toBe(1); // widenDue is immediate for an Open seat
    expect(await seatState()).toBe("Asked");
  });

  it("boundaries are half-open [start, end): 08:00 fires, 20:00 does not", async () => {
    await seedVesselEvent();
    await addCaptain("cpt-a");
    await formShifts(repo);
    expect((await tick(repo, CLOSE, civil)).asksFired).toBe(0);
    expect((await tick(repo, MORNING, civil)).asksFired).toBe(1);
  });

  it("a bail fires no asks and is re-crewed by the next in-window tick via the drip", async () => {
    await seedVesselEvent();
    const a = await addCaptain("cpt-a");
    await addCaptain("cpt-b");
    await formShifts(repo);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    await manualOverride(repo, seat.id, a, AFTER); // Confirmed

    // 23:00 bail (days before the fills-by deadline): logs + clears, fires NO
    // re-ask → seat rests Open, re-crewing left to the tick (DEC-128 #483).
    const night = new Date("2026-06-25T23:00:00.000Z");
    await bail(repo, seat.id, night, 60_000);
    expect((await repo.getSeat(seat.id))!.state).toBe("Open");
    expect(await repo.listAsksForSeat(seat.id)).toEqual([]);

    const r = await tick(repo, new Date("2026-06-26T08:30:00.000Z"), civil);
    expect(r.asksFired).toBe(1); // one widen — the deferred re-crew rides DEC-063
    const asks = await repo.listAsksForSeat(seat.id);
    // The drip seeds the TOP-ranked candidate: the fresh bail dents cpt-a's
    // score, so cpt-b leads. (An override-placed bailer has no ask history, so
    // their exclusion is score-driven here, not structural — a live inline
    // re-ask pins the exclusion; the deferred path leans on ranking.)
    expect(asks.map((x) => String(x.crewMemberId))).toEqual(["cpt-b"]);
  });

  it("the DEC-067 silent sweep still runs outside the window", async () => {
    await seedVesselEvent();
    await addCaptain("cpt-a");
    await addCaptain("cpt-b");
    await formShifts(repo);
    // Fire in-window, then let the timeout elapse into the night.
    await tick(repo, MORNING, civil);
    const lateNight = new Date("2026-06-30T22:30:00.000Z"); // 2.5h later, outside
    const r = await tick(repo, lateNight, {
      ...civil,
      silentTimeoutMinutes: 120,
    });
    // The unanswered ask expired even though no NEW asks fired this tick:
    // silent = respondedAt stamped with NO response, and the ghost is logged.
    expect(r.asksFired).toBe(0);
    const seat = (await repo.listSeatsForShift(SHIFT))[0]!;
    const asks = await repo.listAsksForSeat(seat.id);
    expect(asks[0]!.respondedAt).toBeDefined();
    expect(asks[0]!.response).toBeUndefined();
    const events = await repo.reliabilityEventsFor(asks[0]!.crewMemberId);
    expect(events.some((e) => e.type === "ask_ignored")).toBe(true);
  });
});

describe("tick — one boat per day: same-day boats spread across people (#393)", () => {
  const V1 = asId<"VesselId">("vessel-1");
  const V2 = asId<"VesselId">("vessel-2");
  // Trip 2026-07-01 15:00Z; horizon −7d = 06-24 15:00; fill deadline −48h =
  // 06-29 15:00. Pick a `now` in the DRIP window (past horizon, before the
  // deadline) + inside civil hours — the urgent blast bypasses the exclusion.
  const DRIP = new Date("2026-06-26T16:00:00.000Z"); // noon EDT

  async function seedTwoBoatsSameDay(): Promise<void> {
    for (const [v, e] of [
      [V1, "ev-1"],
      [V2, "ev-2"],
    ] as const) {
      await repo.saveVessel({
        id: v,
        name: v,
        coiMaxPax: 16,
        manning: [{ roleTypeId: CAPTAIN, count: 1 }],
      });
      await repo.saveEvent({
        id: asId<"EventId">(e),
        vesselId: v,
        date: "2026-07-01",
        time: "15:00",
        capacity: 16,
        source: "xola",
        status: "scheduled",
      });
    }
    await formShifts(repo); // one Pending captain-seat shift per boat
  }

  it("two boats on one day seed two different captains, not the top one twice", async () => {
    await seedTwoBoatsSameDay();
    await addCaptain("cap-hi", { reliabilityScore: 0.9 });
    await addCaptain("cap-lo", { reliabilityScore: 0.1 });

    const r = await tick(repo, DRIP);

    // One seed per boat, but the second boat can't re-seed the first boat's
    // captain (one boat per day) → the two asks land on two different people.
    expect(r.firedAsks).toHaveLength(2);
    expect(new Set(r.firedAsks.map((a) => a.crewMemberId)).size).toBe(2);
  });

  it("a lone captain still gets asked for one of the two same-day boats (no starvation)", async () => {
    await seedTwoBoatsSameDay();
    await addCaptain("cap-only", { reliabilityScore: 0.5 });

    const r = await tick(repo, DRIP);

    // Only one captain exists: one boat seeds them, the other finds the pool
    // same-day-excluded and simply doesn't seed this tick (it isn't starved of a
    // real candidate — there just isn't a second distinct person to spread to).
    expect(r.firedAsks).toHaveLength(1);
  });

  it("a losing broadcast sibling on a FILLED same-day boat stays eligible for another boat's drip", async () => {
    await seedTwoBoatsSameDay();
    const capX = await addCaptain("cap-x", { reliabilityScore: 0.9 });
    const capY = await addCaptain("cap-y", { reliabilityScore: 0.5 });

    const shifts = await repo.listShifts();
    const boatA = shifts[0]!;
    const boatB = shifts[1]!;
    const seatA = (await repo.listSeatsForShift(boatA.id))[0]!;
    const seatB = (await repo.listSeatsForShift(boatB.id))[0]!;

    // Boat A is filled by capY; capX holds a LOSING sibling ask on it (no
    // respondedAt, never swept on a filled seat). capX lost — they're free.
    await repo.saveShift({ ...boatA, state: "Filling" });
    await repo.saveSeat({ ...seatA, state: "Claimed", assignedCrewMemberId: capY });
    await repo.saveAsk({
      id: asId<"AskId">("losing-x"),
      seatId: seatA.id,
      crewMemberId: capX,
      channel: "push",
      sentAt: DRIP.toISOString(),
    });

    await tick(repo, DRIP);

    // The filled Boat A must NOT reserve capX — Boat B's drip can still seed them.
    // (Pre-fix, capX's stale losing ask kept them out of every same-day boat.)
    const seatBAsks = await repo.listAsksForSeat(seatB.id);
    expect(seatBAsks.map((a) => a.crewMemberId)).toContain(capX);
  });
});
