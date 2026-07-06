import { describe, it, expect } from "vitest";
import { formNoticeChanges } from "./form-notices.js";
import type { FormResult } from "./form-shifts.js";
import { asId } from "../domain/ids.js";

const S = (n: string) => asId<"ShiftId">(n);
const C = (n: string) => asId<"CrewMemberId">(n);
const OP = "crew-operator";

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
    ...over,
  };
}

describe("formNoticeChanges (DEC-084 transition → notice mapping)", () => {
  it("maps cancelledCrew → removed and restoredCrew → added", () => {
    const changes = formNoticeChanges(
      form({
        cancelledCrew: [{ shiftId: S("shift-1"), crewMemberId: C("crew-a") }],
        restoredCrew: [{ shiftId: S("shift-2"), crewMemberId: C("crew-b") }],
      }),
      OP,
    );
    expect(changes).toEqual([
      { crewMemberId: "crew-a", action: "removed", shiftId: "shift-1" },
      { crewMemberId: "crew-b", action: "added", shiftId: "shift-2" },
    ]);
  });

  it("excludes the operator from both directions (DEC-072/084)", () => {
    const changes = formNoticeChanges(
      form({
        cancelledCrew: [
          { shiftId: S("shift-1"), crewMemberId: C(OP) },
          { shiftId: S("shift-1"), crewMemberId: C("crew-a") },
        ],
        restoredCrew: [{ shiftId: S("shift-2"), crewMemberId: C(OP) }],
      }),
      OP,
    );
    expect(changes).toEqual([
      { crewMemberId: "crew-a", action: "removed", shiftId: "shift-1" },
    ]);
  });

  it("is empty when the form observed no transitions", () => {
    expect(formNoticeChanges(form({}), OP)).toEqual([]);
  });
});
