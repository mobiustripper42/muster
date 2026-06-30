/**
 * 7.4 (#184) — pull and push coexist (SPEC §2.7.5, DEC-078). Self-claim
 * front-loads fills during `Pending`/early `Filling`; whatever's still Open at the
 * staffing horizon flows into the existing ask cascade (§1.2). The two never
 * conflict — both end at a `Confirmed` seat via the same state machine.
 *
 * Verification-only (the issue expects no new code): these drive the REAL `tick`
 * alongside `claimSeat`/`releaseSelfClaim` to prove the coexistence holds.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Vessel } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId, SeatId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { claimSeat, releaseSelfClaim } from "../asks/claim.js";
import { formShifts } from "./form-shifts.js";
import { tick } from "./tick.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
// Event 2026-07-01T15:00Z; staffing horizon = trip − 7d = 2026-06-24.
const BEFORE = new Date("2026-06-01T00:00:00.000Z"); // before horizon → Pending (system abstains)
const AFTER = new Date("2026-06-30T00:00:00.000Z"); // after horizon, before trip → Filling (cascade runs)

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  const vessel: Vessel = {
    id: VESSEL,
    name: "X",
    coiMaxPax: 16,
    manning: [
      { roleTypeId: CAPTAIN, count: 1 },
      { roleTypeId: MATE, count: 1 },
    ],
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
});

async function crew(id: string, role: RoleTypeId): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings: [role],
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

const theShift = async () => (await repo.listShifts())[0]!;
async function seatFor(role: RoleTypeId): Promise<SeatId> {
  const shift = await theShift();
  const seats = await repo.listSeatsForShift(shift.id);
  return seats.find((s) => s.role === role)!.id;
}

describe("cascade coexistence (DEC-078, §2.7.5)", () => {
  it("a seat self-claimed during Pending is skipped by the cascade at the horizon crossing", async () => {
    const cap = await crew("cap", CAPTAIN);
    const mate = await crew("mate", MATE);
    await formShifts(repo, { now: BEFORE }); // Pending shift, captain + mate Open seats
    const capSeat = await seatFor(CAPTAIN);
    const mateSeat = await seatFor(MATE);

    // Crew pulls the captain seat during Pending → auto-lock Confirmed (DEC-075).
    expect((await claimSeat(repo, cap, capSeat, BEFORE)).code).toBeNull();

    // Horizon crossing: the tick advances the shift to Filling and works it.
    const result = await tick(repo, AFTER);

    // The self-Confirmed captain seat is no longer Open/Asked, so the fill loop
    // passes it by — never re-asked, occupant intact.
    const capAfter = (await repo.getSeat(capSeat))!;
    expect(capAfter.state).toBe("Confirmed");
    expect(capAfter.assignedCrewMemberId).toBe(cap);
    expect(await repo.listAsksForSeat(capSeat)).toHaveLength(0);
    expect(result.firedAsks.some((a) => a.seatId === capSeat)).toBe(false);

    // …and the cascade WAS active (so the skip is meaningful, not a dead tick):
    // the still-Open mate seat got asked.
    expect(result.firedAsks.some((a) => a.seatId === mateSeat && a.crewMemberId === mate)).toBe(true);
  });

  it("a self-released seat re-enters the cascade: re-opens and re-asks the next candidate", async () => {
    const cap = await crew("cap", CAPTAIN);
    const cap2 = await crew("cap2", CAPTAIN); // the re-ask candidate
    await crew("mate", MATE);
    await formShifts(repo, { now: BEFORE });
    const capSeat = await seatFor(CAPTAIN);
    expect((await claimSeat(repo, cap, capSeat, BEFORE)).code).toBeNull();

    // Crew releases — reuses the bail edge (DEC-078): re-opens + re-asks inline.
    expect((await releaseSelfClaim(repo, cap, capSeat, AFTER)).code).toBeNull();

    const seatAfter = (await repo.getSeat(capSeat))!;
    expect(seatAfter.state).toBe("Asked"); // back in the cascade's worklist
    expect(seatAfter.assignedCrewMemberId).toBeUndefined();
    const asks = await repo.listAsksForSeat(capSeat);
    expect(asks.map((a) => a.crewMemberId)).toContain(cap2); // next candidate asked
    expect(asks.map((a) => a.crewMemberId)).not.toContain(cap); // not the releaser

    // The tick then works it as an ordinary live Filling seat — still Asked with
    // the re-ask intact (not skipped like a Confirmed seat, not dropped to Open).
    await tick(repo, AFTER);
    const reworked = (await repo.getSeat(capSeat))!;
    expect(reworked.state).toBe("Asked");
    expect((await repo.listAsksForSeat(capSeat)).map((a) => a.crewMemberId)).toContain(cap2);
  });

  it("the system abstains during Pending, but a crew pull is orthogonal and still works", async () => {
    const cap = await crew("cap", CAPTAIN);
    await crew("mate", MATE);
    await formShifts(repo, { now: BEFORE });
    const capSeat = await seatFor(CAPTAIN);

    // §1.1: before the horizon the SYSTEM abstains — a tick fires no asks.
    const result = await tick(repo, BEFORE);
    expect(result.asksFired).toBe(0);
    expect((await theShift()).state).toBe("Pending");

    // A crew member pulling during Pending is orthogonal — the claim still works.
    expect((await claimSeat(repo, cap, capSeat, BEFORE)).code).toBeNull();
    expect((await repo.getSeat(capSeat))!.state).toBe("Confirmed");
    // …and the system still hasn't asked anyone (push stayed abstained).
    expect(await repo.listAsksForSeat(capSeat)).toHaveLength(0);
  });
});
