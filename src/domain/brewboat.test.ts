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
  VesselId,
} from "./ids.js";
import type { CrewMember, Vessel } from "./entities.js";
import type { ReliabilityEvent } from "./reliability.js";

const brewBoat = (): Vessel => ({
  id: asId<"VesselId">("vessel-brewboat"),
  name: "BrewBoat",
  coiMaxPax: 6,
  manning: { captain: 1, mate: 1 },
});

const aCaptain = (): CrewMember => ({
  id: asId<"CrewMemberId">("crew-spink"),
  name: "Spink",
  phone: "+15035550100",
  ratings: ["captain"],
  status: "active",
  reliabilityScore: null, // cold start — no history yet, not a misleading low
});

describe("BrewBoat spine (Phase 0 demo gate)", () => {
  it("persists the BrewBoat vessel with COI max-pax 6 and 1+1 manning", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel(brewBoat());

    const loaded = await repo.getVessel(asId<"VesselId">("vessel-brewboat"));
    expect(loaded).not.toBeNull();
    expect(loaded?.coiMaxPax).toBe(6);
    expect(loaded?.manning).toEqual({ captain: 1, mate: 1 });
  });

  it("persists a crew member at cold-start standing", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(aCaptain());

    const loaded = await repo.getCrewMember(asId<"CrewMemberId">("crew-spink"));
    expect(loaded?.ratings).toContain("captain");
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
