import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import { claimSeat, releaseSelfClaim } from "./claim.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-x");
const NOW = new Date("2026-06-15T12:00:00.000Z"); // today (vessel-local) = 2026-06-15
const IN_WINDOW = "2026-07-01"; // ~16d out (≤ today+45d)
const FAR = "2026-09-01"; // ~78d out (> today+45d)

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

async function crew(
  id: string,
  ratings: typeof CAPTAIN[],
  opts: { status?: "active" | "inactive"; mmcExpiry?: string | null } = {},
): Promise<CrewMemberId> {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name: id,
    phone: "555",
    ratings,
    status: opts.status ?? "active",
    reliabilityScore: null,
  });
  const mmc = opts.mmcExpiry === undefined ? "2026-12-31" : opts.mmcExpiry;
  if (mmc) {
    await repo.saveCredential({
      id: asId<"CredentialId">(`cred-${id}`),
      crewMemberId: crewId,
      type: "MMC",
      expiry: mmc,
    });
  }
  return crewId;
}

async function shift(
  id: string,
  opts: {
    date?: string;
    state?: "Pending" | "Filling" | "Crewed" | "AtRisk";
    eventIds?: string[];
  } = {},
): Promise<ShiftId> {
  const shiftId = asId<"ShiftId">(id);
  await repo.saveShift({
    id: shiftId,
    vesselId: VESSEL,
    date: opts.date ?? IN_WINDOW,
    state: opts.state ?? "Pending",
    eventIds: (opts.eventIds ?? []).map((e) => asId<"EventId">(e)),
  });
  return shiftId;
}

/** A scheduled departure so the bail edge can derive lead-time lateness. */
async function event(
  id: string,
  opts: { date?: string; time?: string } = {},
): Promise<void> {
  await repo.saveEvent({
    id: asId<"EventId">(id),
    vesselId: VESSEL,
    date: opts.date ?? IN_WINDOW,
    time: opts.time ?? "10:00",
    capacity: 20,
    status: "scheduled",
  });
}

async function seat(
  shiftId: ShiftId,
  id: string,
  opts: {
    role?: typeof CAPTAIN;
    kind?: "required" | "supernumerary";
    state?: "Open" | "Asked" | "Confirmed" | "Bailed";
    assigned?: CrewMemberId;
  } = {},
): Promise<SeatId> {
  const seatId = asId<"SeatId">(id);
  await repo.saveSeat({
    id: seatId,
    shiftId,
    role: opts.role ?? MATE,
    kind: opts.kind ?? "required",
    state: opts.state ?? "Open",
    ...(opts.assigned ? { assignedCrewMemberId: opts.assigned } : {}),
  });
  return seatId;
}

describe("claimSeat (DEC-075/078)", () => {
  it("Open native-role seat in window → Confirmed and assigned", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "seat-1", { role: MATE });

    const res = await claimSeat(repo, c, seatId, NOW);

    expect(res.code).toBeNull();
    expect(res.seat?.state).toBe("Confirmed");
    const stored = await repo.getSeat(seatId);
    expect(stored?.state).toBe("Confirmed");
    expect(stored?.assignedCrewMemberId).toBe(c);
  });

  it("a filled native-role seat confirms the shift → Crewed", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "only-seat", { role: MATE });

    await claimSeat(repo, c, seatId, NOW);

    expect((await repo.getShift(sh))?.state).toBe("Crewed");
  });

  it("native-role-only: a mate cannot claim a captain seat (DEC-076)", async () => {
    const c = await crew("mate", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "cap-seat", { role: CAPTAIN });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("not_claimable");
  });

  it("native-role-only: a dual-rated captain cannot self-claim a mate seat (DEC-076)", async () => {
    // The operator-assign door could place them here; the self-claim door can't.
    const cap = await crew("cap", [CAPTAIN, MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "mate-seat", { role: MATE });

    expect((await claimSeat(repo, cap, seatId, NOW)).code).toBe("not_claimable");
  });

  it("a non-Open seat is not claimable", async () => {
    const c = await crew("c", [MATE]);
    const other = await crew("other", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "taken", {
      role: MATE,
      state: "Confirmed",
      assigned: other,
    });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("not_claimable");
  });

  it("a supernumerary seat is not claimable (Phase 7 scope)", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "extra", { role: MATE, kind: "supernumerary" });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("not_claimable");
  });

  it("a seat on a non-Pending/Filling shift is not claimable", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh", { state: "AtRisk" });
    const seatId = await seat(sh, "seat-1", { role: MATE });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("not_claimable");
  });

  it("a seat outside the today+window horizon is not claimable", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh", { date: FAR });
    const seatId = await seat(sh, "seat-1", { role: MATE });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("not_claimable");
  });

  it("a lapsed MMC on the trip date → ineligible, with failures", async () => {
    const c = await crew("c", [MATE], { mmcExpiry: "2026-06-20" }); // < IN_WINDOW
    const sh = await shift("sh");
    const seatId = await seat(sh, "seat-1", { role: MATE });

    const res = await claimSeat(repo, c, seatId, NOW);
    expect(res.code).toBe("ineligible");
    expect(res.failures?.some((f) => f.ruleId === "mmc_valid_on_date")).toBe(true);
  });

  it("already committed elsewhere on that date → conflict (DEC-078)", async () => {
    const c = await crew("c", [MATE]);
    // An existing Confirmed seat on a DIFFERENT shift, same date.
    const held = await shift("held", { date: IN_WINDOW });
    await seat(held, "held-seat", {
      role: MATE,
      state: "Confirmed",
      assigned: c,
    });
    const sh = await shift("sh", { date: IN_WINDOW });
    const seatId = await seat(sh, "seat-1", { role: MATE });

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe("conflict");
  });

  it("race: two concurrent claims on one seat → exactly one Confirmed, the other just_taken", async () => {
    const a = await crew("a", [MATE]);
    const b = await crew("b", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "contested", { role: MATE });

    const [ra, rb] = await Promise.all([
      claimSeat(repo, a, seatId, NOW),
      claimSeat(repo, b, seatId, NOW),
    ]);

    const codes = [ra.code, rb.code];
    expect(codes).toContain(null); // exactly one winner
    expect(codes).toContain("just_taken"); // exactly one clean loser
    expect((await repo.getSeat(seatId))?.state).toBe("Confirmed");
  });

  it("confirm-gate flag on → requires_confirmation stub, no write (DEC-075)", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "seat-1", { role: MATE });
    await repo.setSelfClaimRequiresConfirmation(true, NOW.toISOString());

    expect((await claimSeat(repo, c, seatId, NOW)).code).toBe(
      "requires_confirmation",
    );
    // The reserved tier is NOT built — the seat must stay Open, untouched.
    expect((await repo.getSeat(seatId))?.state).toBe("Open");
  });

  it("a claim emits no reliability event (DEC-078 — earned at Completed, not claim)", async () => {
    const c = await crew("c", [MATE]);
    const sh = await shift("sh");
    const seatId = await seat(sh, "seat-1", { role: MATE });

    await claimSeat(repo, c, seatId, NOW);

    expect(await repo.reliabilityEventsFor(c)).toHaveLength(0);
  });

  it("inactive crew and missing seats are gone", async () => {
    const inactive = await crew("z", [MATE], { status: "inactive" });
    const sh = await shift("sh");
    const seatId = await seat(sh, "seat-1", { role: MATE });
    expect((await claimSeat(repo, inactive, seatId, NOW)).code).toBe("gone");

    const live = await crew("live", [MATE]);
    const missing = asId<"SeatId">("nope");
    expect((await claimSeat(repo, live, missing, NOW)).code).toBe("gone");
  });
});

describe("releaseSelfClaim (DEC-078)", () => {
  /** Seed a Confirmed seat already held by `crewId`. */
  async function heldSeat(
    crewId: CrewMemberId,
    shiftId: ShiftId,
    seatId: string,
  ): Promise<SeatId> {
    return seat(shiftId, seatId, {
      role: MATE,
      state: "Confirmed",
      assigned: crewId,
    });
  }

  it("re-opens and re-asks the next candidate when a pool exists", async () => {
    const holder = await crew("holder", [MATE]);
    const next = await crew("next", [MATE]); // an eligible re-ask candidate
    const sh = await shift("sh");
    const seatId = await heldSeat(holder, sh, "seat-1");

    const res = await releaseSelfClaim(repo, holder, seatId, NOW);

    expect(res.code).toBeNull();
    expect(res.outcome?.seatState).toBe("Asked");
    expect(res.outcome?.reAsks.length).toBeGreaterThan(0);
    // The released seat is no longer the holder's.
    expect((await repo.getSeat(seatId))?.assignedCrewMemberId).toBeUndefined();
    // The re-ask went to the next eligible candidate, not the releaser.
    const asks = await repo.listAsksForSeat(seatId);
    expect(asks.map((a) => a.crewMemberId)).toContain(next);
    expect(asks.map((a) => a.crewMemberId)).not.toContain(holder);
  });

  it("emits exactly one shift_bailed reliability event for the releaser", async () => {
    const holder = await crew("holder", [MATE]);
    const sh = await shift("sh");
    const seatId = await heldSeat(holder, sh, "seat-1");

    await releaseSelfClaim(repo, holder, seatId, NOW);

    const events = await repo.reliabilityEventsFor(holder);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("shift_bailed");
  });

  it("lead-time weighted: a near-departure release outweighs a far-out one (DEC-008)", async () => {
    // Far-out: trip months away → notice ≥ horizon → latenessMs clamps to 0.
    const farCrew = await crew("far", [MATE]);
    await event("ev-far", { date: FAR });
    const farShift = await shift("far-sh", { date: FAR, eventIds: ["ev-far"] });
    const farSeat = await heldSeat(farCrew, farShift, "far-seat");
    await releaseSelfClaim(repo, farCrew, farSeat, NOW);
    const farEvent = (await repo.reliabilityEventsFor(farCrew))[0];

    // Near: trip today → near-departure → latenessMs > 0 (weighted as a bail).
    const nearCrew = await crew("near", [MATE]);
    await event("ev-near", { date: "2026-06-15", time: "10:00" });
    const nearShift = await shift("near-sh", {
      date: "2026-06-15",
      eventIds: ["ev-near"],
    });
    const nearSeat = await heldSeat(nearCrew, nearShift, "near-seat");
    await releaseSelfClaim(repo, nearCrew, nearSeat, NOW);
    const nearEvent = (await repo.reliabilityEventsFor(nearCrew))[0];

    expect(farEvent?.metadata.latenessMs).toBe(0);
    expect(nearEvent?.metadata.latenessMs).toBeGreaterThan(
      farEvent?.metadata.latenessMs ?? 0,
    );
  });

  it("pins the occupant: releasing a seat you don't hold → raced, no event", async () => {
    const holder = await crew("holder", [MATE]);
    const stranger = await crew("stranger", [MATE]);
    const sh = await shift("sh");
    const seatId = await heldSeat(holder, sh, "seat-1");

    const res = await releaseSelfClaim(repo, stranger, seatId, NOW);

    expect(res.code).toBe("raced");
    expect(await repo.reliabilityEventsFor(holder)).toHaveLength(0);
    expect(await repo.reliabilityEventsFor(stranger)).toHaveLength(0);
    // The holder's seat is untouched.
    expect((await repo.getSeat(seatId))?.state).toBe("Confirmed");
  });
});
