/**
 * Warming derivation (#55, DEC-027 §3) — the deliberately-opened "weather"
 * view. The headline assertions: a live ask NEVER warms a shift (fresh
 * broadcast ≠ trending toward risk), and membership is the candidate predicate
 * minus the REAL board (single-sourced, DEC-026) — never a re-approximation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Credential, CrewMember, Event, Seat, Shift } from "../domain/entities.js";
import type { SeatState, ShiftState } from "../domain/states.js";
import { broadcastAsk, expireAsks, recordResponse } from "../asks/ask-loop.js";
import { deriveAtRiskBoard } from "./at-risk-board.js";
import { deriveWarming } from "./warming.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");

/** Every scenario's "now". */
const T0 = new Date("2026-07-01T12:00:00.000Z");
const hoursAfterT0 = (h: number) => new Date(T0.getTime() + h * 3600_000);

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function addCrew(
  id: string,
  over: Partial<CrewMember> = {},
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
    expiry: "2026-12-31",
  };
  await repo.saveCredential(cred);
  return crewId;
}

/** One shift + its event departing `tripAt` + required captain seats. */
async function addShift(
  id: string,
  tripAt: Date,
  seatStates: SeatState[],
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
    source: "xola", status: "scheduled",
  };
  await repo.saveEvent(event);
  const shift: Shift = { id: shiftId, vesselId, date, state, eventIds: [eventId] };
  await repo.saveShift(shift);
  const seatIds: SeatId[] = [];
  for (const [i, s] of seatStates.entries()) {
    const seat: Seat = {
      id: asId<"SeatId">(`seat-${id}-${i + 1}`),
      shiftId,
      role: CAPTAIN,
      kind: "required",
      state: s,
    };
    await repo.saveSeat(seat);
    seatIds.push(seat.id);
  }
  return { shiftId, seatIds };
}

describe("warming membership — negative signals only", () => {
  it("a fresh broadcast (live asks) does NOT warm — the system is working", async () => {
    await addCrew("ann");
    await addCrew("bob");
    const { seatIds } = await addShift("w1", hoursAfterT0(72), ["Open"]);
    await broadcastAsk(repo, seatIds[0]!, T0); // both asks live

    expect(await deriveWarming(repo, T0)).toHaveLength(0);
  });

  it("an unasked open shift past horizon does NOT warm (no signal, no anxiety)", async () => {
    await addCrew("ann");
    await addShift("w1", hoursAfterT0(72), ["Open"]);
    expect(await deriveWarming(repo, T0)).toHaveLength(0);
  });

  it("a ghost (silent ask) on a still-open seat warms — with the rate fact", async () => {
    const ann = await addCrew("ann");
    const bob = await addCrew("bob");
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(72), ["Open"]);
    const asks = await broadcastAsk(repo, seatIds[0]!, T0);
    const annAsk = asks.find((a) => a.crewMemberId === ann)!;
    await recordResponse(repo, annAsk.id, "declined", T0);
    await expireAsks(repo, seatIds[0]!, hoursAfterT0(6), 3600_000); // bob silent

    const rows = await deriveWarming(repo, hoursAfterT0(6));
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    const row = rows[0]!;
    expect(row.trail.silent).toBe(1);
    expect(row.responseRate).toBe(0.5); // 1 answered of 2 settled
    expect(row.unfilledSeats).toBe(1);
    void bob;
  });

  it("a filled seat's withdrawn losers do NOT warm a shift whose other seat was never asked (#600)", async () => {
    // Regression from #600, found in review. `escalationTrailFor` sums across ALL
    // required seats, and a withdrawn ask counts toward `asked` but not `pending` —
    // so the whole-shift trail read `asked > 0 && pending === 0` and false-positived
    // as "quiet" ("everyone answered and we're still short") when seat 2 had simply
    // never been tried. Before #600 the losing asks stayed live forever, so `pending`
    // was never 0 in this shape and the bug was unreachable.
    const ann = await addCrew("ann");
    await addCrew("bob");
    const { seatIds } = await addShift("w1", hoursAfterT0(72), ["Open", "Open"]);
    // Seat 1: broadcast, Ann accepts → Bob's ask is withdrawn. Seat 1 is now filled.
    const asks = await broadcastAsk(repo, seatIds[0]!, T0);
    const annAsk = asks.find((a) => a.crewMemberId === ann)!;
    await recordResponse(repo, annAsk.id, "accepted", T0);
    // Seat 2 stays Open and has NEVER been asked — the drip's job, not the operator's.

    expect(await deriveWarming(repo, hoursAfterT0(1))).toHaveLength(0);
  });

  it("all-declined far out warms (the board's quiet zone, surfaced as weather)", async () => {
    const ann = await addCrew("ann");
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(120), ["Open"]);
    const [ask] = await broadcastAsk(repo, seatIds[0]!, T0);
    await recordResponse(repo, ask!.id, "declined", T0);

    const rows = await deriveWarming(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(rows[0]!.responseRate).toBe(1); // they answered — just all 'no'
    void ann;
  });
});

describe("warming = candidate predicate MINUS the real board", () => {
  it("the same all-declined shift inside the summon threshold is the board's, not warming's", async () => {
    await addCrew("ann");
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(24), ["Open"]);
    const [ask] = await broadcastAsk(repo, seatIds[0]!, T0);
    await recordResponse(repo, ask!.id, "declined", T0);

    const board = await deriveAtRiskBoard(repo, T0);
    expect(board.map((r) => r.shiftId)).toEqual([shiftId]); // board claims it
    expect(await deriveWarming(repo, T0)).toHaveLength(0); // so warming doesn't
  });

  it("an eligibility-exhausted shift is the board's at any distance — never warming", async () => {
    // No crew at all → oracle exhausted → resolves AtRisk → board route (a).
    const { shiftId, seatIds } = await addShift("w1", hoursAfterT0(120), ["Open"]);
    // One silent ask would otherwise be a warming signal; seed it via a crew
    // member who then vanishes from eligibility (rating removed).
    const ann = await addCrew("ann");
    await broadcastAsk(repo, seatIds[0]!, T0);
    await expireAsks(repo, seatIds[0]!, hoursAfterT0(2), 3600_000);
    await repo.saveCrewMember({
      id: ann,
      name: "ann",
      phone: "555",
      ratings: [],
      status: "active",
      reliabilityScore: null,
    });

    const board = await deriveAtRiskBoard(repo, hoursAfterT0(3));
    expect(board.map((r) => r.shiftId)).toEqual([shiftId]);
    expect(await deriveWarming(repo, hoursAfterT0(3))).toHaveLength(0);
  });
});

describe("warming candidate bounds", () => {
  it("pre-horizon and departed shifts never warm; nor do filled ones", async () => {
    const ann = await addCrew("ann");
    // Pre-horizon: trip 10 days out (> 7d lead) with a silent ask.
    const pre = await addShift("pre", hoursAfterT0(240), ["Open"]);
    await broadcastAsk(repo, pre.seatIds[0]!, T0);
    await expireAsks(repo, pre.seatIds[0]!, hoursAfterT0(2), 3600_000);
    // Filled: ghost history but every seat Confirmed.
    await addShift("done", hoursAfterT0(48), ["Confirmed"]);

    const rows = await deriveWarming(repo, hoursAfterT0(2));
    expect(rows).toHaveLength(0);
    void ann;
  });

  it("sorts soonest trip first", async () => {
    await addCrew("ann");
    const far = await addShift("far", hoursAfterT0(130), ["Open"]);
    const near = await addShift("near", hoursAfterT0(100), ["Open"]);
    for (const s of [far, near]) {
      const [ask] = await broadcastAsk(repo, s.seatIds[0]!, T0);
      await recordResponse(repo, ask!.id, "declined", T0);
    }
    const rows = await deriveWarming(repo, T0);
    expect(rows.map((r) => r.shiftId)).toEqual([near.shiftId, far.shiftId]);
  });
});
