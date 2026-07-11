import type { OtherShiftToday } from "@core/crewapp/other-shifts.js";
import { fmt12 } from "../../app/lib/format";

/**
 * "Other shifts today" (#315) — a no-JS `<details>` on the crew shift card that
 * lets a scheduled crew member see the rest of the day: which boats are out, when
 * they leave, and who's aboard. Comraderie + coordination, not a monitoring board
 * — so it's collapsed by default (the viewer's own shift is the headline) and
 * carries no state/scoreboard (DEC-042 calm posture). Names + boat + time only;
 * never other shifts' guests (the PII boundary lives in `otherShiftsOnDay`).
 *
 * Renders nothing when the viewer's is the only shift that day. A future
 * cohort-message button (its own issue) hangs off this list — the per-shift
 * `shiftId` is carried for it.
 */
export function OtherShiftsToday({ shifts }: { shifts: OtherShiftToday[] }) {
  if (shifts.length === 0) return null;
  return (
    <details className="rounded-card border border-line bg-card px-4 pb-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-muted">
        Other shifts today
        <span className="ml-1 font-normal text-faint">({shifts.length})</span>
      </summary>
      <div className="flex flex-col gap-2 pb-1">
        {shifts.map((s) => (
          <div
            key={s.shiftId}
            className="rounded-card border border-line bg-bg px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-ink">
                {s.vesselName}
              </span>
              <span className="shrink-0 font-mono text-sm text-muted">
                {s.firstDeparture ? fmt12(s.firstDeparture) : "—"}
              </span>
            </div>
            <div className="mt-0.5 text-sm text-muted">
              {s.crew.length === 0
                ? "Not crewed yet"
                : s.crew.map((c) => c.name).join(", ")}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
