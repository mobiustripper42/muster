import { describe, it, expect } from "vitest";
import { formAuditChanges } from "./form-audit.js";
import type { FormResult } from "./form-shifts.js";
import { asId } from "../domain/ids.js";

const S = (n: string) => asId<"ShiftId">(n);
const C = (n: string) => asId<"CrewMemberId">(n);

/** A zeroed FormResult with only the transition lists filled in. */
function form(over: Partial<FormResult>): FormResult {
  return {
    shiftsCreated: 0,
    shiftsUpdated: 0,
    seatsCreated: 0,
    seatsPruned: 0,
    seatsStranded: 0,
    shiftsCancelled: 0,
    createdShiftIds: [],
    cancelledShiftIds: [],
    splitDaysChanged: [],
    cancelledCrew: [],
    restoredCrew: [],
    changedCrew: [],
    ...over,
  };
}

describe("formAuditChanges (DEC-118 transition → audit mapping)", () => {
  it("maps cancelledCrew → crew_removed — the gap this closes", () => {
    // A boat reassignment cancels the old vessel-day and drops its crew. Before
    // this mapping the removal fired an SMS but wrote no audit row.
    const changes = formAuditChanges(
      form({
        cancelledCrew: [{ shiftId: S("shift-brew-4-2026-07-19"), crewMemberId: C("crew-eric") }],
      }),
    );
    expect(changes).toEqual([
      { crewMemberId: "crew-eric", shiftId: "shift-brew-4-2026-07-19", type: "crew_removed" },
    ]);
  });

  it("maps restoredCrew → crew_added and changedCrew → shift_changed", () => {
    const changes = formAuditChanges(
      form({
        restoredCrew: [{ shiftId: S("shift-2"), crewMemberId: C("crew-b") }],
        changedCrew: [{ shiftId: S("shift-3"), crewMemberId: C("crew-c") }],
      }),
    );
    expect(changes).toContainEqual({
      crewMemberId: "crew-b",
      shiftId: "shift-2",
      type: "crew_added",
    });
    expect(changes).toContainEqual({
      crewMemberId: "crew-c",
      shiftId: "shift-3",
      type: "shift_changed",
    });
  });

  it("emits every transition set in one pass, no dropped rows", () => {
    const changes = formAuditChanges(
      form({
        changedCrew: [{ shiftId: S("s1"), crewMemberId: C("a") }],
        cancelledCrew: [{ shiftId: S("s2"), crewMemberId: C("b") }],
        restoredCrew: [{ shiftId: S("s3"), crewMemberId: C("c") }],
      }),
    );
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.type).sort()).toEqual([
      "crew_added",
      "crew_removed",
      "shift_changed",
    ]);
  });

  it("no transitions → no audit rows", () => {
    expect(formAuditChanges(form({}))).toEqual([]);
  });
});
