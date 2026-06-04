/**
 * Vocabulary guards. The runtime assertions run under Vitest; the
 * `@ts-expect-error` lines are validated by `tsc --noEmit` (typecheck), which
 * fails the build if a reserved value ever leaks into a live union.
 */

import { describe, expect, it } from "vitest";
import { SEAT_STATES, SHIFT_STATES } from "./states.js";
import { asId } from "./ids.js";
import type { SeatState } from "./states.js";
import type { CrewMemberId, VesselId } from "./ids.js";

describe("state vocabularies", () => {
  it("ships the six shift states, no more", () => {
    expect([...SHIFT_STATES]).toEqual([
      "Pending",
      "Filling",
      "Crewed",
      "AtRisk",
      "Completed",
      "Cancelled",
    ]);
  });

  it("ships the five live seat states — Held is reserved, not present (DEC-005)", () => {
    expect([...SEAT_STATES]).toEqual([
      "Open",
      "Asked",
      "Claimed",
      "Confirmed",
      "Bailed",
    ]);
    expect(SEAT_STATES).not.toContain("Held");
  });
});

describe("type-level guards (enforced by typecheck, not runtime)", () => {
  it("rejects the reserved Held seat state", () => {
    // @ts-expect-error — Held is reserved for Pass D; must not be assignable in v1.
    const held: SeatState = "Held";
    expect(typeof held).toBe("string");
  });

  it("keeps branded IDs from cross-assigning", () => {
    const vesselId: VesselId = asId<"VesselId">("v1");
    // @ts-expect-error — a VesselId is not a CrewMemberId despite both being strings.
    const crewId: CrewMemberId = vesselId;
    expect(typeof crewId).toBe("string");
  });
});
