import Link from "next/link";
import {
  buildAssignmentView,
  type AssignmentView,
  type SeatCardView,
} from "@core/asks/assignment-view.js";
import { deriveWarming } from "@core/admin/warming.js";
import { asId } from "@core/domain/ids.js";
import { resolveShiftStateOnRead } from "@core/builder/tick.js";
import { changedSinceReviewed } from "@core/builder/lock.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import {
  SeatCard,
  type CandidateVM,
  type SeatCardVM,
} from "../../../../../components/assignment/seat-card";
import {
  WarmingPanel,
  type WarmingRowVM,
} from "../../../../../components/assignment/warming-panel";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { readSubject } from "../../../../lib/auth";
import { fmtDeadline, fmt12 } from "../../../../lib/format";
import { getRepo } from "../../../../lib/repo";

/**
 * The assignment cockpit (SPEC §2.4, #54/#55, DEC-027) — monitor by default,
 * controls on demand: header facts + countdown, one card per required seat with the
 * ranked pool (silent ≠ declined), the four manual actions, and the
 * deliberately-opened warming view. The state badge is resolved ON READ
 * (DEC-023 corollary); board membership is never re-derived here — the cockpit
 * acts on seats.
 *
 * Honest header (DEC-027 §4): the countdown is "departs in" (trip start) and
 * the staffing horizon renders as a dated fact — the named "fills by" deadline
 * is NOT faked; it lands with #59.
 */

export const dynamic = "force-dynamic";

/** Inside this many hours of departure the countdown turns red (UI-only). */
const TIGHT_HOURS = 36;

/** Feedback params carry codes/ids only, never prose (DEC-026) — map here. */
const ACT_ERROR_COPY: Record<string, string> = {
  shift_gone: "That shift or seat is no longer live.",
  no_gap: "That seat isn’t open to assign into.",
  already_asked: "Already asked on this shift — awaiting their reply.",
  bailed: "They bailed on this shift — pick someone else.",
  ineligible: "Not eligible for this seat.",
  raced: "That seat just changed — here’s the fresh state.",
  not_claimed: "Nothing is awaiting confirm on that seat.",
  not_confirmed: "No confirmed crew on that seat — it may have just changed.",
  not_rated: "They’re not rated for this seat’s role — a mate can’t hold a captain seat.",
  seat_gone: "That seat is gone — here’s the fresh state.",
  unavailable: "Couldn’t reach the schedule — nothing was changed. Try again.",
};

type Search = {
  warming?: string;
  assigned?: string;
  nudged?: string;
  confirmed?: string;
  overrode?: string;
  removed?: string;
  bail_logged?: string;
  act_error?: string;
};

export default async function ShiftCockpit({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<Search>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return (
      <Shell width="2xl">
        <Notice>You’re signed out. Tap an operator magic link to get in.</Notice>
      </Shell>
    );
  }

  const { shiftId: raw } = await params;
  const sp = await searchParams;
  const shiftId = asId<"ShiftId">(decodeURIComponent(raw));
  const basePath = `/admin/shift/${encodeURIComponent(String(shiftId))}`;
  const repo = getRepo();
  const now = new Date();

  let view: AssignmentView | null;
  let resolved: string | null;
  let crew: Map<string, { name: string; phone: string | null }>;
  let ratingsById: Map<string, string[]>;
  let seatOccupant: Map<string, string>;
  let warmingRows: WarmingRowVM[] = [];
  let changedSinceLock = false;
  const warmingOpen = sp.warming === "1";
  try {
    view = await buildAssignmentView(repo, shiftId, now);
    if (!view) {
      return (
        <Shell width="2xl">
          <Notice>No such shift. It may have been removed.</Notice>
        </Shell>
      );
    }
    resolved = await resolveShiftStateOnRead(repo, shiftId, now);
    // "Changed since you reviewed it" (§2.3, DEC-029) — a booking landed/changed
    // after this shift was locked. Derived, never a stored flag; relock clears.
    const shift = await repo.getShift(shiftId);
    if (shift?.lockedAt) {
      const reservations = (
        await Promise.all(
          shift.eventIds.map((id) => repo.listReservationsForEvent(id)),
        )
      ).flat();
      changedSinceLock = changedSinceReviewed(shift, reservations);
    }
    const crewMembers = await repo.listCrewMembers();
    crew = new Map(
      crewMembers.map((c) => [
        String(c.id),
        { name: c.name, phone: c.phone ?? null },
      ]),
    );
    // Ratings drive the override picker's per-seat scope (DEC-064).
    ratingsById = new Map(
      crewMembers.map((c) => [String(c.id), c.ratings.map(String)]),
    );
    seatOccupant = new Map(
      (await repo.listSeatsForShift(shiftId))
        .filter((s) => s.assignedCrewMemberId)
        .map((s) => [String(s.id), String(s.assignedCrewMemberId)]),
    );
    if (warmingOpen) {
      const vessels = new Map(
        (await repo.listVessels()).map((v) => [v.id, v.name]),
      );
      warmingRows = (await deriveWarming(repo, now)).map((r) => ({
        shiftId: String(r.shiftId),
        vesselName: vessels.get(r.vesselId) ?? String(r.vesselId),
        dateLabel: fmtDate(r.date),
        toTrip: `departs in ${ttLabel(r.hoursToTrip)}`,
        unfilledSeats: r.unfilledSeats,
        responseLabel:
          r.responseRate === null
            ? null
            : `${Math.round(r.responseRate * 100)}% answered`,
        silent: r.trail.silent,
        isCurrent: String(r.shiftId) === String(shiftId),
      }));
    }
  } catch {
    return (
      <Shell width="2xl">
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const badge = resolved ?? view.badge;
  const roster = [...crew.entries()].map(([id, c]) => ({ id, name: c.name }));
  const seatVMs = view.seats.map((s) =>
    toSeatVM(s, String(shiftId), seatOccupant, crew),
  );

  // Success params carry ids; resolve to names we know — a crafted URL with an
  // unknown id renders nothing. Errors map through ACT_ERROR_COPY only.
  const nameOf = (id?: string) => (id ? crew.get(id)?.name ?? null : null);
  const assigned = nameOf(sp.assigned);
  const nudged = nameOf(sp.nudged);
  const confirmed = nameOf(sp.confirmed);
  const overrode = nameOf(sp.overrode);
  const removed = nameOf(sp.removed);
  const bailLogged = nameOf(sp.bail_logged);
  const actError = sp.act_error ? ACT_ERROR_COPY[sp.act_error] ?? null : null;

  const hoursToTrip =
    view.tripStart === null
      ? null
      : (view.tripStart.getTime() - now.getTime()) / 3_600_000;

  return (
    <Shell width="2xl">
      <Link href="/admin/at-risk" className="text-xs font-semibold text-accent">
        ← At-Risk board
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">
              {view.vesselName} · {fmtDate(view.date)}
            </h1>
            <Badge state={badge} />
          </div>
          {view.trips.length === 0 ? (
            <p className="text-sm text-muted">No scheduled trips.</p>
          ) : (
            <p className="flex flex-wrap gap-x-3 text-sm text-muted">
              {view.trips.map((t) => (
                <span key={t.departureTime} className="whitespace-nowrap">
                  <span className="font-mono">{fmt12(t.departureTime)}</span> · {t.pax} pax
                </span>
              ))}
              <span>— {view.paxTotal} aboard total</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <span
            className={`font-mono text-lg font-semibold ${
              hoursToTrip !== null && hoursToTrip < TIGHT_HOURS
                ? "text-bad"
                : "text-ink"
            }`}
          >
            {hoursToTrip === null
              ? "no scheduled trip"
              : hoursToTrip < 0
                ? "departed"
                : `departs in ${ttLabel(hoursToTrip)}`}
          </span>
          {view.horizon && (
            <span className="text-xs text-muted">
              <b>staffing</b> {now >= view.horizon ? "started" : "starts"}:{" "}
              {view.horizon.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: TENANT_TIMEZONE,
              })}
            </span>
          )}
          {view.fillsBy && (
            <span
              className={`text-xs ${
                view.fillsBy.getTime() < now.getTime()
                  ? "font-semibold text-bad"
                  : "text-muted"
              }`}
            >
              deadline: {fmtDeadline(view.fillsBy)}
              {view.fillsBy.getTime() < now.getTime() ? " · overdue" : ""}
            </span>
          )}
        </div>
      </header>

      {changedSinceLock && (
        <Notice tone="warn">
          A booking changed since this shift was last reviewed — take another look.
        </Notice>
      )}

      {assigned && <Notice tone="ok">Asked {assigned} into the seat — awaiting their reply.</Notice>}
      {nudged && <Notice tone="ok">↗ Nudged {nudged} — asked, not yet filled.</Notice>}
      {confirmed && <Notice tone="ok">{confirmed} confirmed into the seat.</Notice>}
      {overrode && <Notice tone="ok">{overrode} placed by override — confirmed.</Notice>}
      {removed && (
        <Notice tone="ok">
          Removed {removed} — no penalty. The seat reopened and the system is
          re-asking (or it rests open if nobody&rsquo;s eligible).
        </Notice>
      )}
      {bailLogged && (
        <Notice tone="ok">
          Logged {bailLogged}’s bail — the seat reopened and the system is
          re-asking (or it rests here if nobody’s left).
        </Notice>
      )}
      {actError && <Notice tone="bad">{actError}</Notice>}

      <div className="flex flex-col gap-3">
        {seatVMs.map((vm) => (
          <SeatCard
            key={vm.seatId}
            vm={vm}
            // Override picker scoped to crew rated for THIS seat's role (DEC-064).
            roster={roster.filter((p) =>
              (ratingsById.get(p.id) ?? []).includes(vm.role),
            )}
          />
        ))}
      </div>

      <WarmingPanel rows={warmingRows} open={warmingOpen} basePath={basePath} />
    </Shell>
  );
}

/** Map a core seat card to the component VM — actions only where the domain accepts. */
function toSeatVM(
  s: SeatCardView,
  shiftId: string,
  seatOccupant: Map<string, string>,
  crew: Map<string, { name: string; phone: string | null }>,
): SeatCardVM {
  const canAct = s.state === "Open" || s.state === "Bailed";
  const occupantId = seatOccupant.get(String(s.seatId));
  const occ = occupantId ? crew.get(occupantId) : undefined;
  return {
    seatId: String(s.seatId),
    shiftId,
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

function ttLabel(h: number): string {
  // Floor the minor unit — Math.round would mint "23h 60m" / "1d 24h".
  if (h < 24) {
    const whole = Math.floor(h);
    const m = Math.floor((h - whole) * 60);
    return `${whole}h ${String(m).padStart(2, "0")}m`;
  }
  return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
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
