import Link from "next/link";
import { deriveAtRiskBoard, type AtRiskRow } from "@core/admin/at-risk-board.js";
import { asId } from "@core/domain/ids.js";
import type { CrewMemberId } from "@core/domain/ids.js";
import { RiskRow, type RiskRowVM } from "../../../../components/at-risk/risk-row";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * The At-Risk Board (SPEC §2.5, #42) — the triage worklist of shifts the
 * automation couldn't close, most-urgent first. Empty is SUCCESS: if Tiers 1–2
 * are working, nothing lands here. Membership comes ONLY from
 * `deriveAtRiskBoard` (DEC-023 corollary — never the persisted badge); landing
 * detection + the ping record live in `tick` (DEC-026), not here — this page is
 * a pure read.
 */

export const dynamic = "force-dynamic";

/** Inside this many hours of departure the countdown turns red. UI-only —
 * deliberately NOT core's `EXHAUSTED_THRESHOLD_HOURS` (48h, a membership rule);
 * this is just when the clock starts shouting. */
const TIGHT_HOURS = 36;

/** Feedback params carry codes/ids, never prose (see actions.ts) — map here. */
const LEAN_ERROR_COPY: Record<string, string> = {
  shift_gone: "That shift is no longer live.",
  no_gap: "No open seat to fill — nothing to nudge for.",
  already_asked: "Already asked on this shift — awaiting their reply.",
  bailed: "They bailed on this shift — pick someone else.",
  ineligible: "Not eligible for this shift’s open seats.",
  raced: "That seat just changed — here’s the fresh board.",
  unavailable: "Couldn’t reach the schedule — nothing was sent. Try again.",
};

type Search = { leaned?: string; leaned_shift?: string; lean_error?: string };

export default async function AtRiskBoard({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const repo = getRepo();
  const now = new Date();
  let rows: AtRiskRow[];
  let vms: RiskRowVM[];
  try {
    rows = await deriveAtRiskBoard(repo, now);
    vms = await buildVMs(rows);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const regressions = vms.filter((v) => v.regression).length;

  // Engine paused (#124, DEC-054): an empty board below is a MUTED engine, not
  // success — say so loudly. Unreadable flag → skip the banner, never fail the board.
  let enginePaused = false;
  try {
    enginePaused = await repo.isEnginePaused();
  } catch {
    /* flag unreadable — omit the banner rather than break the board */
  }

  // `leaned`/`leaned_shift` carry ids; resolve to entities we know (a crafted
  // URL with an unknown id renders nothing). Errors map through
  // LEAN_ERROR_COPY only.
  const leanedName = sp.leaned
    ? (await repo.getCrewMember(asId<"CrewMemberId">(sp.leaned)))?.name ?? null
    : null;
  // The leaned shift left the board (ask in flight) — the notice offers its
  // cockpit as the watch path, validated against a real shift.
  const leanedShiftId =
    sp.leaned_shift && (await repo.getShift(asId<"ShiftId">(sp.leaned_shift)))
      ? sp.leaned_shift
      : null;
  const leanError = sp.lean_error ? LEAN_ERROR_COPY[sp.lean_error] ?? null : null;

  return (
    <Shell width="3xl">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Needs attention</h1>
          <p className="text-sm text-muted">
            Only shifts the automation couldn’t close.{" "}
            {vms.length === 0 ? "Right now, none do." : "Most-urgent first."}
          </p>
        </div>
        {vms.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">{vms.length}</span>
            <span className="text-xs text-muted">
              {vms.length === 1 ? "shift needs" : "shifts need"} attention
            </span>
            {regressions > 0 && (
              <span className="rounded-full border border-bad-line bg-bad-bg px-2 py-0.5 text-xs font-semibold text-bad">
                {regressions} late bail{regressions === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </header>

      {/* A paused engine makes "empty board = success" lie — name it (#124, DEC-054). */}
      {enginePaused && (
        <Notice tone="warn">
          Engine paused — the automation isn’t firing asks. An empty board here
          means the engine is muted, not that every shift is covered.{" "}
          <Link href="/admin" className="font-semibold text-accent">
            Resume staffing ↗
          </Link>
        </Notice>
      )}

      {/* Redirect-param feedback reads safely when stale ("last action", not
          "just happened") — the no-client-JS tradeoff (DEC-026). */}
      {leanedName && (
        <Notice tone="ok">
          Last action: nudged {leanedName} — asked, not yet filled. The
          shift left the board while their answer is pending
          {leanedShiftId ? (
            <>
              {" — "}
              <Link
                href={`/admin/shift/${encodeURIComponent(leanedShiftId)}`}
                className="font-semibold text-accent"
              >
                watch it ↗
              </Link>
            </>
          ) : (
            "."
          )}
        </Notice>
      )}
      {leanError && <Notice tone="bad">{leanError}</Notice>}

      {vms.length === 0 ? (
        <EmptySuccess />
      ) : (
        <div className="flex flex-col gap-3">
          {vms.map((vm) => (
            <RiskRow key={vm.shiftId} row={vm} />
          ))}
        </div>
      )}
    </Shell>
  );
}

/** Resolve ids → names and format the row facts the component renders. */
async function buildVMs(rows: AtRiskRow[]): Promise<RiskRowVM[]> {
  const repo = getRepo();
  const [vessels, roles, crew] = await Promise.all([
    repo.listVessels(),
    repo.listAllRoleTypes(),
    repo.listCrewMembers(),
  ]);
  const vesselName = new Map(vessels.map((v) => [v.id, v.name]));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const crewName = new Map(crew.map((c) => [c.id, c.name]));
  const nameOf = (id: CrewMemberId) => crewName.get(id) ?? String(id);

  return rows.map((r) => {
    // Operator words, not dev words ("regression" stays internal vocabulary):
    // "Lacking crew" is the family headline; the tail carries the distinction
    // the spec makes binding — a late bail (was crewed, broke) reads differently
    // from a never-filled shift.
    const flag = r.reasons.includes("regression")
      ? { label: "Lacking crew · late bail", tone: "bad" as const }
      : r.reasons.includes("credential_lapse") && !r.reasons.includes("core")
        ? { label: "Credential lapse", tone: "warn" as const }
        : {
            label: r.trail.exhausted
              ? "Lacking crew · none eligible"
              : "Lacking crew · no takers",
            tone: "warn" as const,
          };
    return {
      shiftId: String(r.shiftId),
      vesselName: vesselName.get(r.vesselId) ?? String(r.vesselId),
      dateLabel: fmtDate(r.date),
      departs: r.tripStarts.map((t) => `departs ${fmtTime(t)}`),
      toTrip: r.hoursToTrip === null ? null : ttLabel(r.hoursToTrip),
      tight: r.hoursToTrip !== null && r.hoursToTrip < TIGHT_HOURS,
      flag,
      regression: r.reasons.includes("regression"),
      missing: r.gaps.map((g) => ({
        roleName: roleName.get(g.role) ?? String(g.role),
        count: g.missing,
      })),
      lapsed: r.credentialLapsed.map(
        (id) => `${nameOf(id)}’s credential lapses before the trip`,
      ),
      trail: {
        asked: r.trail.asked,
        declined: r.trail.declined,
        silent: r.trail.silent,
        pending: r.trail.pending,
        widened: r.trail.poolWidened,
        nudgedNames: r.trail.nudged.map(nameOf),
        exhausted: r.trail.exhausted,
      },
      available: r.available.map((id) => ({
        id: String(id),
        name: nameOf(id),
      })),
    };
  });
}

function fmtDate(iso: string): string {
  // Date-only label: UTC both ends so the stored vessel-local date shows
  // verbatim regardless of server zone (DEC-032).
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TENANT_TIMEZONE, // vessel-local wall-clock (DEC-032)
  });
}

function ttLabel(h: number): string {
  if (h < 0) return "departed";
  const whole = Math.round(h);
  if (whole < 24) return `${whole}h to trip`;
  return `${Math.floor(whole / 24)}d ${whole % 24}h to trip`;
}

function EmptySuccess() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-ok-line bg-ok-bg px-6 py-10 text-center">
      <div className="text-2xl text-ok" aria-hidden>
        ✓
      </div>
      <h2 className="text-lg font-semibold text-ink">
        Nothing needs you right now.
      </h2>
      <p className="max-w-md text-sm text-muted">
        Every shift is crewed or still being worked by the automation. An empty
        board is the system doing its job — not a reminder to go check
        something.
      </p>
      <p className="text-xs text-muted">
        Tiers 1–2 will summon you here only if a shift genuinely can’t be
        closed.
      </p>
    </div>
  );
}

function SignedOut() {
  return (
    <Shell width="3xl">
      <h1 className="text-lg font-semibold text-ink">Muster · At-Risk Board</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface is
        Spink’s.
      </Notice>
    </Shell>
  );
}
