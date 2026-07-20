/**
 * assignFromPool (#54, DEC-027 §1) — the cockpit's guarded per-seat assign.
 * Same accept set as `lean()` (shared guards), but seat-specific and with NO
 * nudge log — a plain assign is the captain-flow entry, not an escalation.
 * `manualOverride` stays the only unguarded path.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import type { SeatState, ShiftState } from "../domain/states.js";
import { broadcastAsk, bail, confirmSeat, recordResponse } from "./ask-loop.js";
import { assignFromPool } from "./lean.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const SHIFT = asId<"ShiftId">("shift-1");
const DATE = "2026-07-01";
const T0 = new Date("2026-06-28T12:00:00.000Z");

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
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: "2026-12-31",
  });
  return crewId;
}

async function addShift(
  seatStates: SeatState[],
  state: ShiftState = "Filling",
): Promise<SeatId[]> {
  const shift: Shift = {
    id: SHIFT,
    vesselId: VESSEL,
    date: DATE,
    state,
    eventIds: [],
  };
  await repo.saveShift(shift);
  const ids: SeatId[] = [];
  for (const [i, s] of seatStates.entries()) {
    const seatId = asId<"SeatId">(`seat-${i + 1}`);
    const seat: Seat = {
      id: seatId,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "required",
      state: s,
    };
    await repo.saveSeat(seat);
    ids.push(seatId);
  }
  return ids;
}

const nudgesFor = async (id: CrewMemberId) =>
  (await repo.reliabilityEventsFor(id)).filter((e) => e.type === "nudged");

describe("assignFromPool — happy path", () => {
  it("asks the named person into THIS seat, no nudge logged", async () => {
    const bob = await addCrew("bob");
    const [seatId] = await addShift(["Open"]);

    const out = await assignFromPool(repo, seatId!, bob, T0);

    expect(out).toMatchObject({ error: null, seatId });
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
    const asks = await repo.listAsksForSeat(seatId!);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.crewMemberId).toBe(bob);
    // The fired ask is surfaced for the edge's channel forwarding (DEC-030).
    expect(out.ask).toEqual(asks[0]);
    expect(await nudgesFor(bob)).toHaveLength(0); // assign ≠ escalation
  });

  it("reopens a legacy resting-Bailed seat on the way in (lean's own move)", async () => {
    const [seatId] = await addShift(["Open"]);
    // DEC-128 (#483) retired `Bailed` as a live outcome (bail() now rests Open);
    // seed a legacy resting-Bailed seat directly — assignFromPool must still reopen it.
    const seat = (await repo.getSeat(seatId!))!;
    await repo.saveSeat({ ...seat, state: "Bailed" });
    expect((await repo.getSeat(seatId!))!.state).toBe("Bailed");

    const bob = await addCrew("bob"); // a target now exists
    const out = await assignFromPool(repo, seatId!, bob, T0);

    expect(out.error).toBeNull();
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
  });

  it("a decliner stays assignable — naming a 'no' is Spink's call", async () => {
    const bob = await addCrew("bob");
    const [seatId] = await addShift(["Open"]);
    const [ask] = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, ask!.id, "declined", T0); // seat reopens

    const out = await assignFromPool(repo, seatId!, bob, T0);
    expect(out.error).toBeNull();
  });
});

describe("assignFromPool — guards (lean's accept set, per seat)", () => {
  it("rejects a seat that isn't Open/Bailed", async () => {
    const bob = await addCrew("bob");
    const cay = await addCrew("cay");
    const [seatId] = await addShift(["Open"]);
    const [ask] = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, ask!.id, "accepted", T0); // bob → Claimed

    const out = await assignFromPool(repo, seatId!, cay, T0);
    expect(out.code).toBe("no_gap");
    void bob;
  });

  it("rejects someone already holding a live ask on the shift", async () => {
    const bob = await addCrew("bob");
    const [s1, s2] = await addShift(["Open", "Open"]);
    await assignFromPool(repo, s1!, bob, T0); // live ask out to bob

    const out = await assignFromPool(repo, s2!, bob, T0);
    expect(out.code).toBe("already_asked");
  });

  it("rejects someone who bailed on this shift", async () => {
    const ann = await addCrew("ann"); // the only crew → bail rests the seat
    const [seatId] = await addShift(["Open"]);
    const [ask] = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, ask!.id, "accepted", T0);
    await confirmSeat(repo, seatId!, T0);
    await bail(repo, seatId!, T0, 0); // empty pool → seat rests Bailed

    const out = await assignFromPool(repo, seatId!, ann, T0);
    expect(out.code).toBe("bailed");
  });

  it("rejects someone outside the seat's eligible pool", async () => {
    const lou = await addCrew("lou", { ratings: [] }); // no captain rating
    const [seatId] = await addShift(["Open"]);

    const out = await assignFromPool(repo, seatId!, lou, T0);
    expect(out.code).toBe("ineligible");
  });

  it("rejects a dead shift", async () => {
    const bob = await addCrew("bob");
    const [seatId] = await addShift(["Open"], "Cancelled");

    const out = await assignFromPool(repo, seatId!, bob, T0);
    expect(out.code).toBe("shift_gone");
  });

  it("rejects an unknown seat", async () => {
    const bob = await addCrew("bob");
    await addShift(["Open"]);
    const out = await assignFromPool(repo, asId<"SeatId">("seat-nope"), bob, T0);
    expect(out.code).toBe("shift_gone");
  });
});
