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
  // The two actions accept DIFFERENT seat states, so they get separate gates (#601).
  // One shared `canAct` was the bug: widening it to include `Asked` switched on BOTH
  // buttons, but "Ask to fill" → `assignFromPool` still refuses a non-gap seat
  // (`lean.ts:204`), so it rendered and then errored. The file's rule is never render
  // a button the action refuses — which only holds if each gate mirrors its own action.
  //
  //  - assign ("Ask to fill") → `assignFromPool`: Open | Bailed.
  //  - nudge  ("Nudge")       → `lean`: Open | Bailed | Asked. `Asked` is the NORMAL
  //    state of a filling seat under the DEC-063 drip, so excluding it left the
  //    cockpit read-only for most of the fill window — least actionable exactly when
  //    the operator is watching, because the deadline had passed.
  //
  // Settled seats (Claimed/Confirmed) offer neither — somebody holds them.
  const canAssign = s.state === "Open" || s.state === "Bailed";
  const canNudge = canAssign || s.state === "Asked";
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
        // An un-asked candidate on an `Asked` seat is nudge-able, not assign-able:
        // `lean()` takes them (they hold no live ask, so its double-ask guard passes),
        // while `assignFromPool` would refuse the seat itself.
        const action =
          c.status === "available"
            ? canAssign
              ? "assign"
              : canNudge
                ? "nudge"
                : null
            : c.status === "declined" || c.status === "silent"
              ? canNudge
                ? "nudge"
                : null
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
