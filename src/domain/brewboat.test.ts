/**
 * Phase 0 demo gate (PROJECT_PLAN.md): construct the BrewBoat vessel + a crew
 * member + a logged reliability event, all behind the repository port. If this
 * is green, the spine exists and is exercised end-to-end.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "./ids.js";
import type {
  CrewMemberId,
  ReliabilityEventId,
  RoleTypeId,
  VesselId,
} from "./ids.js";
import type { CrewMember, RoleType, Vessel } from "./entities.js";
import type { ReliabilityEvent } from "./reliability.js";

// BrewBoat's tenant + its two seeded role rows (DEC-ROLE-1): captain/mate are
// DATA, not an enum. A later tenant adds more rows; nothing here assumes two.
const BREWBOAT = asId<"TenantId">("tenant-brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");

const roleType = (id: RoleTypeId, name: string): RoleType => ({
  id,
  tenantId: BREWBOAT,
  name,
});

const brewBoat = (): Vessel => ({
  id: asId<"VesselId">("vessel-brewboat"),
  name: "BrewBoat",
  coiMaxPax: 6,
  manning: [
    { roleTypeId: CAPTAIN, count: 1 },
    { roleTypeId: MATE, count: 1 },
  ],
});

const aCaptain = (): CrewMember => ({
  id: asId<"CrewMemberId">("crew-spink"),
  name: "Spink",
  phone: "+15035550100",
  ratings: [CAPTAIN],
  status: "active",
  reliabilityScore: null, // cold start — no history yet, not a misleading low
});

describe("BrewBoat spine (Phase 0 demo gate)", () => {
  it("seeds two role types as tenant data, not an enum (DEC-ROLE-1)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveRoleType(roleType(CAPTAIN, "captain"));
    await repo.saveRoleType(roleType(MATE, "mate"));

    const roles = await repo.listRoleTypes(BREWBOAT);
    expect(roles).toHaveLength(2);
    expect(roles.map((r) => r.name).sort()).toEqual(["captain", "mate"]);
  });

  it("persists the BrewBoat vessel with COI max-pax 6 and manning as a list", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(brewBoat());

    const loaded = await repo.getVessel(asId<"VesselId">("vessel-brewboat"));
    expect(loaded).not.toBeNull();
    expect(loaded?.coiMaxPax).toBe(6);
    // Manning is a list seat derivation iterates (DEC-ROLE-1) — not a {captain,mate} pair.
    expect(loaded?.manning).toEqual([
      { roleTypeId: CAPTAIN, count: 1 },
      { roleTypeId: MATE, count: 1 },
    ]);
  });

  it("derives required seats by iterating the manning list (works for N roles)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(brewBoat());
    const vessel = await repo.getVessel(asId<"VesselId">("vessel-brewboat"));

    // The shape the seat builder will consume: one required seat per manning unit,
    // role carried as a RoleTypeId. No "create a captain seat and a mate seat" branch.
    const requiredSeatRoles = (vessel?.manning ?? []).flatMap((m) =>
      Array.from({ length: m.count }, () => m.roleTypeId),
    );
    expect(requiredSeatRoles).toEqual([CAPTAIN, MATE]);
  });

  it("persists a crew member rated by RoleTypeId at cold-start standing", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(aCaptain());

    const loaded = await repo.getCrewMember(asId<"CrewMemberId">("crew-spink"));
    expect(loaded?.ratings).toContain(CAPTAIN);
    expect(loaded?.reliabilityScore).toBeNull();
  });

  it("logs a reliability event day one and reads it back (DEC-008)", async () => {
    const repo = new InMemoryRepository();
    const crewId = asId<"CrewMemberId">("crew-spink");
    const event: ReliabilityEvent = {
      id: asId<"ReliabilityEventId">("rel-1"),
      crewMemberId: crewId,
      type: "shift_completed",
      timestamp: "2026-06-01T18:00:00Z",
      metadata: { shiftId: asId("shift-1") },
    };

    await repo.logReliabilityEvent(event);

    const log = await repo.reliabilityEventsFor(crewId);
    expect(log).toHaveLength(1);
    expect(log[0]?.type).toBe("shift_completed");
  });

  it("scopes the reliability log per crew member", async () => {
    const repo = new InMemoryRepository();
    const alice = asId<"CrewMemberId">("crew-alice");
    const bob = asId<"CrewMemberId">("crew-bob");
    const mk = (
      id: string,
      crewMemberId: CrewMemberId,
    ): ReliabilityEvent => ({
      id: asId<"ReliabilityEventId">(id),
      crewMemberId,
      type: "ask_accepted",
      timestamp: "2026-06-01T18:00:00Z",
      metadata: { latencyMs: 4200 },
    });

    await repo.logReliabilityEvent(mk("e1", alice));
    await repo.logReliabilityEvent(mk("e2", bob));
    await repo.logReliabilityEvent(mk("e3", alice));

    expect(await repo.reliabilityEventsFor(alice)).toHaveLength(2);
    expect(await repo.reliabilityEventsFor(bob)).toHaveLength(1);
  });

  it("returns clones — a caller cannot mutate the store by reference", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(brewBoat());

    const first = await repo.getVessel(asId<"VesselId">("vessel-brewboat"));
    first!.coiMaxPax = 12;

    const second = await repo.getVessel(asId<"VesselId">("vessel-brewboat"));
    expect(second?.coiMaxPax).toBe(6);
  });
});

// Suppress unused-type lints — these imports document the branded surface.
export type _Ids = [VesselId, CrewMemberId, ReliabilityEventId];
