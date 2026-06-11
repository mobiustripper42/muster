import { assignTo, confirmInto, nudgeOn, overrideTo } from "../../app/(admin)/admin/shift/[shiftId]/actions";

/**
 * One cockpit seat card (SPEC §2.4, #54) — sub-state + occupant zone, the
 * ranked pool with per-candidate ask status (silent ≠ declined, the binding
 * constraint: the ghost gets the loud treatment), and the manual actions.
 * Server component — pools and the override picker are <details>, forms post
 * server actions, no client JS (DEC-026 pattern).
 *
 * Calm monitor posture: an Asked seat shows its pool as status only (people
 * mid-decision are the system working — no buttons to mash); action buttons
 * appear only where the domain would accept them (Open/Bailed seats, and the
 * Claimed confirm). The board lesson: never render a button the action refuses.
 */

export interface CandidateVM {
  id: string;
  name: string;
  status: "available" | "asked" | "in" | "declined" | "silent";
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

const STATUS_COPY: Record<CandidateVM["status"], { label: string; cls: string }> = {
  available: { label: "not yet asked", cls: "text-muted" },
  asked: { label: "awaiting reply", cls: "text-accent" },
  in: { label: "said yes", cls: "font-semibold text-ok" },
  declined: { label: "declined", cls: "text-muted" },
  silent: { label: "👻 silent — no reply, timed out", cls: "font-semibold text-bad" },
};

const tel = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
const sms = (p: string) => `sms:${p.replace(/[^0-9+]/g, "")}`;

/** An Asked seat's collapsed line must say WHO is in flight (binding fact). */
function askedSummary(pool: CandidateVM[]): string {
  const waiting = pool.filter((c) => c.status === "asked").map((c) => c.name);
  return waiting.length === 0
    ? " — asks in flight, watching"
    : ` — awaiting reply from ${waiting.join(", ")}`;
}

function HiddenIds({ vm, crewId }: { vm: SeatCardVM; crewId?: string }) {
  return (
    <>
      <input type="hidden" name="shiftId" value={vm.shiftId} />
      <input type="hidden" name="seatId" value={vm.seatId} />
      {crewId !== undefined && (
        <input type="hidden" name="crewMemberId" value={crewId} />
      )}
    </>
  );
}

function MiniButton({ label, title }: { label: string; title?: string }) {
  return (
    <button
      type="submit"
      title={title}
      className="rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-accent hover:border-accent"
    >
      {label}
    </button>
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ok-line bg-ok-bg px-3 py-2">
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
    );
  }
  if (vm.state === "Bailed") {
    return (
      <div className="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad">
        ✕ Crew bailed with nobody left to re-ask at the time — the pool below
        is who can take it now (the bailer isn’t offered).
      </div>
    );
  }
  return null;
}

function CandidateRow({ vm, c }: { vm: SeatCardVM; c: CandidateVM }) {
  const s = STATUS_COPY[c.status];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
      <span className="text-sm text-ink">{c.name}</span>
      <span className="flex items-center gap-3">
        <span className={`text-xs ${s.cls}`}>
          {s.label}
          {c.replyLabel && <span className="text-muted"> · {c.replyLabel}</span>}
        </span>
        {c.action === "assign" && (
          <form action={assignTo} className="inline-flex">
            <HiddenIds vm={vm} crewId={c.id} />
            <MiniButton label="Assign" title="Name them into this seat — they get the ask" />
          </form>
        )}
        {c.action === "nudge" && (
          <form action={nudgeOn} className="inline-flex">
            <HiddenIds vm={vm} crewId={c.id} />
            {/* lean() is shift-level (first gap seat that fits) — say so. */}
            <MiniButton
              label="↗ Nudge"
              title="Direct nudge — asks them onto this shift's open seat"
            />
          </form>
        )}
      </span>
    </li>
  );
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
