/**
 * Map a {@link FormResult}'s observed crew transitions to DEC-084 assignment-notice
 * changes: `cancelledCrew` → `"removed"` ("you're off"), `restoredCrew` → `"added"`
 * ("you're on"), `changedCrew` → `"changed"` ("your shift changed", #350). The
 * operator is never notified about crew-state changes they drove (DEC-072/084) —
 * excluded here by id.
 *
 * Pure + framework-free so it's unit-testable; the edge (`app/lib/channel`) wraps it
 * with the real channel + operator id. Shared by every place a `formShifts` runs and
 * its transitions must be relayed exactly once — the Xola pull AND the manual
 * split/merge commands (#259): each consumes the transition (writes the new state),
 * so this single mapping is the only relay chance.
 */

import type { AssignmentChange } from "../adapters/forward-notices.js";
import type { FormResult } from "./form-shifts.js";

export function formNoticeChanges(
  form: FormResult,
  operatorId: string,
): AssignmentChange[] {
  const notOperator = (id: string) => id !== operatorId;
  return [
    ...form.cancelledCrew
      .filter((c) => notOperator(String(c.crewMemberId)))
      .map((c) => ({
        crewMemberId: c.crewMemberId,
        action: "removed" as const,
        shiftId: c.shiftId,
      })),
    ...form.restoredCrew
      .filter((c) => notOperator(String(c.crewMemberId)))
      .map((c) => ({
        crewMemberId: c.crewMemberId,
        action: "added" as const,
        shiftId: c.shiftId,
      })),
    // #740: carry the diff through, don't re-derive it. `formShifts` held both trip sets at the
    // moment it decided something had changed; anything reconstructing that later is guessing
    // against a database that has already moved on.
    ...form.changedCrew
      .filter((c) => notOperator(String(c.crewMemberId)))
      .map((c) => ({
        crewMemberId: c.crewMemberId,
        action: "changed" as const,
        shiftId: c.shiftId,
        detail: {
          added: c.added,
          removed: c.removed,
          startBefore: c.startBefore,
          startAfter: c.startAfter,
        },
      })),
  ];
}
