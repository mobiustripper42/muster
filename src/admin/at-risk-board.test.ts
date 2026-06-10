/**
 * At-Risk board derivation (#41, SPEC §2.5, DEC-025).
 *
 * Ordering tests are ORDINAL by design (the @architect pass): they assert who
 * sorts above whom (sooner beats later; regression beats never-filled at
 * similar time-to-trip; thinner pool beats deeper), never exact scores — so
 * tuning the urgency weights later doesn't shatter the suite.
 *
 * Some scenarios seed seat states directly (e.g. a resting `Bailed` seat —
 * occupant cleared, matching what `bail()` actually leaves behind) rather than
 * driving the full ask loop — this suite tests the pure read-model over
 * states, not loop reachability (escalate/bail have their own suites).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId, VesselId } from "../domain/ids.js";
import type {
  Credential,
  CrewMember,
  Event,
  Seat,
  Shift,
} from "../domain/entities.js";
import type { SeatState, ShiftState } from "../domain/states.js";
import { broadcastAsk, expireAsks, recordResponse } from "../asks/ask-loop.js";
import { logShiftBailed } from "../oracle/reliability-log.js";
import { deriveAtRiskBoard, EXHAUSTED_THRESHOLD_HOURS } from "./at-risk-board.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

/** The board's "now" for every scenario. */
const T0 = new Date("2026-07-01T12:00:00.000Z");
const hoursAfterT0 = (h: number) => new Date(T0.getTime() + h * 3600_000);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(
  id: string,
  over: Partial<CrewMember> = {},
  mmcExpiry = "2026-12-31",
): Promise<CrewMemberId> {
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
    expiry: mmcExpiry,
  };
  await repo.saveCredential(cred);
  return crewId;
}

interface SeatSpec {
  role?: typeof CAPTAIN | typeof MATE;
  state?: SeatState;
  assigned?: CrewMemberId;
}

/**
 * One shift + its event (departing `tripAt`) + required seats. The event makes
 * the horizon and trip-start real; lead is the default 7 days, so every trip
 * inside a week is past its horizon at T0.
 */
async function addShift(
  id: string,
  tripAt: Date,
  seatSpecs: SeatSpec[],
  state: ShiftState = "Filling",
): Promise<{ shiftId: ShiftId; seatIds: SeatId[] }> {
  const shiftId = asId<"ShiftId">(id);
  const vesselId = asId<"VesselId">(`vessel-${id}`);
  const date = tripAt.toISOString().slice(0, 10);
  const eventId = asId<"EventId">(`event-${id}`);
  const event: Event = {
    id: eventId,
    vesselId,
    date,
    time: tripAt.toISOString().slice(11, 16),
    capacity: 6,
    status: "scheduled",
  };
  await repo.saveEvent(event);
  const shift: Shift = { id: shiftId, vesselId, date, state, eventIds: [eventId] };
  await repo.saveShift(shift);
  const seatIds: SeatId[] = [];
  for (const [i, spec] of seatSpecs.entries()) {
    const seatId = asId<"SeatId">(`seat-${id}-${i + 1}`);
    const seat: Seat = {
      id: seatId,
      shiftId,
      role: spec.role ?? CAPTAIN,
      kind: "required",
      state: spec.state ?? "Open",
      ...(spec.assigned ? { assignedCrewMemberId: spec.assigned } : {}),
    };
    await repo.saveSeat(seat);
    seatIds.push(seatId);
  }
  return { shiftId, seatIds };
}

/** Broadcast a seat at T0, then have every recipient decline. */
async function broadcastAllDecline(seatId: SeatId): Promise<number> {
  const asks = await broadcastAsk(repo, seatId, T0);
  for (const ask of asks) await recordResponse(repo, ask.id, "declined", T0);
  return asks.length;
}

describe("membership — core (willingness-exhaustion)", () => {
  it("boards a still-short shift whose whole pool declined, trip inside the threshold", async () => {
    await addCrew("ann");
    await addCrew("bob");
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(24), [{}]);
    const asked = await broadcastAllDecline(seatIds[0]!);
    expect(asked).toBe(2);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const row = rows[0]!;
    expect(row.reasons).toEqual(["core"]);
    expect(row.resolvedState).toBe("Filling"); // eligibility ≠ willingness
    expect(row.trail.asked).toBe(2);
    expect(row.trail.declined).toBe(2);
    expect(row.gaps).toEqual([{ role: CAPTAIN, missing: 1 }]);
  });

  it("boards on all-silent the same as all-declined (the ghosted broadcast)", async () => {
    await addCrew("ann");
    const { seatIds } = await addShift("w2", hoursAfterT0(24), [{}]);
    await broadcastAsk(repo, seatIds[0]!, T0);
    await expireAsks(repo, seatIds[0]!, hoursAfterT0(12), 3600_000);

    const rows = await deriveAtRiskBoard(repo, hoursAfterT0(12));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trail.silent).toBe(1);
    expect(rows[0]!.reasons).toEqual(["core"]);
  });

  it("does NOT board while an ask is live — the shift is still being worked", async () => {
    await addCrew("ann");
    const { seatIds } = await addShift("w3", hoursAfterT0(24), [{}]);
    await broadcastAsk(repo, seatIds[0]!, T0);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });

  it("does NOT board a willingness-exhausted shift whose trip is still far out", async () => {
    await addCrew("ann");
    const farOut = hoursAfterT0(EXHAUSTED_THRESHOLD_HOURS + 100);
    const { seatIds } = await addShift("w4", farOut, [{}]);
    await broadcastAllDecline(seatIds[0]!);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });

  it("boards at exactly the threshold — the deadline bound is inclusive", async () => {
    await addCrew("ann");
    const atBound = hoursAfterT0(EXHAUSTED_THRESHOLD_HOURS);
    const { shiftId, seatIds } = await addShift("w6", atBound, [{}]);
    await broadcastAllDecline(seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
  });

  it("does NOT board a never-asked shift inside the threshold (Tier-1's job, not Spink's)", async () => {
    await addCrew("ann");
    await addShift("w5", hoursAfterT0(24), [{}]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("membership — core (eligibility-exhaustion, no threshold)", () => {
  it("boards an unfillable shift even days out — the engine already declared it", async () => {
    // Only crew is mate-rated; the captain seat has an empty pool. Trip is 6
    // days out (past horizon, way outside the 48h willingness threshold).
    await addCrew("mia", { ratings: [MATE] });
    const { shiftId } = await addShift("e1", hoursAfterT0(6 * 24), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.resolvedState).toBe("AtRisk");
    expect(rows[0]!.reasons).toEqual(["core"]);
    expect(rows[0]!.trail.exhausted).toBe(true);
  });

  it("boards the empty-pool-from-birth shift (no takers at all, asked === 0)", async () => {
    const { shiftId } = await addShift("e2", hoursAfterT0(24), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.trail.asked).toBe(0);
    expect(rows[0]!.available).toEqual([]);
  });

  it("does NOT board a pre-horizon shift — crew rules abstain before the horizon", async () => {
    // Trip 10 days out with the default 7-day lead: horizon not reached, the
    // shift resolves Pending even though its pool is empty today.
    await addShift("e3", hoursAfterT0(10 * 24), [{}]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("membership — regression and credential-lapse", () => {
  it("flags a rested-Bailed seat as regression (and core, via resolved AtRisk)", async () => {
    await addCrew("ghost");
    const { shiftId } = await addShift("r1", hoursAfterT0(24), [
      { state: "Bailed" },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toContain("regression");
    expect(rows[0]!.resolvedState).toBe("AtRisk");
  });

  it("flags a credential lapse on a Claimed (yes, unconfirmed) occupant too", async () => {
    const lapsing = await addCrew("lapsing2", {}, "2026-07-02"); // trip is 07-04
    const { shiftId } = await addShift("c3", hoursAfterT0(3 * 24), [
      { state: "Claimed", assigned: lapsing },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toContain("credential_lapse");
  });

  it("flags a fully-Crewed shift whose confirmed captain's MMC lapses before the trip", async () => {
    const lapsing = await addCrew("lapsing", {}, "2026-07-02"); // trip is 07-04
    const { shiftId } = await addShift("c1", hoursAfterT0(3 * 24), [
      { state: "Confirmed", assigned: lapsing },
    ]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.reasons).toEqual(["credential_lapse"]);
    expect(rows[0]!.resolvedState).toBe("Crewed");
    expect(rows[0]!.gaps).toEqual([]); // nothing to fill — the body is the problem
  });

  it("does NOT board a healthy fully-Crewed shift", async () => {
    const solid = await addCrew("solid");
    await addShift("c2", hoursAfterT0(24), [
      { state: "Confirmed", assigned: solid },
    ]);

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });

  it("ignores Cancelled and Completed shifts entirely", async () => {
    await addCrew("ghost2");
    await addShift("x1", hoursAfterT0(24), [{ state: "Bailed" }], "Cancelled");
    await addShift("x2", hoursAfterT0(24), [{ state: "Bailed" }], "Completed");

    expect(await deriveAtRiskBoard(repo, T0)).toEqual([]);
  });
});

describe("urgency ordering (ordinal — SPEC §2.5 acceptance criteria)", () => {
  it("sooner trip beats later trip", async () => {
    const a = await addShift("soon", hoursAfterT0(12), [{}]);
    const b = await addShift("later", hoursAfterT0(40), [{}]);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([a.shiftId, b.shiftId]);
  });

  it("regression beats a never-filled shift at similar time-to-trip", async () => {
    await addCrew("ghost3");
    const bailed = await addShift("bailed", hoursAfterT0(28), [
      { state: "Bailed" },
    ]);
    // Never-filled core row slightly SOONER — regression must still outrank.
    await addCrew("ann");
    const never = await addShift("never", hoursAfterT0(24), [{}]);
    await broadcastAllDecline(never.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([bailed.shiftId, never.shiftId]);
  });

  it("a regression days out does NOT bury a trip leaving in hours", async () => {
    await addCrew("ghost4");
    const bailedFar = await addShift("bailedfar", hoursAfterT0(6 * 24), [
      { state: "Bailed" },
    ]);
    await addCrew("ann2");
    const leavingNow = await addShift("leavingnow", hoursAfterT0(3), [{}]);
    await broadcastAllDecline(leavingNow.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([
      leavingNow.shiftId,
      bailedFar.shiftId,
    ]);
  });

  it("thinner pool beats deeper pool at the same time-to-trip — DEC-025: thinness, not role names", async () => {
    // The THIN pool is the MATE seat (1 candidate) and the deep one the CAPTAIN
    // seat (3 candidates): if urgency branched on the role name instead of the
    // pool, this ordering would flip.
    await addCrew("solo-mate", { ratings: [MATE] });
    const thin = await addShift("thinmate", hoursAfterT0(24), [{ role: MATE }]);
    await broadcastAllDecline(thin.seatIds[0]!);

    await addCrew("cap1");
    await addCrew("cap2");
    await addCrew("cap3");
    const deep = await addShift("deepcap", hoursAfterT0(24), [{ role: CAPTAIN }]);
    await broadcastAllDecline(deep.seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([thin.shiftId, deep.shiftId]);
  });
});

describe("the available list (the lean's targets)", () => {
  it("lists the gap seats' eligible pool, minus anyone committed on the shift", async () => {
    const held = await addCrew("held");
    await addCrew("free1");
    await addCrew("free2");
    // Two captain seats: `held` confirmed on the first, second still open and
    // ghosted — `held` must not be offered for the seat next to their own.
    const { shiftId, seatIds } = await addShift("a1", hoursAfterT0(24), [
      { state: "Confirmed", assigned: held },
      {},
    ]);
    await broadcastAllDecline(seatIds[1]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const available = rows[0]!.available;
    expect(available).toHaveLength(2);
    expect(available).not.toContain(held);
    expect(rows[0]!.gaps).toEqual([{ role: CAPTAIN, missing: 1 }]);
  });

  it("excludes whoever bailed on this shift — matching the re-ask's own exclusion", async () => {
    const bailer = await addCrew("bailer");
    const sub = await addCrew("sub");
    const { shiftId, seatIds } = await addShift("a2", hoursAfterT0(24), [
      { state: "Bailed" },
    ]);
    await logShiftBailed(repo, bailer, shiftId, T0, 1000, seatIds[0]!);

    const rows = await deriveAtRiskBoard(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.available).toEqual([sub]);
  });
});
