/**
 * The engine tick — horizon-driven shift advance + Tier-1 kick (DEC-022/023).
 * (Task 3.1a / Phase 3.)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { CrewMember, Event, Shift, Vessel } from "../domain/entities.js";
import { formShifts } from "./form-shifts.js";
import { tick } from "./tick.js";
import {
  confirmSeat,
  expireAsks,
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
    status: "scheduled",
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
      status: "scheduled",
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
      status: "scheduled",
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
    expect(await seatState()).toBe("Asked"); // direct-nudged
    expect(await shiftState()).toBe("Filling"); // still autonomous, no Spink
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

  it("a worked or crewed shift never lands", async () => {
    await seedVesselEvent();
    await addCaptain("cap-1");
    await formShifts(repo);

    const r1 = await tick(repo, AFTER); // born Filling, live ask out
    expect(r1.boardLanded).toBe(0);

    const asks = await repo.listAsksForSeat(
      (await repo.listSeatsForShift(SHIFT))[0]!.id,
    );
    await recordResponse(repo, asks[0]!.id, "accepted", AFTER);
    await confirmSeat(repo, (await repo.listSeatsForShift(SHIFT))[0]!.id, AFTER);

    const r2 = await tick(repo, AFTER); // Crewed and healthy
    expect(r2.boardLanded).toBe(0);
  });
});
