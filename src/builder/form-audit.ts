/**
 * Map a {@link FormResult}'s observed crew transitions to DEC-118 audit rows —
 * the audit sibling of {@link formNoticeChanges}. Where the notice mapping answers
 * "who do we text," this answers "what do we record in the crew audit trail":
 *   `changedCrew`   → `shift_changed` (an import moved a surviving shift's trips, #353)
 *   `cancelledCrew` → `crew_removed`  (the shift cancelled out from under them —
 *                     all events cancelled or relocated to another boat)
 *   `restoredCrew`  → `crew_added`    (a cancelled shift's trips returned, #244)
 *
 * The three transition sets are disjoint by construction (form-shifts), so no crew
 * member double-logs for one run. Unlike the notice mapping, the operator is NOT
 * excluded — the audit records who-did-what-to-whom regardless of who drove it
 * (parity with the existing `changedCrew` audit, which never excluded the operator).
 *
 * Pure + framework-free so it's unit-testable; the edge (`app/(admin)/admin/import`)
 * wraps it with the real repo, the `importer:xola` actor, and the run id. This exists
 * because the `crew_removed` on an import-cancel was previously never written — the
 * "you're off" SMS fired, an admin vacate logged `crew_removed`, but the import-cancel
 * path logged nothing, so the removal left no trace in the audit.
 */

import type { AuditEventType } from "../domain/audit.js";
import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { FormResult } from "./form-shifts.js";

export type CrewAuditType = Extract<
  AuditEventType,
  "crew_added" | "crew_removed" | "shift_changed"
>;

export interface AuditChange {
  crewMemberId: CrewMemberId;
  shiftId: ShiftId;
  type: CrewAuditType;
}

export function formAuditChanges(form: FormResult): AuditChange[] {
  return [
    // Project the three declared fields rather than spreading (#740). `changedCrew` entries now
    // also carry the diff, and `...c` would silently widen every audit row the moment a field is
    // added upstream — the audit row's shape should change when someone decides it should, not as
    // a side effect of an unrelated addition three files away.
    ...form.changedCrew.map(({ crewMemberId, shiftId }) => ({
      crewMemberId,
      shiftId,
      type: "shift_changed" as const,
    })),
    ...form.cancelledCrew.map(({ crewMemberId, shiftId }) => ({
      crewMemberId,
      shiftId,
      type: "crew_removed" as const,
    })),
    ...form.restoredCrew.map(({ crewMemberId, shiftId }) => ({
      crewMemberId,
      shiftId,
      type: "crew_added" as const,
    })),
  ];
}
