/**
 * Pure derivation — deriveSeats (N-role) + deriveShiftState (DEC-005).
 * (Task 1.3 / M2.)
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { RoleTypeId, ShiftId } from "../domain/ids.js";
import type { Seat, Vessel } from "../domain/entities.js";
import { deriveSeats, deriveShiftState } from "./derive.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const DECKHAND = asId<"RoleTypeId">("role-deckhand");
const SHIFT = asId<"ShiftId">("shift-x");

const vessel = (manning: Vessel["manning"]): Vessel => ({
  id: asId<"VesselId">("vessel-x"),
  name: "X",
  coiMaxPax: 16,
  manning,
});

const seat = (role: RoleTypeId, state: Seat["state"], kind: Seat["kind"] = "required"): Seat => ({
  id: asId<"SeatId">(`seat-${role}-${state}`),
  shiftId: SHIFT,
  role,
  kind,
  state,
});

describe("deriveSeats", () => {
  it("iterates an N-role manning list (3 roles, 4 seats)", () => {
    const seats = deriveSeats(
      vessel([
        { roleTypeId: CAPTAIN, count: 1 },
        { roleTypeId: MATE, count: 1 },
        { roleTypeId: DECKHAND, count: 2 },
      ]),
      SHIFT,
    );
    expect(seats).toHaveLength(4);
    expect(seats.map((s) => s.role)).toEqual([CAPTAIN, MATE, DECKHAND, DECKHAND]);
    expect(seats.every((s) => s.kind === "required" && s.state === "Open")).toBe(true);
    // Deterministic, unique ids (stable across re-derive).
    expect(new Set(seats.map((s) => s.id)).size).toBe(4);
  });

  it("yields zero seats for a zero-crew vessel (self-captained rental)", () => {
    expect(deriveSeats(vessel([]), SHIFT)).toHaveLength(0);
  });
});

describe("deriveShiftState", () => {
  it("is Crewed (vacuously) when no required seats exist", () => {
    expect(deriveShiftState([])).toBe("Crewed");
    expect(deriveShiftState([seat(CAPTAIN, "Open", "supernumerary")])).toBe("Crewed");
  });

  it("is Pending when all required seats are Open", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Open"), seat(MATE, "Open")])).toBe("Pending");
  });

  it("is Filling when some required seat has progressed", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Asked"), seat(MATE, "Open")])).toBe("Filling");
    expect(deriveShiftState([seat(CAPTAIN, "Claimed"), seat(MATE, "Open")])).toBe("Filling");
  });

  it("is Crewed only when every required seat is Confirmed", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Confirmed")])).toBe("Crewed");
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Open")])).toBe("Filling");
  });

  it("is AtRisk when any required seat bailed (even if others confirmed)", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Bailed")])).toBe("AtRisk");
  });
});
