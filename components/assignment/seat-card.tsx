import { confirmInto, overrideTo, removeSeat, reportBail } from "../../app/(admin)/admin/shift/[shiftId]/actions";
import { HiddenIds, MiniButton } from "./bits";
import { askedSummary, CandidateRow } from "./candidate-row";

/**
 * One cockpit seat card (SPEC §2.4, #54) — sub-state + occupant zone, the
 * ranked pool with per-candidate ask status (see candidate-row.tsx), and the
 * manual actions. Server component — pools and the override picker are
 * <details>, forms post server actions, no client JS (DEC-026 pattern).
 *
 * Calm monitor posture: an Asked seat shows its pool as status only (people
 * mid-decision are the system working — no buttons to mash); action buttons
 * appear only where the domain would accept them (Open/Bailed seats, and the
 * Claimed confirm). The board lesson: never render a button the action refuses.
 */

export interface CandidateVM {
  id: string;
  name: string;
  status: "available" | "asked" | "in" | "declined" | "silent" | "bailed";
  /** "replied in 4m" — present when they answered. */
  replyLabel: string | null;
  /** Which form this row offers — null on a monitor-only row. */
  action: "assign" | "nudge" | null;
}

export interface SeatCardVM {
  seatId: string;
  shiftId: string;
  /** Board filter query string when the cockpit is hosted in the board pane
   *  (DEC-085) — rides every action form so the redirect returns to the pane.
   *  Null when the standalone route is the host. */
  ctx: string | null;
  roleName: string;
  /** The seat's role id — scopes the override picker to rated crew (DEC-064). */
  role: string;
  state: "Open" | "Asked" | "Claimed" | "Confirmed" | "Bailed";
  occupant: { name: string; phone: string | null } | null;
  /** Present on Open/Asked/Bailed seats; null on Claimed/Confirmed. */
  pool: CandidateVM[] | null;
}

const STATE_TONE: Record<SeatCardVM["state"], string> = {
  Open: "border-line bg-bg text-muted",
  Asked: "border-line bg-bg text-accent",
  Claimed: "border-warn-line bg-warn-bg text-warn",
  Confirmed: "border-ok-line bg-ok-bg text-ok",
  Bailed: "border-bad-line bg-bad-bg text-bad",
};

const tel = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
const sms = (p: string) => `sms:${p.replace(/[^0-9+]/g, "")}`;

import { roleHueClass } from "./role-hue";

/** The role glyph pip (9.8, DEC-086) — identity color + initial; decorative
 *  (the kicker text right beside it is the accessible name). Shares its hue
 *  map with the board's filled pips (role-hue.ts). */
function RoleGlyph({ roleName }: { roleName: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-white ${roleHueClass(roleName)}`}
    >
      {roleName.charAt(0)}
    </span>
  );
}

/** The state-conditional occupant zone. */
function OccupantZone({ vm }: { vm: SeatCardVM }) {
  if (vm.state === "Claimed" && vm.occupant) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2">
        <span className="text-sm text-ink">
          <b>{vm.occupant.name}</b>
          <span className="text-warn"> · accepted — awaiting your confirm</span>
        </span>
        <form action={confirmInto} className="inline-flex">
          <HiddenIds vm={vm} />
          <button
            type="submit"
            className="min-h-9 rounded-full border border-ok-line bg-ok px-3 py-1 text-xs font-semibold text-white"
          >
            Confirm into seat
          </button>
        </form>
      </div>
    );
  }
  if (vm.state === "Confirmed" && vm.occupant) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-ok-line bg-ok-bg px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{vm.occupant.name}</span>
          {vm.occupant.phone && (
            <span className="flex gap-1">
              <a
                href={tel(vm.occupant.phone)}
                className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
              >
                <span aria-hidden="true">✆&nbsp;</span>Call
              </a>
              <a
                href={sms(vm.occupant.phone)}
                className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
              >
                <span aria-hidden="true">✉&nbsp;</span>Text
              </a>
            </span>
          )}
        </div>
        {/* #87: two ways to clear a confirmed seat, split by whether a
            reliability bail is logged. Remove = misassignment, no penalty
            (vacateSeat). Bailed = crew actually backed out, logs lateness
            (reportBail/DEC-028). Explicit choice, never a default — a wrong
            default starves the reliability log or wrongly penalizes. */}
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            Remove from shift…
          </summary>
          <p className="py-1 text-xs text-muted">
            Wrong person in the seat? <b>Remove</b> — no penalty. {vm.occupant.name}{" "}
            actually can&rsquo;t make it? <b>Bailed</b> — logs a late bail against
            their record. Either way the seat reopens and re-asks.
          </p>
          <div className="flex flex-wrap gap-2 py-1">
            <form action={removeSeat} className="inline-flex">
              <HiddenIds vm={vm} />
              <button
                type="submit"
                className="min-h-9 rounded-full border border-line bg-bg px-3 py-1 text-xs font-medium text-muted"
              >
                Remove
              </button>
            </form>
            <form action={reportBail} className="inline-flex">
              <HiddenIds vm={vm} />
              <button
                type="submit"
                className="min-h-9 rounded-full border border-bad-line bg-bad-bg px-3 py-1 text-xs font-medium text-bad"
              >
                Bailed
              </button>
            </form>
          </div>
        </details>
      </div>
    );
  }
  if (vm.state === "Bailed") {
    return (
      <div className="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad">
        Crew bailed with nobody left to re-ask at the time.
      </div>
    );
  }
  return null;
}

export function SeatCard({
  vm,
  roster,
}: {
  vm: SeatCardVM;
  /** Override picker's list — crew **rated for this seat's role** (DEC-064: a
   *  mate can't be placed as captain; the page scopes this per seat). */
  roster: { id: string; name: string }[];
}) {
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
          <RoleGlyph roleName={vm.roleName} />
          {vm.roleName} · required
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATE_TONE[vm.state]}`}
        >
          {vm.state}
        </span>
      </div>

      <OccupantZone vm={vm} />

      {vm.pool && (
        <details open={vm.state !== "Asked"} className="border-t border-line pt-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted">
            Eligible pool · {vm.pool.length}
            {vm.state === "Asked" && askedSummary(vm.pool)}
          </summary>
          {vm.pool.length === 0 ? (
            <p className="py-1 text-sm text-muted">
              Nobody eligible for this seat right now.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line/60">
              {vm.pool.map((c) => (
                <CandidateRow key={c.id} vm={vm} c={c} />
              ))}
            </ul>
          )}
        </details>
      )}

      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer text-xs text-muted">
          Manual override
        </summary>
        <p className="py-1 text-xs text-muted">
          Skips the queue and confirms them for the shift. Only crew rated for
          this role appear.
        </p>
        <ul className="flex flex-wrap gap-2 py-1">
          {roster.map((p) => (
            <li key={p.id}>
              <form action={overrideTo} className="inline-flex">
                <HiddenIds vm={vm} crewId={p.id} />
                <MiniButton label={`Place ${p.name}`} />
              </form>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
