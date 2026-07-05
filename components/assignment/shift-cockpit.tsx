import Link from "next/link";
import {
  buildAssignmentView,
  type AssignmentView,
} from "@core/asks/assignment-view.js";
import { deriveWarming } from "@core/admin/warming.js";
import { asId } from "@core/domain/ids.js";
import { resolveShiftStateOnRead } from "@core/builder/tick.js";
import { changedSinceReviewed } from "@core/builder/lock.js";
import { evaluateTraineeCandidate } from "@core/oracle/eligibility.js";
import { committedDatesByCrew } from "@core/oracle/oracle.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { cockpitHref } from "../../app/lib/cockpit-href";
import { fmtDeadline, fmt12 } from "../../app/lib/format";
import { OPERATOR_CREW_MEMBER_ID } from "../../app/lib/operator";
import { getRepo } from "../../app/lib/repo";
import { TENANT_ID } from "../../app/lib/tenant";
import { Notice } from "../ui/notice";
import { Badge, fmtDate, toSeatVM, ttLabel } from "./cockpit-bits";
import { ManningSection, type OverrideSeatVM } from "./manning-section";
import { SeatCard } from "./seat-card";
import { WarmingPanel, type WarmingRowVM } from "./warming-panel";

/**
 * The assignment cockpit BODY (SPEC §2.4, #54/#55, DEC-027) — monitor by
 * default, controls on demand: header facts + countdown, one card per required
 * seat with the ranked pool (silent ≠ declined), the four manual actions, and
 * the deliberately-opened warming view. The state badge is resolved ON READ
 * (DEC-023 corollary); board membership is never re-derived here — the cockpit
 * acts on seats.
 *
 * Extracted per DEC-085 (pane mechanics, 9.5 gate): one async server component
 * rendered by TWO hosts — the thin standalone `/admin/shift/[shiftId]` route
 * (deep links, mobile drill-in) and the board's desktop right pane
 * (`/admin/shifts?sel=`). It owns its own data loads, renders NO Shell, and
 * returns error states as bare Notices; the host owns layout, width, and auth.
 * `ctx` (the board's filter query string, null when standalone) rides every
 * action form as a hidden input so the redirect lands back in the right host.
 *
 * Honest header (DEC-027 §4): the countdown is "departs in" (trip start) and
 * the staffing horizon renders as a dated fact — the named "fills by" deadline
 * is NOT faked; it lands with #59.
 */

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
  not_rated: "They’re not rated for this seat’s role.",
  seat_gone: "That seat is gone — here’s the fresh state.",
  unavailable: "Couldn’t reach the schedule — nothing was changed. Try again.",
  trainee_ineligible:
    "They can’t ride this shift — inactive, MMC lapsed, on PTO, or already committed that day.",
  trainee_seat:
    "That’s a trainee seat — take them off from the Manning section below.",
};

/** The cockpit's feedback/toggle params. Shares a URL with the board's
 * `{from,to,preset,mode,split_*,merge_*,sel}` namespace when rendered in the
 * pane — keep the two disjoint. */
export type CockpitSearch = {
  warming?: string;
  assigned?: string;
  nudged?: string;
  confirmed?: string;
  overrode?: string;
  removed?: string;
  bail_logged?: string;
  act_error?: string;
  manning_added?: string;
  manning_removed?: string;
  trainee_on?: string;
  trainee_off?: string;
};

export async function ShiftCockpit({
  shiftId: rawShiftId,
  sp,
  ctx,
  headingLevel = "h1",
}: {
  shiftId: string;
  sp: CockpitSearch;
  /** Board filter query string when hosted in the pane; null when standalone. */
  ctx: string | null;
  /** h1 standalone; h2 in the pane — the board already ships the page's h1. */
  headingLevel?: "h1" | "h2";
}) {
  const shiftId = asId<"ShiftId">(rawShiftId);
  const repo = getRepo();
  const now = new Date();

  let view: AssignmentView | null;
  let resolved: string | null;
  let crew: Map<string, { name: string; phone: string | null }>;
  let ratingsById: Map<string, string[]>;
  let seatOccupant: Map<string, string>;
  let warmingRows: WarmingRowVM[] = [];
  let overrideSeats: OverrideSeatVM[] = [];
  let roleOptions: { id: string; name: string }[] = [];
  let traineeOptions: { id: string; name: string }[] = [];
  let changedSinceLock = false;
  const warmingOpen = sp.warming === "1";
  try {
    view = await buildAssignmentView(repo, shiftId, now);
    if (!view) {
      return <Notice>No such shift. It may have been removed.</Notice>;
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
    const allSeats = await repo.listSeatsForShift(shiftId);
    seatOccupant = new Map(
      allSeats
        .filter((s) => s.assignedCrewMemberId)
        .map((s) => [String(s.id), String(s.assignedCrewMemberId)]),
    );
    // Manning override (8.5): the tenant's roles for the add picker, and the current
    // override seats (each removable when Open).
    const roleTypes = await repo.listRoleTypes(TENANT_ID);
    const roleName = new Map(roleTypes.map((r) => [String(r.id), r.name]));
    roleOptions = roleTypes.map((r) => ({ id: String(r.id), name: r.name }));
    overrideSeats = allSeats
      .filter((s) => s.override)
      .map((s) => {
        const occupantId = s.assignedCrewMemberId
          ? String(s.assignedCrewMemberId)
          : null;
        return {
          seatId: String(s.id),
          roleName: roleName.get(String(s.role)) ?? String(s.role),
          kind: s.kind,
          occupied: s.state !== "Open",
          occupantId,
          occupantName: occupantId ? crew.get(occupantId)?.name ?? null : null,
        };
      });
    // Trainee picker scope (9.3, DEC-087): the trainee rule set — active +
    // valid MMC + not on PTO + not double-booked (which also excludes this
    // shift's own confirmed crew) — with NO rating requirement. Computed only
    // when an unstaffed trainee seat is actually on screen; the action
    // re-checks server-side, so this scope is convenience, not the guard.
    // The operator is UI noise, not an eligibility rule — excluded here only.
    if (overrideSeats.some((s) => s.kind === "supernumerary" && !s.occupied)) {
      const shiftDate = view.date; // narrowed here; the closure below can't re-narrow the `let`
      const committed = await committedDatesByCrew(repo);
      const candidates = await Promise.all(
        crewMembers
          .filter((c) => String(c.id) !== String(OPERATOR_CREW_MEMBER_ID))
          .map(async (c) => {
            const [credentials, ptoWindows] = await Promise.all([
              repo.listCredentialsForCrew(c.id),
              repo.listPtoWindowsForCrew(c.id),
            ]);
            const v = evaluateTraineeCandidate(
              {
                crew: c,
                credentials,
                ptoWindows,
                committedDates: committed.get(c.id) ?? new Set<string>(),
              },
              shiftDate,
            );
            return v.eligible ? { id: String(c.id), name: c.name } : null;
          }),
      );
      traineeOptions = candidates.filter(
        (c): c is { id: string; name: string } => c !== null,
      );
    }
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
        // Warming rows stay in the SAME host — a pane-hosted cockpit links other
        // shifts as `?sel=`, standalone links the standalone route (DEC-085).
        href:
          String(r.shiftId) === String(shiftId)
            ? null
            : cockpitHref(String(r.shiftId), ctx, "warming=1"),
      }));
    }
  } catch {
    return (
      <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
    );
  }

  const badge = resolved ?? view.badge;
  const roster = [...crew.entries()].map(([id, c]) => ({ id, name: c.name }));
  const seatVMs = view.seats.map((s) =>
    toSeatVM(s, String(shiftId), ctx, seatOccupant, crew),
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
  const traineeOn = nameOf(sp.trainee_on);
  const traineeOff = nameOf(sp.trainee_off);
  const actError = sp.act_error ? ACT_ERROR_COPY[sp.act_error] ?? null : null;

  const hoursToTrip =
    view.tripStart === null
      ? null
      : (view.tripStart.getTime() - now.getTime()) / 3_600_000;

  const title = `${view.vesselName} · ${fmtDate(view.date)}`;

  return (
    <>
      {ctx !== null && (
        // Pane host on a phone: the board list is display-hidden, so this is the
        // drill-in's way back (desktop shows the board alongside — link hidden).
        <Link
          href={ctx ? `/admin/shifts?${ctx}` : "/admin/shifts"}
          className="inline-flex min-h-9 items-center self-start text-xs font-semibold text-accent lg:hidden"
        >
          <span aria-hidden="true">←&nbsp;</span>All shifts
        </Link>
      )}

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {headingLevel === "h1" ? (
              <h1 className="text-xl font-semibold text-ink">{title}</h1>
            ) : (
              // Pane host: the heading level tracks the BREAKPOINT, not just the
              // host. Desktop shows the board's h1 alongside → demote to h2; at
              // 375px the board (and its h1) is display-hidden, so this full-
              // screen drill-in's own heading is the page's h1. display:none
              // removes the hidden twin from the a11y tree — AT sees exactly one.
              <>
                <h1 className="text-xl font-semibold text-ink lg:hidden">
                  {title}
                </h1>
                <h2 className="hidden text-xl font-semibold text-ink lg:block">
                  {title}
                </h2>
              </>
            )}
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
      {sp.manning_added === "required" && (
        <Notice tone="ok">Added a required hand — the shift needs one more to crew.</Notice>
      )}
      {sp.manning_added === "supernumerary" && (
        <Notice tone="ok">
          Added a trainee seat — rides along (takes a pax slot), doesn’t gate crewing.
        </Notice>
      )}
      {sp.manning_removed === "1" && <Notice tone="ok">Removed the added seat.</Notice>}
      {traineeOn && (
        <Notice tone="ok">
          {traineeOn} is riding this shift as a trainee — they’ve been told.
        </Notice>
      )}
      {traineeOff && (
        <Notice tone="ok">
          Took {traineeOff} off the trainee seat — no penalty, they’ve been told.
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
        {/* Crewed-gate summary (9.8) — what stands between here and Crewed,
            said in one line. `view.seats` is required seats only (incl. added
            required hands), exactly the set that gates. */}
        {seatVMs.length > 0 && (
          <p className="text-xs text-faint">
            {seatVMs.filter((s) => s.state === "Confirmed").length}/
            {seatVMs.length} required seats confirmed
            {seatVMs.every((s) => s.state === "Confirmed")
              ? " — fully crewed"
              : " — Crewed when all confirm"}
          </p>
        )}
      </div>

      <ManningSection
        shiftId={String(shiftId)}
        ctx={ctx}
        overrideSeats={overrideSeats}
        roleOptions={roleOptions}
        traineeOptions={traineeOptions}
      />

      <WarmingPanel
        rows={warmingRows}
        open={warmingOpen}
        openHref={cockpitHref(String(shiftId), ctx, "warming=1")}
        closeHref={cockpitHref(String(shiftId), ctx)}
      />
    </>
  );
}
