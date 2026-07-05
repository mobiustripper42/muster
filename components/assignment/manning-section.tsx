import type { SeatKind } from "@core/domain/states.js";
import {
  addManningSeat,
  removeManningSeat,
} from "../../app/(admin)/admin/shift/[shiftId]/actions";

export interface OverrideSeatVM {
  seatId: string;
  roleName: string;
  kind: SeatKind;
  occupied: boolean;
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
}: {
  shiftId: string;
  ctx: string | null;
  overrideSeats: OverrideSeatVM[];
  roleOptions: { id: string; name: string }[];
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
              {s.occupied ? (
                <span className="text-xs text-muted">occupied — vacate to remove</span>
              ) : (
                <form action={removeManningSeat}>
                  <input type="hidden" name="shiftId" value={shiftId} />
                  <input type="hidden" name="seatId" value={s.seatId} />
                  {hostCtx}
                  {/* min-h-9 + padding: real tap target (9.7) — operator's on a phone. */}
                  <button
                    type="submit"
                    className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-accent"
                  >
                    Remove
                  </button>
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
          <button
            type="submit"
            className="min-h-9 rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent"
          >
            + Required hand
          </button>
        </form>
        <form action={addManningSeat} className="flex items-center gap-1.5">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="kind" value="supernumerary" />
          {hostCtx}
          {rolePicker("Role for the trainee seat")}
          <button
            type="submit"
            className="min-h-9 rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent"
          >
            + Trainee seat
          </button>
        </form>
      </div>
    </section>
  );
}
