import { confirmInto, overrideTo, reportBail } from "../../app/(admin)/admin/shift/[shiftId]/actions";
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
  roleName: string;
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
            className="rounded-full border border-ok-line bg-ok px-3 py-1 text-xs font-semibold text-white"
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
            <span className="flex gap-2">
              <a href={tel(vm.occupant.phone)} className="text-xs font-semibold text-accent">
                ✆ Call
              </a>
              <a href={sms(vm.occupant.phone)} className="text-xs font-semibold text-accent">
                ✉ Text
              </a>
            </span>
          )}
        </div>
        {/* #56 admin half (DEC-028): file the bail you heard about — same
            rail as the crew's own "can't make it"; also the override-mistake
            recovery. Deliberate friction: closed details + explicit button. */}
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            Reports a bail…
          </summary>
          <p className="py-1 text-xs text-muted">
            Logs that {vm.occupant.name} backed out: clears the seat and
            re-asks the next candidates — or the seat rests open if nobody’s
            left. Lateness counts from now.
          </p>
          <form action={reportBail} className="py-1">
            <HiddenIds vm={vm} />
            <button
              type="submit"
              className="rounded-full border border-bad-line bg-bad-bg px-2.5 py-1 text-xs font-medium text-bad"
            >
              Log the bail
            </button>
          </form>
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
  /** Whole active roster — the override picker's list (anyone, that's the point). */
  roster: { id: string; name: string }[];
}) {
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
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
          Manual override… <span>place anyone — backstop only</span>
        </summary>
        <p className="py-1 text-xs text-muted">
          Skips every check and confirms them straight into the seat. You are
          the authority; the pool above is the advice.
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
