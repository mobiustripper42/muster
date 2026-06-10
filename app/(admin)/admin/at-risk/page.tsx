import { deriveAtRiskBoard, type AtRiskRow } from "@core/admin/at-risk-board.js";
import { asId } from "@core/domain/ids.js";
import type { CrewMemberId } from "@core/domain/ids.js";
import { RiskRow, type RiskRowVM } from "../../../../components/at-risk/risk-row";
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
  no_gap: "No open seat to fill — nothing to lean for.",
  already_asked: "Already asked on this shift — awaiting their reply.",
  bailed: "They bailed on this shift — pick someone else.",
  ineligible: "Not eligible for this shift’s open seats.",
  raced: "That seat just changed — here’s the fresh board.",
  unavailable: "Couldn’t reach the schedule — nothing was sent. Try again.",
};

type Search = { leaned?: string; lean_error?: string };

export default async function AtRiskBoard({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const repo = getRepo();
  let rows: AtRiskRow[];
  let vms: RiskRowVM[];
  try {
    rows = await deriveAtRiskBoard(repo, new Date());
    vms = await buildVMs(rows);
  } catch {
    return (
      <Shell>
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const regressions = vms.filter((v) => v.regression).length;

  // `leaned` carries the crew id; resolve to a name we know (a crafted URL with
  // an unknown id renders nothing). Errors map through LEAN_ERROR_COPY only.
  const leanedName = sp.leaned
    ? (await repo.getCrewMember(asId<"CrewMemberId">(sp.leaned)))?.name ?? null
    : null;
  const leanError = sp.lean_error ? LEAN_ERROR_COPY[sp.lean_error] ?? null : null;

  return (
    <Shell>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Needs you</h1>
          <p className="text-sm text-muted">
            Only shifts the automation couldn’t close land here.{" "}
            {vms.length === 0 ? "Right now, none do." : "Most-urgent first."}
          </p>
        </div>
        {vms.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">{vms.length}</span>
            <span className="text-xs text-muted">
              {vms.length === 1 ? "shift needs" : "shifts need"} a call
            </span>
            {regressions > 0 && (
              <span className="rounded-full border border-bad-line bg-bad-bg px-2 py-0.5 text-xs font-semibold text-bad">
                {regressions} regression{regressions === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </header>

      {/* Redirect-param feedback reads safely when stale ("last action", not
          "just happened") — the no-client-JS tradeoff (DEC-026). */}
      {leanedName && (
        <Notice tone="ok">
          ↗ Last action: leaned on {leanedName} — asked, not yet filled.
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
    const flag = r.reasons.includes("regression")
      ? { label: "Regression · late bail", tone: "bad" as const }
      : r.reasons.includes("credential_lapse") && !r.reasons.includes("core")
        ? { label: "Credential lapse", tone: "warn" as const }
        : {
            label: r.trail.exhausted ? "At-Risk · pool exhausted" : "At-Risk · all asks dry",
            tone: "warn" as const,
          };
    return {
      shiftId: String(r.shiftId),
      vesselName: vesselName.get(r.vesselId) ?? String(r.vesselId),
      dateLabel: fmtDate(r.date),
      departLabel: r.tripStart ? `departs ${fmtTime(r.tripStart)}` : null,
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
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC", // clock times are UTC by DEC-022's v1 simplification
  });
}

function ttLabel(h: number): string {
  if (h < 0) return "departed";
  const whole = Math.round(h);
  if (whole < 24) return `${whole}h to trip`;
  return `${Math.floor(whole / 24)}d ${whole % 24}h to trip`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {children}
    </main>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "bad";
}) {
  const cls =
    tone === "ok"
      ? "border-ok-line bg-ok-bg text-ok"
      : tone === "bad"
        ? "border-bad-line bg-bad-bg text-bad"
        : "border-line bg-card text-muted";
  return (
    <div className={`rounded-card border px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
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
    <Shell>
      <h1 className="text-lg font-semibold text-ink">Muster · At-Risk Board</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface is
        Spink’s.
      </Notice>
    </Shell>
  );
}
