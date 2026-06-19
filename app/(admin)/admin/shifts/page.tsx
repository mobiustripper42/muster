import Link from "next/link";
import { deriveAllShifts, type AllShiftsRow } from "@core/admin/all-shifts.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { fmt12 } from "../../../lib/format";

/**
 * All-shifts view (#100 Part A, DEC-042) — the operator's deliberate full-
 * visibility PULL surface: every current shift, day-filterable, → the cockpit.
 *
 * This is a knowing, opt-in exception to the anti-anxiety-dashboard stance
 * (BRAND), so the brand guardrails from the @architect review are LOAD-BEARING,
 * not decoration:
 *  - Default scope is TODAY, never "everything" — no infinite glowing wall.
 *  - State renders as NEUTRAL INK, never colour. Warm/bad tokens belong to the
 *    At-Risk board alone; a board where every row glows is the named failure mode.
 *  - No auto-refresh / no polling / no per-state scoreboard. Server-render on
 *    navigation only, exactly like the board.
 *  - Empty is NOT success here. The board's ✓ "empty = the system did its job"
 *    must stay uncontaminated, so this renders a plain "no shifts" line and does
 *    NOT reuse the board's EmptySuccess component.
 *  - Nothing routes *to* this surface (no ping, no root redirect) — it's a
 *    trust-building crutch, deletable as a single route when the operator stops
 *    opening it (DEC-042 sunset trigger).
 */

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string };

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Today on the vessel's calendar (DEC-032), as an ISO date string. */
function todayLocal(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Date math on the vessel-local calendar — noon-UTC anchor dodges DST edges. */
function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Day of week (0=Sun) of an ISO date — UTC read is the calendar day verbatim. */
function dowOf(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type Scope = "today" | "weekend" | "range";

/** Resolve the date window from the filter params — defaulting to TODAY, clamped
 * to a sane horizon so "everything" can't render an unbounded wall (DEC-042). */
function resolveWindow(
  sp: Search,
  now: Date,
): { from: string; to: string; scope: string; kind: Scope } {
  const today = todayLocal(now);
  const minFrom = addDays(today, -30);
  const maxTo = addDays(today, 45);

  let from: string;
  let to: string;
  let kind: Scope;
  if (sp.preset === "weekend") {
    // The current weekend's Sat–Sun: on a Sunday that's yesterday→today; any
    // other day, the coming Saturday and the day after.
    const dow = dowOf(today);
    const sat = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow) % 7);
    from = sat;
    to = addDays(sat, 1);
    kind = "weekend";
  } else if (isDate(sp.from) || isDate(sp.to)) {
    from = isDate(sp.from) ? sp.from : today;
    to = isDate(sp.to) ? sp.to : from;
    kind = "range";
  } else {
    from = today;
    to = today;
    kind = "today";
  }
  // Clamp to the horizon, then re-guard ordering. The scope LABEL is built after
  // so the header never disagrees with the actual (clamped) window.
  if (from < minFrom) from = minFrom;
  if (to > maxTo) to = maxTo;
  if (to < from) to = from;

  const scope =
    kind === "weekend"
      ? "this weekend"
      : kind === "today"
        ? "today"
        : from === to
          ? fmtDate(from)
          : `${fmtDate(from)} – ${fmtDate(to)}`;
  return { from, to, scope, kind };
}

export default async function AllShifts({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const sp = await searchParams;
  const now = new Date();
  const { from, to, scope, kind } = resolveWindow(sp, now);

  let rows: AllShiftsRow[];
  try {
    rows = await deriveAllShifts(getRepo(), { from, to }, now);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  return (
    <Shell width="3xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">All shifts</h1>
        {/* The single line that does the brand work: this is pull, not push. */}
        <p className="text-sm text-muted">
          Everything on the books — for reference. The board summons you; this you
          check when you want to.
        </p>
      </header>

      <Filter from={from} to={to} kind={kind} />

      {rows.length === 0 ? (
        // NOT the board's ✓ success state — a quiet day is just a quiet day.
        <Notice>No shifts {scope === "today" ? "today" : `for ${scope}`}.</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {rows.length} shift{rows.length === 1 ? "" : "s"} · {scope}
          </p>
          {rows.map((r) => (
            <ShiftRow key={r.shiftId} row={r} />
          ))}
        </div>
      )}
    </Shell>
  );
}

/** Date-range filter — preset links + a no-JS GET form (DEC-026 pattern). The
 * active chip reflects the RESOLVED scope (not "any single day"). */
function Filter({ from, to, kind }: { from: string; to: string; kind: Scope }) {
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 ${active ? "border-accent text-accent" : "border-line text-muted"}`;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/shifts" className={chip(kind === "today")}>
          Today
        </Link>
        <Link href="/admin/shifts?preset=weekend" className={chip(kind === "weekend")}>
          This weekend
        </Link>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-lg border border-line bg-bg px-2 py-1 text-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-lg border border-line bg-bg px-2 py-1 text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent"
        >
          Show
        </button>
      </form>
    </div>
  );
}

/** One neutral row → the cockpit. State is plain ink; an At-Risk row gets a quiet
 * pointer to the board (where that state is actually worked), never a red block. */
function ShiftRow({ row }: { row: AllShiftsRow }) {
  const fill =
    row.requiredSeats === 0
      ? "—"
      : `${row.confirmedSeats}/${row.requiredSeats} crewed`;
  const trips =
    row.trips.length === 0
      ? "no scheduled trip"
      : row.trips.map((t) => `${fmt12(t.time)} · ${t.pax} pax`).join("   ");
  return (
    <div className="flex items-start justify-between gap-4 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <Link
        href={`/admin/shift/${encodeURIComponent(row.shiftId)}`}
        className="flex min-w-0 flex-col"
      >
        <span className="text-ink">
          <b>{row.vesselName}</b> · {fmtDate(row.date)}
        </span>
        <span className="font-mono text-xs text-muted">{trips}</span>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {/* Neutral ink — no per-state colour (DEC-042). */}
        <span className="text-sm text-ink">
          {row.state === "AtRisk" ? "At-Risk" : row.state}
        </span>
        <span className="text-xs text-muted">{fill}</span>
        {row.state === "AtRisk" && (
          <Link href="/admin/at-risk" className="text-xs font-semibold text-accent">
            needs attention ↗
          </Link>
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <Shell width="3xl">
      <h1 className="text-lg font-semibold text-ink">Muster · All shifts</h1>
      <Notice>
        You’re signed out. Tap an operator magic link to get in — this surface is
        Spink’s.
      </Notice>
    </Shell>
  );
}
