import Link from "next/link";
import { deriveAllShifts, type AllShiftsRow } from "@core/admin/all-shifts.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { fmt12 } from "../../../lib/format";
import { splitAction } from "./actions";

/**
 * All-shifts view (#100 Part A, DEC-042) — the operator's deliberate full-
 * visibility PULL surface: every current shift, day-filterable, → the cockpit.
 *
 * This is a knowing, opt-in exception to the anti-anxiety-dashboard stance
 * (BRAND), so the brand guardrails from the @architect review are LOAD-BEARING,
 * not decoration:
 *  - Default scope is the NEXT 7 DAYS (8.2a widened it from today — DEC-042
 *    amendment, #205), still clamped to [today−30d, today+45d] — never an
 *    unbounded wall; the operator needs "what's coming up," not just today.
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
 *
 * **Edit mode (8.3b, DEC-083).** A `?mode=edit` toggle turns the read surface into
 * the Shift Builder: an un-split multi-trip vessel-day gets a Split control (pick
 * the cut → `splitShift`), and the two halves of an existing split are paired and
 * tagged. Still server-rendered on navigation, still no client JS (form + redirect,
 * DEC-026); View stays the calm default so Edit is a deliberate step in.
 */

export const dynamic = "force-dynamic";

type Mode = "view" | "edit";

type Search = {
  from?: string;
  to?: string;
  preset?: string;
  mode?: string;
  split_ok?: string;
  split_err?: string;
};

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

/** Day-section header: full weekday so a weekend reads at a glance (#122). */
function fmtDayHeader(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Group rows into day buckets (chronological) — the operator scans a real
 * weekend day-by-day, not as one flat stack (#122). **Within a day the core's
 * order is preserved** (`deriveAllShifts` sorts date → earliest departure), so a
 * day reads in time order, not alphabetical-by-vessel. Pure presentation: no core
 * change, the brand guardrails (neutral ink, no scoreboard) are untouched. */
function groupByDay(
  rows: AllShiftsRow[],
): { date: string; rows: AllShiftsRow[] }[] {
  const byDate = new Map<string, AllShiftsRow[]>();
  for (const r of rows) {
    const bucket = byDate.get(r.date);
    if (bucket) bucket.push(r);
    else byDate.set(r.date, [r]);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({ date, rows }));
}

type Scope = "today" | "next7" | "weekend" | "range";

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
  if (sp.preset === "today") {
    from = today;
    to = today;
    kind = "today";
  } else if (sp.preset === "weekend") {
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
    // Default: the next 7 days — the operator's "what's coming up" (8.2a, #205).
    // The day-only default (DEC-042) was too narrow for real pilot use — the
    // operator needs upcoming visibility, not just today.
    from = today;
    to = addDays(today, 6);
    kind = "next7";
  }
  // Clamp to the horizon, then re-guard ordering. The scope LABEL is built after
  // so the header never disagrees with the actual (clamped) window.
  if (from < minFrom) from = minFrom;
  if (to > maxTo) to = maxTo;
  if (to < from) to = from;

  const scope =
    kind === "weekend"
      ? "this weekend"
      : kind === "next7"
        ? "the next 7 days"
        : kind === "today"
          ? "today"
          : from === to
            ? fmtDate(from)
            : `${fmtDate(from)} – ${fmtDate(to)}`;
  return { from, to, scope, kind };
}

/** The filter half of the querystring (preset OR range) — no mode/feedback. Both
 * the mode toggle and the split action's return URL rebuild the window from this,
 * so a Split or a View↔Edit flip never drops the operator's chosen days. */
function filterParams(sp: Search): URLSearchParams {
  const p = new URLSearchParams();
  if (sp.preset === "today" || sp.preset === "weekend") p.set("preset", sp.preset);
  else {
    if (isDate(sp.from)) p.set("from", sp.from);
    if (isDate(sp.to)) p.set("to", sp.to);
  }
  return p;
}

/** Href for the same window in the requested mode (Edit adds `mode=edit`). */
function hrefFor(sp: Search, mode: Mode): string {
  const p = filterParams(sp);
  if (mode === "edit") p.set("mode", "edit");
  const qs = p.toString();
  return qs ? `/admin/shifts?${qs}` : "/admin/shifts";
}

export default async function AllShifts({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <SignedOut />;

  const sp = await searchParams;
  const mode: Mode = sp.mode === "edit" ? "edit" : "view";
  const now = new Date();
  const { from, to, scope, kind } = resolveWindow(sp, now);
  const repo = getRepo();

  let rows: AllShiftsRow[];
  try {
    rows = await deriveAllShifts(repo, { from, to }, now);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Can’t reach the schedule right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  // Import-diff cue (DEC-083): canonical ids of split days the LATEST pull reshaped.
  // Best-effort — a runs-table hiccup drops the cue, never the page.
  let changedDays = new Set<string>();
  try {
    const runs = await repo.listImportRuns(1);
    changedDays = new Set(runs[0]?.summary.splitDaysChanged ?? []);
  } catch {
    /* leave the cue off */
  }

  // The split action returns here (Edit mode, same window) — reused as the form's
  // `back` so it lands the operator on the two new rows.
  const back = hrefFor(sp, "edit").split("?")[1] ?? "mode=edit";

  return (
    <Shell width="3xl">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-ink">All shifts</h1>
          {/* The single line that does the brand work: this is pull, not push. */}
          <p className="text-sm text-muted">
            {mode === "edit"
              ? "Editing — split a long day into two shifts. Tap a shift to open its cockpit."
              : "Everything on the books — for reference. The board summons you; this you check when you want to."}
          </p>
        </div>
        <ModeToggle sp={sp} mode={mode} />
      </header>

      {sp.split_ok && (
        <Notice tone="ok">
          Split done — that day now shows a “before” half and a “from” half.
        </Notice>
      )}
      {sp.split_err && (
        <Notice tone="bad">
          Couldn’t split that shift — its trips may have changed since the page
          loaded. Reload and try again.
        </Notice>
      )}

      <Filter from={from} to={to} kind={kind} mode={mode} />

      {rows.length === 0 ? (
        // NOT the board's ✓ success state — a quiet day is just a quiet day.
        <Notice>No shifts {scope === "today" ? "today" : `for ${scope}`}.</Notice>
      ) : (
        // Day sections (gap-5) with tighter rows inside (gap-2) give the weekend
        // visual rhythm under real density (#122) without adding colour/scoreboard.
        <div className="flex flex-col gap-2">
          {/* The summary caption hugs the sections; day-sections (gap-5) carry
              the rhythm between them, not around this line (@ui-reviewer). */}
          <p className="text-xs text-muted">
            {rows.length} shift{rows.length === 1 ? "" : "s"} · {scope}
          </p>
          <div className="flex flex-col gap-5">
            {groupByDay(rows).map((day) => (
              <section key={day.date} className="flex flex-col gap-2">
                <h2 className="flex items-baseline justify-between border-b border-line pb-1">
                  <span className="text-sm font-semibold text-ink">
                    {fmtDayHeader(day.date)}
                  </span>
                  <span className="text-xs text-muted">
                    {day.rows.length} shift{day.rows.length === 1 ? "" : "s"}
                  </span>
                </h2>
                {day.rows.map((r) => (
                  <ShiftRow
                    key={r.shiftId}
                    row={r}
                    mode={mode}
                    back={back}
                    changed={changedDays.has(canonicalIdOf(r))}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

/** The canonical (split-day) id a row belongs to — itself for side A / un-split,
 * the `-b`-stripped sibling for side B. Only split rows ever match `splitDaysChanged`. */
function canonicalIdOf(row: AllShiftsRow): string {
  return row.split?.side === "B" ? row.shiftId.slice(0, -2) : row.shiftId;
}

/** View ↔ Edit toggle — two links preserving the current window (DEC-026: plain
 * navigation, no client JS). Active side is accent; the other is a muted step away. */
function ModeToggle({ sp, mode }: { sp: Search; mode: Mode }) {
  const seg = (active: boolean) =>
    `px-3 py-1 ${active ? "font-semibold text-accent" : "text-muted"}`;
  return (
    <div className="flex shrink-0 items-center divide-x divide-line rounded-full border border-line text-sm">
      <Link href={hrefFor(sp, "view")} className={seg(mode === "view")}>
        View
      </Link>
      <Link href={hrefFor(sp, "edit")} className={seg(mode === "edit")}>
        Edit
      </Link>
    </div>
  );
}

/** Date-range filter — preset links + a no-JS GET form (DEC-026 pattern). The
 * active chip reflects the RESOLVED scope (not "any single day"). Presets and the
 * range form both carry the current `mode`, so filtering never kicks you out of Edit. */
function Filter({
  from,
  to,
  kind,
  mode,
}: {
  from: string;
  to: string;
  kind: Scope;
  mode: Mode;
}) {
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 ${active ? "border-accent text-accent" : "border-line text-muted"}`;
  const edit = mode === "edit";
  const href = (preset?: string) => {
    const p = new URLSearchParams();
    if (preset) p.set("preset", preset);
    if (edit) p.set("mode", "edit");
    const qs = p.toString();
    return qs ? `/admin/shifts?${qs}` : "/admin/shifts";
  };
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={href("today")} className={chip(kind === "today")}>
          Today
        </Link>
        <Link href={href()} className={chip(kind === "next7")}>
          Next 7 days
        </Link>
        <Link href={href("weekend")} className={chip(kind === "weekend")}>
          This weekend
        </Link>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        {edit && <input type="hidden" name="mode" value="edit" />}
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
 * pointer to the board (where that state is actually worked), never a red block.
 * In Edit mode an un-split multi-trip day grows a Split control; the two halves of
 * an existing split are tagged (DEC-083). */
function ShiftRow({
  row,
  mode,
  back,
  changed,
}: {
  row: AllShiftsRow;
  mode: Mode;
  back: string;
  changed: boolean;
}) {
  const fill =
    row.requiredSeats === 0
      ? "—"
      : `${row.confirmedSeats}/${row.requiredSeats} crewed`;
  const trips =
    row.trips.length === 0
      ? "no scheduled trip"
      : row.trips.map((t) => `${fmt12(t.time)} · ${t.pax} pax`).join("   ");
  const splitTag =
    row.split == null
      ? null
      : row.split.side === "A"
        ? `split · before ${fmt12(row.split.cutTime)}`
        : `split · from ${fmt12(row.split.cutTime)}`;
  // Candidate cuts = this day's DISTINCT departure times after the first — each
  // leaves a non-empty "before" (at least trips[0]) and "from" (the cut trip) side.
  // Dedupe + drop `<= first` guards the rare same-time pair, which would dup a
  // `<select>` key and offer a cut with an empty before-side (splitShift rejects
  // it, but don't offer what can't work). A split side waits for Merge (8.4).
  const firstTime = row.trips[0]?.time ?? "";
  const cutOptions = [...new Set(row.trips.map((t) => t.time))].filter(
    (t) => t > firstTime,
  );
  const canSplit = mode === "edit" && row.split == null && cutOptions.length > 0;
  // Default the cut to the suggested gap boundary when it's a real candidate —
  // else the first valid cut. Always one of `cutOptions`, so the option is selected.
  const suggestedCut =
    row.splitSuggestion?.reason === "large-gap"
      ? row.splitSuggestion.boundary?.after
      : undefined;
  const defaultCut =
    suggestedCut && cutOptions.includes(suggestedCut)
      ? suggestedCut
      : cutOptions[0] ?? "";

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <Link
          href={`/admin/shift/${encodeURIComponent(row.shiftId)}`}
          className="flex min-w-0 flex-col"
        >
          {/* Vessel leads — the date now lives in the day-section header (#122). */}
          <span className="font-medium text-ink">
            {row.vesselName}
            {splitTag && (
              <span className="ml-2 text-xs font-normal text-muted">
                {splitTag}
              </span>
            )}
          </span>
          <span className="font-mono text-xs text-muted">{trips}</span>
          {row.splitSuggestion && row.split == null && (
            // Calm read-only cue (8.1/#204): Muster noticed this vessel-day might be
            // two shifts. Advisory only — acting on it is Edit mode → Split (below).
            // Muted, never an alarm token (anti-anxiety, DEC-042). Hidden once split.
            <span className="text-xs text-muted">
              {row.splitSuggestion.reason === "large-gap" &&
              row.splitSuggestion.boundary
                ? `long gap ${fmt12(row.splitSuggestion.boundary.before)}–${fmt12(row.splitSuggestion.boundary.after)} · could be two shifts`
                : "long day · could be two shifts"}
            </span>
          )}
          {changed && (
            // Import-diff cue (DEC-083): the last pull moved trips across this
            // split — a nudge to eyeball that the cut still makes sense. Muted.
            <span className="text-xs text-muted">
              changed in the last pull — check the split
            </span>
          )}
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

      {canSplit && (
        // No-JS Split (DEC-026): pick the cut → server action → re-form. The cut
        // options are this day's own departure times (each makes a non-empty
        // before/from split), so a picked cut always partitions.
        <form
          action={splitAction}
          className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm"
        >
          <input type="hidden" name="shiftId" value={row.shiftId} />
          <input type="hidden" name="back" value={back} />
          <label className="flex items-center gap-1.5 text-muted">
            Split at
            <select
              name="cut"
              defaultValue={defaultCut}
              className="rounded-lg border border-line bg-bg px-2 py-1 font-mono text-ink"
            >
              {cutOptions.map((t) => (
                <option key={t} value={t}>
                  {fmt12(t)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent"
          >
            Split
          </button>
          <span className="text-xs text-muted">
            makes two shifts — before &amp; from the cut
          </span>
        </form>
      )}
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
