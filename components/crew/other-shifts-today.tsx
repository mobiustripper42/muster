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
    <details className="group rounded-card border border-line bg-card px-4 pb-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-sm font-semibold text-muted [&::-webkit-details-marker]:hidden">
        <span>
          Other shifts today
          <span className="ml-1 font-normal text-faint">({shifts.length})</span>
        </span>
        {/* Same caret idiom as the Manifest above (rotates right→down on open). */}
        <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-2 pb-1">
        {shifts.map((s) => (
          <div
            key={s.shiftId}
            className="rounded-card border border-line bg-bg px-3 py-2"
          >
            {/* items-start (not baseline): the stacked time+trips on the right
                would otherwise pull the boat name off a shared baseline. */}
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-ink">
                {s.vesselName}
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span className="font-mono text-sm text-ink">
                  {s.firstDeparture ? fmt12(s.firstDeparture) : "—"}
                </span>
                {s.tripCount > 1 && (
                  <span className="font-mono text-xs text-faint">
                    {s.tripCount} trips
                  </span>
                )}
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
