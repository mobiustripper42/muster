/**
 * The lean (#43, DEC-026) — Spink's manual direct nudge from a board row.
 * Reuses the ask rails (`assignPerson`) and the one log (`nudged{manual}`);
 * target validation mirrors the board's `available` semantics.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import type { SeatState, ShiftState } from "../domain/states.js";
import { broadcastAsk, bail, confirmSeat, recordResponse } from "./ask-loop.js";
import { lean } from "./lean.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
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

describe("lean — the happy path", () => {
  it("asks the named person, flags the nudge manual, seat goes Asked", async () => {
    const bob = await addCrew("bob");
    const [seatId] = await addShift(["Open"]);

    const out = await lean(repo, SHIFT, bob, T0);

    expect(out).toMatchObject({ error: null, seatId });
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
    const asks = await repo.listAsksForSeat(seatId!);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.crewMemberId).toBe(bob);
    // The fired ask is surfaced for the edge's channel forwarding (DEC-030).
    expect(out.ask).toEqual(asks[0]);
    const nudges = await nudgesFor(bob);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.metadata.manual).toBe(true);
    expect(nudges[0]!.metadata.shiftId).toBe(SHIFT);
  });

  it("a decliner stays leanable — leaning on a no is Spink's call", async () => {
    const bob = await addCrew("bob");
    const [seatId] = await addShift(["Open"]);
    const [ask] = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, ask!.id, "declined", T0); // seat reopens

    const out = await lean(repo, SHIFT, bob, T0);
    expect(out.error).toBeNull();
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
  });

  it("reopens a legacy resting-Bailed seat", async () => {
    const [seatId] = await addShift(["Open"]);
    // DEC-128 (#483) retired `Bailed` as a live outcome (bail() now rests Open),
    // but older stores may still hold a resting-Bailed seat — lean must still
    // reopen one. Seed it directly rather than mint it through bail().
    const seat = (await repo.getSeat(seatId!))!;
    await repo.saveSeat({ ...seat, state: "Bailed" });
    expect((await repo.getSeat(seatId!))!.state).toBe("Bailed");

    const sub = await addCrew("sub"); // a target to lean in
    const out = await lean(repo, SHIFT, sub, T0);

    expect(out.error).toBeNull();
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
    expect(await nudgesFor(sub)).toHaveLength(1);
  });
});

describe("lean — guards (the board's available semantics, enforced)", () => {
  it("rejects a person with a live ask on this shift — one pending ask each", async () => {
    const bob = await addCrew("bob");
    const seatIds = await addShift(["Open", "Open"]);
    await broadcastAsk(repo, seatIds[0]!, T0); // bob now mid-flight on seat 1

    const out = await lean(repo, SHIFT, bob, T0);
    expect(out.error).toMatch(/already asked/i);
    expect(await nudgesFor(bob)).toHaveLength(0);
  });

  it("rejects whoever bailed on this shift", async () => {
    const walker = await addCrew("walker");
    const [seatId] = await addShift(["Open"]);
    const [ask] = await broadcastAsk(repo, seatId!, T0);
    await recordResponse(repo, ask!.id, "accepted", T0);
    await confirmSeat(repo, seatId!, T0);
    await bail(repo, seatId!, T0, 1000);

    const out = await lean(repo, SHIFT, walker, T0);
    expect(out.error).toMatch(/bailed/i);
  });

  it("rejects someone ineligible for the open seats", async () => {
    const mateOnly = await addCrew("mate-only", { ratings: [MATE] });
    await addShift(["Open"]); // captain seat

    const out = await lean(repo, SHIFT, mateOnly, T0);
    expect(out.error).toMatch(/not eligible/i);
  });

  it("rejects someone already committed on this shift (distinct-pool)", async () => {
    const held = await addCrew("held");
    const seatIds = await addShift(["Open", "Open"]);
    const [ask] = await broadcastAsk(repo, seatIds[0]!, T0);
    // held accepts seat 1 — wait for it to claim, then confirm.
    await recordResponse(repo, ask!.id, "accepted", T0);
    await confirmSeat(repo, seatIds[0]!, T0);

    const out = await lean(repo, SHIFT, held, T0);
    expect(out.error).toMatch(/not eligible/i);
  });

  it("rejects when there is no gap seat at all", async () => {
    const bob = await addCrew("bob");
    await addShift(["Confirmed"]);

    const out = await lean(repo, SHIFT, bob, T0);
    expect(out.error).toMatch(/no seat to fill/i);
  });

  it("rejects a Cancelled shift", async () => {
    const bob = await addCrew("bob");
    await addShift(["Open"], "Cancelled");

    const out = await lean(repo, SHIFT, bob, T0);
    expect(out.error).toMatch(/no longer live/i);
  });
});

describe("lean onto an Asked seat (#601) — the drip is not a lock", () => {
  it("nudges a silent candidate on a seat that already has a live ask out", async () => {
    // The reported state: captain seat badged ASKED, one candidate awaiting reply,
    // five shown silent, and no Nudge button anywhere. DEC-063 makes `Asked` the
    // NORMAL state of a filling seat, not a transient one — with a 120-minute
    // timeout a single outstanding ask made the seat un-actionable for two hours at
    // a stretch, repeatedly, across the whole fill window.
    const waiting = await addCrew("waiting");
    const silent = await addCrew("silent");
    const [seatId] = await addShift(["Open"]);
    // Fire the drip's first ask, then let it go silent so `waiting` still holds a
    // live one and the seat sits `Asked`.
    await broadcastAsk(repo, seatId!, T0);
    const asks = await repo.listAsksForSeat(seatId!);
    const silentAsk = asks.find((a) => a.crewMemberId === silent)!;
    await repo.saveAsk({ ...silentAsk, respondedAt: T0.toISOString() }); // timed out
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");

    // A later instant: `fireAsk` mints `ask-{seat}-{crew}-{sentAt}`, so re-asking at
    // the SAME millisecond collides on the id and overwrites (documented in
    // `fireAsk`). Real re-asks are minutes apart.
    const later = new Date(T0.getTime() + 90 * 60_000);
    const out = await lean(repo, SHIFT, silent, later);

    expect(out.error).toBeNull();
    expect(out.seatId).toBe(seatId);
    // Asks ACCUMULATE — the existing one is untouched, first-yes-wins decides
    // between them (DEC-007/061), exactly as the drip's own widen already behaves.
    const after = await repo.listAsksForSeat(seatId!);
    expect(after.filter((a) => a.crewMemberId === silent)).toHaveLength(2);
    // The person mid-decision keeps their single LIVE ask, untouched.
    const waitingAsks = after.filter((a) => a.crewMemberId === waiting);
    expect(waitingAsks).toHaveLength(1);
    expect(waitingAsks[0]!.respondedAt).toBeUndefined();
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");
    expect(await nudgesFor(silent)).toHaveLength(1);
  });

  it("still refuses someone who holds a LIVE ask on the shift — they're mid-decision", async () => {
    // The double-ask guard is not relaxed. It keys on `respondedAt === undefined`,
    // so it never blocked the silent candidates above; it does still block the one
    // person who hasn't answered yet.
    const waiting = await addCrew("waiting");
    await addCrew("other");
    const [seatId] = await addShift(["Open"]);
    await broadcastAsk(repo, seatId!, T0);
    expect((await repo.getSeat(seatId!))!.state).toBe("Asked");

    const out = await lean(repo, SHIFT, waiting, T0);

    expect(out.code).toBe("already_asked");
  });

  it("still refuses a settled seat — Confirmed is not nudgeable", async () => {
    const bob = await addCrew("bob");
    const other = await addCrew("other");
    const [seatId] = await addShift(["Open"]);
    await broadcastAsk(repo, seatId!, T0);
    const asks = await repo.listAsksForSeat(seatId!);
    await recordResponse(repo, asks.find((a) => a.crewMemberId === other)!.id, "accepted", T0);
    await confirmSeat(repo, seatId!, T0);

    const out = await lean(repo, SHIFT, bob, T0);

    expect(out.code).toBe("no_gap");
  });
});

describe("lean's ask and the drip clock (#601)", () => {
  it("a manual nudge paces the next AUTOMATIC widen — and urgency ignores pacing anyway", async () => {
    // Pinning the interaction rather than leaving it accidental. `widenDue` reads
    // `max(sentAt)` across every ask on the seat with no notion of who fired it, so a
    // lean now shifts the drip clock. Deliberate: someone was just asked, and piling
    // an automatic ask on a minute later is what the drip exists to prevent.
    const silent = await addCrew("silent");
    await addCrew("spare");
    const [seatId] = await addShift(["Open"]);
    await broadcastAsk(repo, seatId!, T0);
    const first = await repo.listAsksForSeat(seatId!);
    await repo.saveAsk({
      ...first.find((a) => a.crewMemberId === silent)!,
      respondedAt: T0.toISOString(),
    });

    const nudgeAt = new Date(T0.getTime() + 90 * 60_000);
    expect((await lean(repo, SHIFT, silent, nudgeAt)).error).toBeNull();

    // The newest ask on the seat is the operator's, so the drip paces from THERE.
    const after = await repo.listAsksForSeat(seatId!);
    const newest = Math.max(...after.map((a) => Date.parse(a.sentAt)));
    expect(newest).toBe(nudgeAt.getTime());
    // And past the fill deadline none of this applies — the tick's `urgent` branch
    // blasts the remaining pool without consulting `widenDue`. That is the #601
    // scenario itself (deadline overdue), which is why the pacing shift is harmless.
  });
});
