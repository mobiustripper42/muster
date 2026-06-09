/**
 * The escalation trail projection (DEC-024, §2.5) — the derived read-model the
 * At-Risk board (#41) reads. Built + tested before its writer (#40b's
 * `escalate()`) exists: per DEC-008 the trail is real from the first commit, so
 * here we seed asks + escalation events directly and assert the fold.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Credential, CrewMember, Seat, Shift } from "../domain/entities.js";
import {
  logNudged,
  logPoolWidened,
} from "../oracle/reliability-log.js";
import {
  broadcastAsk,
  expireAsks,
  recordResponse,
} from "./ask-loop.js";
import { escalationTrailFor } from "./escalation-trail.js";

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

describe("escalationTrailFor — ask counts", () => {
  it("folds asked/accepted/declined/silent/pending from the seat's asks; buckets reconcile", async () => {
    await addCrew("crew-a");
    await addCrew("crew-b");
    await addCrew("crew-c");
    const seat = (await addShift(1))[0]!;

    // Broadcast fires one ask per eligible crew (3). One declines; the other two
    // go silent (timed out by the sweep) → seat reopens.
    const asks = await broadcastAsk(repo, seat, T0);
    expect(asks).toHaveLength(3);
    const decliner = asks.find((a) => a.crewMemberId === asId<"CrewMemberId">("crew-a"))!;
    await recordResponse(repo, decliner.id, "declined", later(1000));
    await expireAsks(repo, seat, later(10 * 60_000), 5 * 60_000); // times out the other two

    let trail = await escalationTrailFor(repo, SHIFT, later(11 * 60_000));
    expect(trail.asked).toBe(3);
    expect(trail.declined).toBe(1);
    expect(trail.silent).toBe(2);
    expect(trail.accepted).toBe(0);
    expect(trail.pending).toBe(0);
    // Buckets always partition the asks.
    expect(trail.accepted + trail.declined + trail.silent + trail.pending).toBe(
      trail.asked,
    );

    // A fresh broadcast on the reopened seat adds live (pending) asks.
    const reAsks = await broadcastAsk(repo, seat, later(12 * 60_000));
    expect(reAsks.length).toBeGreaterThan(0);
    trail = await escalationTrailFor(repo, SHIFT, later(13 * 60_000));
    expect(trail.pending).toBe(reAsks.length);
    expect(trail.accepted + trail.declined + trail.silent + trail.pending).toBe(
      trail.asked,
    );
  });

  it("counts an accepted ask", async () => {
    await addCrew("crew-a");
    const seat = (await addShift(1))[0]!;
    const ask = (await broadcastAsk(repo, seat, T0))[0]!;
    await recordResponse(repo, ask.id, "accepted", later(1000));

    const trail = await escalationTrailFor(repo, SHIFT, later(2000));
    expect(trail.accepted).toBe(1);
    expect(trail.asked).toBe(1);
  });

  it("ignores supernumerary seats — only required seats' asks count", async () => {
    await addCrew("crew-a");
    await addShift(1);
    // Add a supernumerary seat and an ask on it; it must not inflate the trail.
    const superId = asId<"SeatId">("seat-super");
    await repo.saveSeat({
      id: superId,
      shiftId: SHIFT,
      role: CAPTAIN,
      kind: "supernumerary",
      state: "Open",
    });
    await repo.saveAsk({
      id: asId<"AskId">("ask-super"),
      seatId: superId,
      crewMemberId: asId<"CrewMemberId">("crew-a"),
      channel: "push",
      sentAt: T0.toISOString(),
    });

    const trail = await escalationTrailFor(repo, SHIFT, T0);
    expect(trail.asked).toBe(0); // the supernumerary ask is excluded
  });
});

describe("escalationTrailFor — Tier-2 actions", () => {
  it("reflects pool-widened (system-keyed) and nudged (crew-keyed) for this shift", async () => {
    const bob = await addCrew("crew-bob");
    const seat = (await addShift(1))[0]!;

    let trail = await escalationTrailFor(repo, SHIFT, T0);
    expect(trail.poolWidened).toBe(false);
    expect(trail.nudged).toEqual([]);

    await logPoolWidened(repo, SHIFT, later(1000));
    await logNudged(repo, bob, seat, SHIFT, later(2000));

    trail = await escalationTrailFor(repo, SHIFT, later(3000));
    expect(trail.poolWidened).toBe(true);
    expect(trail.nudged).toEqual([bob]);
  });

  it("orders nudged by nudge timestamp (log order), not crew-iteration order", async () => {
    // Add crew so that iteration order ≠ nudge order: nudge 'crew-z' before
    // 'crew-a'. A crew-iteration scan would return [a, z]; log order is [z, a].
    const a = await addCrew("crew-a");
    const z = await addCrew("crew-z");
    const seat = (await addShift(1))[0]!;
    await logNudged(repo, z, seat, SHIFT, later(1000));
    await logNudged(repo, a, seat, SHIFT, later(2000));

    const trail = await escalationTrailFor(repo, SHIFT, later(3000));
    expect(trail.nudged).toEqual([z, a]);
  });

  it("dedupes a re-nudged person to a distinct-crew set", async () => {
    const bob = await addCrew("crew-bob");
    const seat = (await addShift(1))[0]!;
    await logNudged(repo, bob, seat, SHIFT, later(1000));
    await logNudged(repo, bob, seat, SHIFT, later(2000)); // re-nudge same person

    const trail = await escalationTrailFor(repo, SHIFT, later(3000));
    expect(trail.nudged).toEqual([bob]); // once, not twice
  });

  it("scopes widened/nudged to the shift — another shift's events don't bleed in", async () => {
    const bob = await addCrew("crew-bob");
    await addShift(1);
    const OTHER = asId<"ShiftId">("shift-other");
    const otherSeat = asId<"SeatId">("seat-other");

    // Escalation activity on a different shift.
    await logPoolWidened(repo, OTHER, later(1000));
    await logNudged(repo, bob, otherSeat, OTHER, later(2000));

    const trail = await escalationTrailFor(repo, SHIFT, later(3000));
    expect(trail.poolWidened).toBe(false);
    expect(trail.nudged).toEqual([]);
  });
});

describe("escalationTrailFor — exhaustion", () => {
  it("not exhausted while the pool can crew every required seat", async () => {
    await addCrew("crew-a");
    await addShift(1);
    const trail = await escalationTrailFor(repo, SHIFT, T0);
    expect(trail.exhausted).toBe(false);
  });

  it("exhausted when no eligible crew can fill a required seat", async () => {
    // Inactive crew → fails the is_active hard rule → empty pool → unsatisfiable.
    await addCrew("crew-a", { status: "inactive" });
    await addShift(1);
    const trail = await escalationTrailFor(repo, SHIFT, T0);
    expect(trail.exhausted).toBe(true);
  });
});

describe("escalationTrailFor — empty shift", () => {
  it("an untouched shift reads all zeros, nothing widened or nudged", async () => {
    await addShift(1);
    const trail = await escalationTrailFor(repo, SHIFT, T0);
    expect(trail).toMatchObject({
      shiftId: SHIFT,
      asked: 0,
      accepted: 0,
      declined: 0,
      silent: 0,
      pending: 0,
      poolWidened: false,
      nudged: [],
      exhausted: true, // no crew exists at all → can't crew the required seat
    });
  });
});
