import type { SeatCardView } from "@core/asks/assignment-view.js";
import type { CandidateVM, SeatCardVM } from "./seat-card";

/** Pure view helpers for the cockpit body (shift-cockpit.tsx) — VM mapping,
 * time/date labels, and the state badge. No data access, no forms. */

/** Map a core seat card to the component VM — actions only where the domain accepts. */
export function toSeatVM(
  s: SeatCardView,
  shiftId: string,
  ctx: string | null,
  seatOccupant: Map<string, string>,
  crew: Map<string, { name: string; phone: string | null }>,
): SeatCardVM {
  const canAct = s.state === "Open" || s.state === "Bailed";
  const occupantId = seatOccupant.get(String(s.seatId));
  const occ = occupantId ? crew.get(occupantId) : undefined;
  return {
    seatId: String(s.seatId),
    shiftId,
    ctx,
    roleName: s.roleName,
    role: String(s.role),
    state: s.state,
    occupant: occ ? { name: occ.name, phone: occ.phone } : null,
    pool:
      s.pool?.map((c): CandidateVM => {
        const action = !canAct
          ? null
          : c.status === "available"
            ? "assign"
            : c.status === "declined" || c.status === "silent"
              ? "nudge"
              : null;
        return {
          id: String(c.crewMemberId),
          name: c.name,
          status: c.status,
          replyLabel:
            c.replyMs === undefined ? null : `replied in ${replyLabel(c.replyMs)}`,
          action,
        };
      }) ?? null,
  };
}

function replyLabel(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : `${m}m`;
}

export function ttLabel(h: number): string {
  // Floor the minor unit — Math.round would mint "23h 60m" / "1d 24h".
  if (h < 24) {
    const whole = Math.floor(h);
    const m = Math.floor((h - whole) * 60);
    return `${whole}h ${String(m).padStart(2, "0")}m`;
  }
  return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
}

export function fmtDate(iso: string): string {
  // Date-only label: UTC both ends so the stored vessel-local date shows
  // verbatim regardless of server zone (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const BADGE_TONE: Record<string, string> = {
  AtRisk: "border-bad-line bg-bad-bg text-bad",
  Filling: "border-warn-line bg-warn-bg text-warn",
  Crewed: "border-ok-line bg-ok-bg text-ok",
};

export function Badge({ state }: { state: string }) {
  const cls = BADGE_TONE[state] ?? "border-line bg-bg text-muted";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {state === "AtRisk" ? "At-Risk" : state}
    </span>
  );
}
