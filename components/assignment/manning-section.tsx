import type { SeatKind } from "@core/domain/states.js";
import {
  addManningSeat,
  removeManningSeat,
  staffTrainee,
  unstaffTrainee,
} from "../../app/(admin)/admin/shift/[shiftId]/actions";
import { SubmitButton } from "../ui/submit-button";

export interface OverrideSeatVM {
  seatId: string;
  roleName: string;
  kind: SeatKind;
  occupied: boolean;
  /** Who's in it (staffed trainee / vacate-first required hand); null when Open. */
  occupantId: string | null;
  occupantName: string | null;
}

/**
 * Manning override (SPEC §2.3, 8.5) — adjust a shift's crew requirement beyond the
 * COI minimum. Add a required hand (gates `Crewed`) or a trainee that rides along
 * (takes a pax slot, doesn't gate); remove an added seat while it's still Open (an
 * occupied one is vacated first via the seat card above). No client JS — plain forms
 * → server actions → redirect (DEC-026). The COI-derived seats aren't shown here;
 * these are the additive overrides only. `ctx` marks the pane host (DEC-085) so the
 * actions redirect back to the right surface.
 */
export function ManningSection({
  shiftId,
  ctx,
  overrideSeats,
  roleOptions,
  traineeOptions,
}: {
  shiftId: string;
  ctx: string | null;
  overrideSeats: OverrideSeatVM[];
  roleOptions: { id: string; name: string }[];
  /** Trainee-eligible crew (DEC-087 rule set, operator excluded) for the
   *  staff picker on each unstaffed trainee line. */
  traineeOptions: { id: string; name: string }[];
}) {
  const hostCtx =
    ctx !== null ? <input type="hidden" name="ctx" value={ctx} /> : null;
  // Each select gets its own accessible name via a wrapping label (WCAG 4.1.2,
  // 9.7 — the Split form idiom); sr-only text keeps the visual row compact and
  // the two same-named selects distinct to AT.
  const rolePicker = (label: string) => (
    <label className="flex items-center">
      <span className="sr-only">{label}</span>
      <select
        name="role"
        className="min-h-9 rounded-lg border border-line bg-bg px-2 py-1 text-ink"
      >
        {roleOptions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted">
          Manning
        </h2>
        <p className="text-xs text-muted">
          Extra hands beyond the COI minimum. A required hand gates crewing; a trainee
          rides along — takes a pax slot, doesn’t gate.
        </p>
      </div>

      {overrideSeats.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {overrideSeats.map((s) => (
            <li
              key={s.seatId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-ink">
                +1 {s.roleName}
                {s.kind === "supernumerary" && (
                  <span className="text-muted"> · trainee</span>
                )}
              </span>
              {s.occupied && s.kind === "supernumerary" && s.occupantId ? (
                // A staffed trainee (9.3, DEC-087) — supernumerary seats have no
                // seat card, so THIS line owns the unstaff (no penalty, no
                // re-ask; they get the DEC-084 "you're off" notice).
                <form action={unstaffTrainee} className="flex items-center gap-2">
                  <input type="hidden" name="shiftId" value={shiftId} />
                  <input type="hidden" name="seatId" value={s.seatId} />
                  <input type="hidden" name="crewMemberId" value={s.occupantId} />
                  {hostCtx}
                  <span className="text-xs text-muted">{s.occupantName ?? "riding"}</span>
                  <SubmitButton className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-accent">
                    Take off seat
                  </SubmitButton>
                </form>
              // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
              ) : s.occupied ? (
                <span className="text-xs text-muted">occupied — vacate to remove</span>
              // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
              ) : s.kind === "supernumerary" ? (
                // Unstaffed trainee seat: name a person so Muster can reach them
                // (my-shifts, threads, the DEC-084 notice). Picker scope is the
                // DEC-087 trainee rule set; the action re-checks server-side.
                <span className="flex items-center gap-2">
                  {traineeOptions.length === 0 ? (
                    <span className="text-xs text-muted">
                      nobody eligible to ride this day
                    </span>
                  ) : (
                    <form action={staffTrainee} className="flex items-center gap-1.5">
                      <input type="hidden" name="shiftId" value={shiftId} />
                      <input type="hidden" name="seatId" value={s.seatId} />
                      {hostCtx}
                      <label className="flex items-center">
                        <span className="sr-only">Trainee for this seat</span>
                        <select
                          name="crewMemberId"
                          className="min-h-9 rounded-lg border border-line bg-bg px-2 py-1 text-ink"
                        >
                          {traineeOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton className="min-h-9 rounded-lg border border-line bg-bg px-3 py-1 text-xs font-semibold text-accent">
                        Assign
                      </SubmitButton>
                    </form>
                  )}
                  <form action={removeManningSeat}>
                    <input type="hidden" name="shiftId" value={shiftId} />
                    <input type="hidden" name="seatId" value={s.seatId} />
                    {hostCtx}
                    <SubmitButton className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-accent">
                      Remove
                    </SubmitButton>
                  </form>
                </span>
              ) : (
                <form action={removeManningSeat}>
                  <input type="hidden" name="shiftId" value={shiftId} />
                  <input type="hidden" name="seatId" value={s.seatId} />
                  {hostCtx}
                  {/* min-h-9 + padding: real tap target (9.7) — operator's on a phone. */}
                  <SubmitButton className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-accent">
                    Remove
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-2 text-sm">
        <form action={addManningSeat} className="flex items-center gap-1.5">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="kind" value="required" />
          {hostCtx}
          {rolePicker("Role for the required hand")}
          <SubmitButton className="min-h-9 rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent">
            + Required hand
          </SubmitButton>
        </form>
        <form action={addManningSeat} className="flex items-center gap-1.5">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="kind" value="supernumerary" />
          {hostCtx}
          {rolePicker("Role for the trainee seat")}
          <SubmitButton className="min-h-9 rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent">
            + Trainee seat
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}
