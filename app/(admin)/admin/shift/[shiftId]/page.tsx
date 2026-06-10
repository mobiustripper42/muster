import Link from "next/link";
import {
  buildAssignmentView,
  type CandidateAskStatus,
} from "@core/asks/assignment-view.js";
import { asId } from "@core/domain/ids.js";
import { resolveShiftStateOnRead } from "@core/builder/tick.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * Thin, read-only assignment view (SPEC §2.4) — the At-Risk board row's
 * click-through (#42). Renders the existing `buildAssignmentView` read-model:
 * seat cards with occupant/state, and for an Open seat the ranked eligible pool
 * with per-candidate ask status — **silent is first-class and distinct from
 * declined** (the binding §2.4 constraint). The full cockpit (seat actions,
 * monitor posture, countdowns) is a later task; this page deliberately does
 * nothing but show.
 *
 * The state badge is resolved ON READ (DEC-023 corollary): a page reached from
 * a board row that says "At-Risk" must never contradict it with the stale
 * persisted badge.
 */

export const dynamic = "force-dynamic";

export default async function ShiftAssignment({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return (
      <Shell>
        <Notice>You’re signed out. Tap an operator magic link to get in.</Notice>
      </Shell>
    );
  }

  const { shiftId: raw } = await params;
  const shiftId = asId<"ShiftId">(decodeURIComponent(raw));
  const repo = getRepo();
  const now = new Date();

  const view = await buildAssignmentView(repo, shiftId, now);
  if (!view) {
    return (
      <Shell>
        <Notice>No such shift. It may have been removed.</Notice>
      </Shell>
    );
  }

  // Badge resolved on read (DEC-023 corollary) — same resolve the board uses.
  const [resolved, seats, roleTypes] = await Promise.all([
    resolveShiftStateOnRead(repo, shiftId, now),
    repo.listSeatsForShift(shiftId),
    repo.listAllRoleTypes(),
  ]);
  const badge = resolved ?? view.badge;
  const roleNames = new Map(roleTypes.map((r) => [r.id, r.name]));
  const roleOfSeat = new Map(
    seats.map((s) => [String(s.id), roleNames.get(s.role) ?? String(s.role)]),
  );

  return (
    <Shell>
      <Link href="/admin/at-risk" className="text-xs font-semibold text-accent">
        ← At-Risk board
      </Link>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">
          {view.vesselName} · {fmtDate(view.date)}
        </h1>
        <Badge state={badge} />
      </header>

      <div className="flex flex-col gap-3">
        {view.seats.map((seat) => (
          <article
            key={seat.seatId}
            className="rounded-card border border-line bg-card p-4 shadow-sm"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
              {roleOfSeat.get(String(seat.seatId)) ?? "crew"}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">
                {seat.occupant ?? "Unfilled"}
              </span>
              <SeatBadge state={seat.state} />
            </div>
            {seat.pool && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2">
                {seat.pool.length === 0 && (
                  <li className="text-sm text-muted">
                    Nobody eligible for this seat right now.
                  </li>
                )}
                {seat.pool.map((c) => (
                  <li
                    key={c.crewMemberId}
                    className="flex items-baseline justify-between text-sm"
                  >
                    <span className="text-ink">{c.name}</span>
                    <PoolStatus status={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <p className="text-xs text-muted">
        Read-only for now — act from the board (lean) or the crew’s own ask.
      </p>
    </Shell>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const BADGE_TONE: Record<string, string> = {
  AtRisk: "border-bad-line bg-bad-bg text-bad",
  Filling: "border-warn-line bg-warn-bg text-warn",
  Crewed: "border-ok-line bg-ok-bg text-ok",
};

function Badge({ state }: { state: string }) {
  const cls = BADGE_TONE[state] ?? "border-line bg-bg text-muted";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {state === "AtRisk" ? "At-Risk" : state}
    </span>
  );
}

function SeatBadge({ state }: { state: string }) {
  const tone =
    state === "Confirmed"
      ? "text-ok"
      : state === "Bailed"
        ? "text-bad"
        : "text-muted";
  return <span className={`text-xs font-semibold ${tone}`}>{state}</span>;
}

/** Silent ≠ declined (§2.4): the ghost gets the loud treatment. */
function PoolStatus({ status }: { status: CandidateAskStatus }) {
  const map: Record<CandidateAskStatus, { label: string; cls: string }> = {
    available: { label: "not yet asked", cls: "text-muted" },
    asked: { label: "asked — awaiting reply", cls: "text-accent" },
    in: { label: "in", cls: "font-semibold text-ok" },
    declined: { label: "declined", cls: "text-muted" },
    silent: { label: "silent", cls: "font-semibold text-bad" },
  };
  const s = map[status];
  return <span className={`text-xs ${s.cls}`}>{s.label}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6">
      {children}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3 text-sm text-muted">
      {children}
    </div>
  );
}
