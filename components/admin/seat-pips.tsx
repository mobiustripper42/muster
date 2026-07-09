import type { AllShiftsSeat } from "@core/admin/all-shifts.js";
import { roleHueClass } from "../assignment/role-hue";

/**
 * Seat pips (9.6 — the reconciliation's density adopt, minus the mockup's
 * DEC-042-forbidden state colors). One pip per seat: role initial, filled
 * (Confirmed) vs open outline, dashed "+" for a trainee. Required seats lead,
 * trainees trail (the core ships them sorted role → kind).
 *
 * A FILLED pip wears its DEC-086 role hue (operator call, 2026-07-04) —
 * matching the cockpit's RoleGlyph: a captain-blue/mate-teal square means "a
 * person of that role, aboard." That's identity color, not state color: the
 * state stays in fill-vs-outline (open = light outline grey, so gaps still
 * jump), and warm/bad status tones never appear here. A filled trainee stays
 * FAINT — a rider shouldn't read with required-crew weight. The row's state +
 * fill text stay the accessible facts (`aria-hidden` + sr-only summary).
 */
/**
 * Assigned crew (#310) — the names behind the filled pips, so the operator can
 * scan who's on each shift, not just how many. Full names, `·`-separated, in the
 * SAME role→kind order as the pips they sit beside (operator call — Variant C):
 * pip order carries "who's the captain", so no visible role prefix. Open seats
 * contribute nothing (the pips show the gap). Muted — a fact to scan, not a
 * status signal (DEC-042). A screen-reader-only role keeps the name→role link.
 */
export function AssignedCrew({ seats }: { seats: AllShiftsSeat[] }) {
  const filled = seats.filter((s) => s.filled && s.crewName);
  if (filled.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
      {filled.map((s, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 && (
            <span aria-hidden="true" className="text-faint">
              ·{" "}
            </span>
          )}
          <span className="sr-only">{s.roleName} </span>
          {s.crewName}
        </span>
      ))}
    </span>
  );
}

export function SeatPips({ seats }: { seats: AllShiftsSeat[] }) {
  if (seats.length === 0) return null;
  const required = seats.filter((s) => !s.supernumerary);
  const trainees = seats.filter((s) => s.supernumerary);
  // The pips are sighted-density; this summary is the SAME per-role facts for
  // AT — the aggregate "X/Y crewed" alone doesn't say which role is open or
  // that a trainee rides along.
  const summary = seats
    .map(
      (s) =>
        `${s.roleName}${s.supernumerary ? " trainee" : ""} ${s.filled ? "filled" : "open"}`,
    )
    .join(", ");
  return (
    <>
      <span className="sr-only">Seats: {summary}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        {required.map((s, i) => (
          <span
            key={i}
            title={`${s.roleName} · ${s.filled ? "filled" : "open"}`}
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border text-[10px] font-bold uppercase ${
              s.filled
                ? `border-transparent text-white ${roleHueClass(s.roleName)}`
                : "border-line bg-bg text-muted"
            }`}
          >
            {s.roleName.charAt(0)}
          </span>
        ))}
        {trainees.map((s, i) => (
          <span
            key={`t-${i}`}
            title={`${s.roleName} · trainee · ${s.filled ? "filled" : "open"}`}
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-dashed text-[10px] font-bold ${
              s.filled
                ? "border-faint bg-faint text-white"
                : "border-faint bg-card text-faint"
            }`}
          >
            +
          </span>
        ))}
      </span>
    </>
  );
}
