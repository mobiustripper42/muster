/**
 * Vocabulary guards. The runtime assertions run under Vitest; the
 * `@ts-expect-error` lines are validated by `tsc --noEmit` (typecheck), which
 * fails the build if a reserved value ever leaks into a live union.
 */

import { describe, expect, it } from "vitest";
import { SEAT_STATES, SHIFT_STATES, TERMINAL_SHIFT_STATES } from "./states.js";
import { asId } from "./ids.js";
import type { SeatState, ShiftState } from "./states.js";
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

describe("TERMINAL_SHIFT_STATES (#926)", () => {
  /**
   * The pin is the PARTITION, not the contents. Asserting the set holds
   * `Completed` and `Cancelled` would only restate the declaration; this asserts
   * that the states NOT in it are exactly the ones the engine is allowed to work.
   *
   * So a seventh shift state fails here the day it is added, and stays failing
   * until someone decides which side of the line it sits on — which is the whole
   * reason the concept got a name instead of being spelled out fourteen times.
   */
  it("partitions SHIFT_STATES — every state is either terminal or one the engine may work", () => {
    // Declared BY HAND on purpose. Deriving it from the set would make the test
    // agree with any set, which is the failure mode being avoided.
    const ENGINE_MAY_WORK: ShiftState[] = ["Pending", "Filling", "Crewed", "AtRisk"];

    expect(SHIFT_STATES.filter((s) => !TERMINAL_SHIFT_STATES.has(s))).toEqual(ENGINE_MAY_WORK);

    // Coverage AND disjointness in one: if a state were on both sides the lengths
    // diverge, and if it were on neither it goes missing.
    expect([...ENGINE_MAY_WORK, ...TERMINAL_SHIFT_STATES].sort()).toEqual([...SHIFT_STATES].sort());
  });
});

describe("type-level guards (enforced by typecheck, not runtime)", () => {
  it("rejects the reserved Held seat state", () => {
    // @ts-expect-error — Held is reserved for Pass D; must not be assignable in v1.
    const held: SeatState = "Held";
    // The `@ts-expect-error` above IS the assertion: this fails the TYPECHECK the day
    // `"Held"` becomes assignable. The runtime line only gives the case a body, which is
    // why it is trivially true (#908).
    // eslint-disable-next-line sonarjs/no-trivial-assertions -- the typecheck is the assertion
    expect(typeof held).toBe("string");
  });

  it("keeps branded IDs from cross-assigning", () => {
    const vesselId: VesselId = asId<"VesselId">("v1");
    // @ts-expect-error — a VesselId is not a CrewMemberId despite both being strings.
    const crewId: CrewMemberId = vesselId;
    expect(typeof crewId).toBe("string");
  });
});
