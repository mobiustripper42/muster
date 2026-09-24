import { describe, it, expect } from "vitest";
import { formNoticeChanges } from "./form-notices.js";
import type { FormResult } from "./form-shifts.js";
import { asId } from "../domain/ids.js";

const S = (n: string) => asId<"ShiftId">(n);
const C = (n: string) => asId<"CrewMemberId">(n);
const E = (n: string) => asId<"EventId">(n);
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
    changedCrew: [],
    failures: [],
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
    );
    expect(changes).toEqual([
      { crewMemberId: "crew-a", action: "removed", shiftId: "shift-1" },
      { crewMemberId: "crew-b", action: "added", shiftId: "shift-2" },
    ]);
  });

  it("tells the operator like anyone else, both directions (issue #1009)", () => {
    // The operator is staff: they hold seats and work shifts. DEC-084's own principle is that a
    // crew member put on or taken off a shift always gets a message — no identity carve-out.
    const changes = formNoticeChanges(
      form({
        cancelledCrew: [
          { shiftId: S("shift-1"), crewMemberId: C(OP) },
          { shiftId: S("shift-1"), crewMemberId: C("crew-a") },
        ],
        restoredCrew: [{ shiftId: S("shift-2"), crewMemberId: C(OP) }],
      }),
    );
    expect(changes).toEqual([
      { crewMemberId: OP, action: "removed", shiftId: "shift-1" },
      { crewMemberId: "crew-a", action: "removed", shiftId: "shift-1" },
      { crewMemberId: OP, action: "added", shiftId: "shift-2" },
    ]);
  });

  it("maps changedCrew → changed, the operator included (#350, issue #1009)", () => {
    const diff = {
      added: [],
      removed: [],
      startBefore: null,
      startAfter: null,
    };
    const changes = formNoticeChanges(
      form({
        changedCrew: [
          { shiftId: S("shift-1"), crewMemberId: C("crew-a"), ...diff },
          { shiftId: S("shift-1"), crewMemberId: C(OP), ...diff },
        ],
      }),
    );
    expect(changes).toEqual([
      { crewMemberId: "crew-a", action: "changed", shiftId: "shift-1", detail: diff },
      { crewMemberId: OP, action: "changed", shiftId: "shift-1", detail: diff },
    ]);
  });

  it("carries the diff through to the notice, not just the fact of one (#740)", () => {
    // The whole point of #740: the comparison that proved a change existed used to stop here.
    // Everything downstream then described a change it could no longer see.
    const changes = formNoticeChanges(
      form({
        changedCrew: [
          {
            shiftId: S("shift-1"),
            crewMemberId: C("crew-a"),
            added: [E("trip-new")],
            removed: [E("trip-gone")],
            startBefore: "2026-05-16T19:30:00.000Z",
            startAfter: "2026-05-16T18:00:00.000Z",
          },
        ],
      }),
    );
    expect(changes[0]!.detail).toEqual({
      added: ["trip-new"],
      removed: ["trip-gone"],
      startBefore: "2026-05-16T19:30:00.000Z",
      startAfter: "2026-05-16T18:00:00.000Z",
    });
  });

  it("is empty when the form observed no transitions", () => {
    expect(formNoticeChanges(form({}))).toEqual([]);
  });
});
