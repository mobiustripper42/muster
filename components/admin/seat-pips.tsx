import type { AllShiftsSeat } from "@core/admin/all-shifts.js";

/**
 * Neutral-ink seat pips (9.6 — the reconciliation's density adopt, minus the
 * mockup's DEC-042-forbidden state colors). One pip per seat: role initial,
 * filled (Confirmed) vs open outline, dashed "+" for a trainee. Required seats
 * lead, trainees trail (the core ships them sorted role → kind).
 *
 * Strictly ink/line/faint tokens — a pip must never read as a status badge; the
 * row's state + fill text stay the accessible facts (`aria-hidden` here, the
 * 9.8 decorative-glyph rule).
 */
export function SeatPips({ seats }: { seats: AllShiftsSeat[] }) {
  if (seats.length === 0) return null;
  const required = seats.filter((s) => !s.supernumerary);
  const trainees = seats.filter((s) => s.supernumerary);
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {required.map((s, i) => (
        <span
          key={i}
          title={`${s.roleName} · ${s.filled ? "filled" : "open"}`}
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border text-[10px] font-bold uppercase ${
            s.filled
              ? "border-muted bg-muted text-white"
              : "border-line bg-bg text-muted"
          }`}
        >
          {s.roleName.charAt(0)}
        </span>
      ))}
      {trainees.map((s, i) => (
        <span
          key={`t-${i}`}
          title={`${s.roleName} · trainee`}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-dashed border-faint bg-card text-[10px] font-bold text-faint"
        >
          +
        </span>
      ))}
    </span>
  );
}
