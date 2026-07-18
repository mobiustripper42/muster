/**
 * Repo-backed oracle — eligible pool + composite shared-pool solve
 * (§1.3, DEC-003). The headline test is the false-yes DEC-003 warns about.
 * (Task 1.4a / M3.)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type {
  CrewMemberId,
  RoleTypeId,
  SeatId,
  ShiftId,
  VesselId,
} from "../domain/ids.js";
import type {
  Credential,
  CrewMember,
  Seat,
  Shift,
} from "../domain/entities.js";
import type { SeatState } from "../domain/states.js";
import { committedDatesByCrew, eligiblePool, solveShift } from "./oracle.js";
import { logShiftCompleted } from "./reliability-log.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const DATE = "2026-07-01";
const NOW = new Date("2026-06-15T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(
  id: string,
  over: Partial<CrewMember> = {},
  mmcExpiry: string | null = "2026-12-31",
): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  const crew: CrewMember = {
    id: crewId,
    name: id,
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
    ...over,
  };
  await repo.saveCrewMember(crew);
  if (mmcExpiry) {
    const cred: Credential = {
      id: asId<"CredentialId">(`cred-${id}`),
      crewMemberId: crewId,
      type: "MMC",
      expiry: mmcExpiry,
    };
    await repo.saveCredential(cred);
  }
  return crewId;
}

async function addShift(
  shiftId: string,
  captainSeats: number,
  date = DATE,
): Promise<{ shiftId: ShiftId; seatIds: SeatId[] }> {
  const id = asId<"ShiftId">(shiftId);
  const shift: Shift = {
    id,
    vesselId: VESSEL,
    date,
    state: "Pending",
    eventIds: [],
  };
  await repo.saveShift(shift);
  const seatIds: SeatId[] = [];
  for (let i = 1; i <= captainSeats; i++) {
    const seatId = asId<"SeatId">(`seat-${shiftId}-cap-${i}`);
    const seat: Seat = {
      id: seatId,
      shiftId: id,
      role: CAPTAIN,
      kind: "required",
      state: "Open",
    };
    await repo.saveSeat(seat);
    seatIds.push(seatId);
  }
  return { shiftId: id, seatIds };
}

/** Pin a crew member to a seat in a committed state (for double-booking setup). */
async function assign(
  seatId: SeatId,
  crewId: CrewMemberId,
  state: SeatState = "Confirmed",
): Promise<void> {
  const seat = await repo.getSeat(seatId);
  if (!seat) throw new Error("no seat");
  await repo.saveSeat({ ...seat, state, assignedCrewMemberId: crewId });
}

describe("eligiblePool", () => {
  it("returns the eligible crew per required seat, plus every verdict", async () => {
    const a = await addCrew("crew-a");
    await addCrew("crew-b", { status: "inactive" });
    const { shiftId } = await addShift("shift-1", 1);

    const pools = await eligiblePool(repo, shiftId);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.eligible).toEqual([a]);
    // Both crew get a verdict — the inactive one with its failure reason.
    expect(pools[0]!.verdicts).toHaveLength(2);
    const b = pools[0]!.verdicts.find((v) => !v.eligible)!;
    expect(b.failures.map((f) => f.ruleId)).toContain("is_active");
  });

  it("ignores supernumerary seats (they don't gate Crewed — DEC-005)", async () => {
    await addCrew("crew-a");
    const { shiftId, seatIds } = await addShift("shift-1", 1);
    const sup = await repo.getSeat(seatIds[0]!);
    await repo.saveSeat({
      ...sup!,
      id: asId<"SeatId">("seat-sup"),
      kind: "supernumerary",
    });
    const pools = await eligiblePool(repo, shiftId);
    expect(pools.map((p) => p.seatId)).toEqual([seatIds[0]]); // sup excluded
  });
});

describe("solveShift — the composite shared-pool rule (DEC-003)", () => {
  it("avoids the false yes: A is current-but-booked, B is free-but-lapsed", async () => {
    // The exact trap DEC-003 names. Naive independent booleans over the pool say
    // "an MMC-valid captain exists" AND "a free captain exists" → yes. But they
    // are DIFFERENT people; no single person satisfies all rules.
    const a = await addCrew("crew-a"); // valid MMC...
    const b = await addCrew("crew-b", {}, "2025-01-01"); // ...lapsed MMC

    // Book A elsewhere the same day → A is double-booked.
    const other = await addShift("shift-other", 1);
    await assign(other.seatIds[0]!, a);

    const { shiftId } = await addShift("shift-1", 1);
    const sol = await solveShift(repo, shiftId, NOW);

    expect(sol.satisfiable).toBe(false);
    expect(sol.assignment).toBeNull();
    // And the per-seat pool explains why each candidate failed.
    const verdicts = sol.pools[0]!.verdicts;
    expect(verdicts.find((v) => v.crewMemberId === a)!.failures.map((f) => f.ruleId))
      .toContain("not_double_booked");
    expect(verdicts.find((v) => v.crewMemberId === b)!.failures.map((f) => f.ruleId))
      .toContain("mmc_valid_on_date");
  });

  it("shares the pool: one eligible captain can't fill two captain seats", async () => {
    await addCrew("crew-a");
    const { shiftId, seatIds } = await addShift("shift-1", 2);
    const sol = await solveShift(repo, shiftId, NOW);
    expect(sol.satisfiable).toBe(false); // second seat starved
    // First seat still got the assignment in the (failed) walk's record.
    expect(sol.pools).toHaveLength(2);
    expect(sol.pools[0]!.eligible).toHaveLength(1);
    expect(sol.pools[1]!.eligible).toHaveLength(1);
    void seatIds;
  });

  it("crews a shift when distinct eligible people cover every seat", async () => {
    const a = await addCrew("crew-a");
    const b = await addCrew("crew-b");
    const { shiftId, seatIds } = await addShift("shift-1", 2);
    const sol = await solveShift(repo, shiftId, NOW);
    expect(sol.satisfiable).toBe(true);
    expect(sol.assignment).not.toBeNull();
    const assigned = [...sol.assignment!.values()].sort();
    expect(assigned).toEqual([a, b].sort());
    expect(new Set(sol.assignment!.keys())).toEqual(new Set(seatIds));
  });

  it("a same-day ASKED seat does not double-book (only Claimed/Confirmed do)", async () => {
    const a = await addCrew("crew-a");
    const other = await addShift("shift-other", 1);
    await assign(other.seatIds[0]!, a, "Asked"); // tentative, may decline
    const { shiftId } = await addShift("shift-1", 1);
    const sol = await solveShift(repo, shiftId, NOW);
    expect(sol.satisfiable).toBe(true);
  });

  it("is vacuously satisfiable for a zero-required-seat shift", async () => {
    const { shiftId } = await addShift("shift-1", 0);
    const sol = await solveShift(repo, shiftId, NOW);
    expect(sol.satisfiable).toBe(true);
    expect(sol.assignment!.size).toBe(0);
  });

  it("the greedy walk is reliability-ordered: the more reliable wins the seat", async () => {
    await addCrew("crew-a");
    const b = await addCrew("crew-b");
    // b has a proven record, a has none → b should take the single seat.
    await logShiftCompleted(repo, b, asId<"ShiftId">("past"), NOW);
    const { shiftId, seatIds } = await addShift("shift-1", 1);
    const sol = await solveShift(repo, shiftId, NOW);
    expect(sol.satisfiable).toBe(true);
    expect(sol.assignment!.get(seatIds[0]!)).toBe(b);
  });
});

describe("committedDatesByCrew — a Cancelled shift is not a commitment", () => {
  it("skips a Confirmed seat on a Cancelled shift, so its dropped crew stay free", async () => {
    // The bug: a boat reassignment cancels the old vessel-day but KEEPS its seats
    // (for resurrection). The crew member the cancel dropped still carries a
    // Confirmed seat on the dead shift — counting it read them as double-booked on
    // that date and barred them from the replacement shift they were moved to.
    const eric = await addCrew("crew-eric");
    const { shiftId, seatIds } = await addShift("shift-brew-4", 1, DATE);
    await assign(seatIds[0]!, eric, "Confirmed");
    const shift = await repo.getShift(shiftId);
    await repo.saveShift({ ...shift!, state: "Cancelled" });

    const committed = await committedDatesByCrew(repo);
    expect(committed.get(eric)?.has(DATE) ?? false).toBe(false);
  });

  it("still counts a Confirmed seat on a live (non-cancelled) shift", async () => {
    const eric = await addCrew("crew-eric");
    const { seatIds } = await addShift("shift-brew-1", 1, DATE); // born Pending
    await assign(seatIds[0]!, eric, "Confirmed");

    const committed = await committedDatesByCrew(repo);
    expect(committed.get(eric)?.has(DATE)).toBe(true);
  });

  it("end to end: the only captain, cancelled off one boat, can still crew the replacement", async () => {
    // The user's exact case: both trips move Brew 4 → Brew 1; the Brew 4 shift
    // cancels (keeping Eric's Confirmed seat), a Brew 1 shift forms. Eric is the
    // lone captain — before the fix his stale Brew 4 seat double-booked him out of
    // Brew 1, leaving it unsolvable.
    const eric = await addCrew("crew-eric");
    const brew4 = await addShift("shift-brew-4", 1, DATE);
    await assign(brew4.seatIds[0]!, eric, "Confirmed");
    await repo.saveShift({ ...(await repo.getShift(brew4.shiftId))!, state: "Cancelled" });

    const brew1 = await addShift("shift-brew-1", 1, DATE);
    const sol = await solveShift(repo, brew1.shiftId, NOW);
    expect(sol.satisfiable).toBe(true);
    expect(sol.assignment!.get(brew1.seatIds[0]!)).toBe(eric);
  });
});
