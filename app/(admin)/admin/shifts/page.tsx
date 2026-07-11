import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { deriveAllShifts, type AllShiftsRow } from "@core/admin/all-shifts.js";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import {
  ShiftCockpit,
  type CockpitSearch,
} from "../../../../components/assignment/shift-cockpit";
import { SeatPips, AssignedCrew } from "../../../../components/admin/seat-pips";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { fmt12 } from "../../../lib/format";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { splitAction, mergeAction } from "./actions";

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
 *
 * **Two-pane (9.5, DEC-085).** `?sel=<shiftId>` opens the shared cockpit body
 * (`components/assignment/shift-cockpit.tsx`) alongside the board: desktop shows
 * both panes (6xl grid), mobile shows the cockpit full-screen (the list is
 * display-hidden — its "← All shifts" link is the way back). Selection is a plain
 * row `<AppLink>`; deep links from At-Risk/outbox keep the standalone route. `sel`
 * rides the filter-param set so mode/filter/split navigation never closes the pane.
 */

export const dynamic = "force-dynamic";

type Mode = "view" | "edit";

/** Board params. Shares the URL with the cockpit's CockpitSearch namespace when
 * `?sel` is set — keep the two disjoint. */
type Search = CockpitSearch & {
  from?: string;
  to?: string;
  preset?: string;
  mode?: string;
  split_ok?: string;
  split_err?: string;
  merge_ok?: string;
  merge_err?: string;
  /** Open cockpit pane (DEC-085). */
  sel?: string;
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

/** The filter half of the querystring (preset OR range) — no mode/sel/feedback.
 * Both the mode toggle and the split action's return URL rebuild the window from
 * this, so a Split or a View↔Edit flip never drops the operator's chosen days.
 * This is also the `ctx` the cockpit's action forms carry (DEC-085) — the action
 * appends `sel` + its feedback code itself, so neither belongs here. */
function filterParams(sp: Search): URLSearchParams {
  const p = new URLSearchParams();
  if (sp.preset === "today" || sp.preset === "weekend") p.set("preset", sp.preset);
  else {
    if (isDate(sp.from)) p.set("from", sp.from);
    if (isDate(sp.to)) p.set("to", sp.to);
  }
  return p;
}

/** Href for the same window in the requested mode (Edit adds `mode=edit`).
 * `sel` is part of the preserved state (DEC-085): defaulting to the current
 * selection keeps the pane open across mode flips and split/merge round-trips;
 * pass an explicit id for a row link. */
function hrefFor(sp: Search, mode: Mode, sel: string | undefined = sp.sel): string {
  const p = filterParams(sp);
  if (mode === "edit") p.set("mode", "edit");
  if (sel) p.set("sel", sel);
  const qs = p.toString();
  return qs ? `/admin/shifts?${qs}` : "/admin/shifts";
}

export default async function AllShifts({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  const sp = await searchParams;
  const mode: Mode = sp.mode === "edit" ? "edit" : "view";
  const sel = typeof sp.sel === "string" && sp.sel !== "" ? sp.sel : null;
  const now = new Date();
  const { from, to, scope, kind } = resolveWindow(sp, now);
  const repo = getRepo();
  // Operator name for the cockpit's guest intro text (#345) — only when a pane is
  // open. Best-effort; a hiccup just omits the sender name.
  const senderName = sel
    ? (await repo.getAdmin(subject.id).catch(() => null))?.name
    : undefined;

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

  // Import-diff cues (DEC-083 + its 9.10 amendment): from the LATEST pull's
  // summary, the canonical ids of split days it reshaped AND the raw ids of
  // shifts it freshly minted (`createdShiftIds` absent on pre-9.10 runs → []).
  // One read, best-effort — a runs-table hiccup drops the cues, never the page.
  let changedDays = new Set<string>();
  let newShifts = new Set<string>();
  try {
    const runs = await repo.listImportRuns(1);
    changedDays = new Set(runs[0]?.summary.splitDaysChanged ?? []);
    newShifts = new Set(runs[0]?.summary.createdShiftIds ?? []);
  } catch {
    /* leave the cues off */
  }

  // The split/merge actions return here (Edit mode, same window + selection) —
  // reused as each form's `back` so the operator lands where they were.
  const back = hrefFor(sp, "edit").split("?")[1] ?? "mode=edit";

  // The cockpit pane's host context (DEC-085): window + mode, never sel/feedback
  // — its action forms carry it, and `finish()` appends sel + the feedback code.
  const ctxParams = filterParams(sp);
  if (mode === "edit") ctxParams.set("mode", "edit");
  const ctx = ctxParams.toString();
  const boardHref = ctx ? `/admin/shifts?${ctx}` : "/admin/shifts";

  // `merge_ok` carries the count of freed crew notified (a number, not prose —
  // DEC-026); numeric-guarded so a crafted param can't inject text.
  const mergedCount =
    sp.merge_ok !== undefined && /^\d+$/.test(sp.merge_ok)
      ? Number(sp.merge_ok)
      : null;

  // The Merge control lives on side A; if a collapsed morning hid side A, fall back
  // to side B so Merge stays reachable — exactly one Merge control per split pair.
  const sideAVisible = new Set(
    rows.filter((r) => r.split?.side === "A").map((r) => r.shiftId),
  );
  const canMergeRow = (r: AllShiftsRow): boolean =>
    r.split != null &&
    (r.split.side === "A" || !sideAVisible.has(canonicalIdOf(r)));

  const board = (
    <>
      <header className="flex items-center justify-between gap-4">
        {/* The View/Edit toggle is the mode signal — no subtitle needed. The
            DEC-042 pull-not-push posture is held structurally (neutral ink, no
            scoreboard, a separate empty state), not by a line of prose. */}
        <h1 className="text-xl font-semibold text-ink">All shifts</h1>
        <ModeToggle sp={sp} mode={mode} />
      </header>

      {sp.split_ok && <Notice tone="ok">Split done.</Notice>}
      {sp.split_err && (
        <Notice tone="bad">
          Couldn’t split that shift — its trips may have changed since the page
          loaded. Reload and try again.
        </Notice>
      )}
      {mergedCount !== null && (
        <Notice tone="ok">
          {mergedCount === 0
            ? "Merged into one shift."
            : `Merged into one shift — ${mergedCount} crew notified they’re off the later half.`}
        </Notice>
      )}
      {sp.merge_err && (
        <Notice tone="bad">
          Couldn’t merge — the shift may have changed since the page loaded. Reload
          and try again.
        </Notice>
      )}

      <Filter from={from} to={to} kind={kind} mode={mode} sel={sel} />

      {rows.length === 0 ? (
        // NOT the board's ✓ success state — a quiet day is just a quiet day.
        <Notice>No shifts {scope === "today" ? "today" : `for ${scope}`}.</Notice>
      ) : (
        // Day sections (gap-5) with tighter rows inside (gap-2) give the weekend
        // visual rhythm under real density (#122) without adding colour/scoreboard.
        <div className="flex flex-col gap-2">
          {/* The summary caption hugs the sections; day-sections (gap-5) carry
              the rhythm between them, not around this line (@ui-reviewer). */}
          <p className="text-xs text-faint">
            {rows.length} shift{rows.length === 1 ? "" : "s"} · {scope}
          </p>
          <div className="flex flex-col gap-5">
            {groupByDay(rows).map((day) => (
              <section key={day.date} className="flex flex-col gap-2">
                <h2 className="flex items-baseline justify-between border-b border-line pb-1">
                  <span className="text-sm font-semibold text-ink">
                    {fmtDayHeader(day.date)}
                  </span>
                  <span className="text-xs text-faint">
                    {day.rows.length} shift{day.rows.length === 1 ? "" : "s"}
                  </span>
                </h2>
                {day.rows.map((r) => (
                  <ShiftRow
                    key={r.shiftId}
                    row={r}
                    mode={mode}
                    back={back}
                    href={hrefFor(sp, mode, r.shiftId)}
                    selected={sel === r.shiftId}
                    changed={changedDays.has(canonicalIdOf(r))}
                    isNew={newShifts.has(r.shiftId)}
                    canMerge={canMergeRow(r)}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );

  if (!sel) return <Shell width="3xl">{board}</Shell>;

  // Two-pane host (DEC-085): desktop = board + cockpit side by side; mobile =
  // the cockpit full-screen (the list is display-hidden; the cockpit's own
  // "← All shifts" link, rendered when ctx is set, is the way back).
  return (
    <Shell width="6xl" fill>
      {/* Independent-scroll columns on desktop (#253): the grid fills the
          viewport-bounded shell (lg:flex-1 lg:min-h-0) and each column carries its
          own scroll (lg:overflow-y-auto lg:min-h-0). The window itself never
          scrolls on lg, so opening a pane from deep in a long list — or switching
          the selected row — can't snap the list to the top; the cockpit stays put
          while you scroll the list, and vice-versa. Below lg none of this applies:
          normal-flow full-screen drill-in, the list display-hidden (DEC-085). */}
      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] lg:gap-6">
        <div
          data-testid="board-col"
          className="hidden min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:pr-1"
        >
          {board}
        </div>
        <div
          data-testid="pane-col"
          className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1"
        >
          <div className="hidden lg:flex lg:justify-end">
            <AppLink
              href={boardHref}
              className="inline-flex min-h-9 items-center px-1.5 text-xs font-semibold text-accent"
            >
              Close<span aria-hidden="true">&nbsp;✕</span>
            </AppLink>
          </div>
          <ShiftCockpit shiftId={sel} sp={sp} ctx={ctx} headingLevel="h2" senderName={senderName} />
        </div>
      </div>
    </Shell>
  );
}

/** The canonical (split-day) id a row belongs to — itself for side A / un-split,
 * the `-b`-stripped sibling for side B. Only split rows ever match `splitDaysChanged`. */
function canonicalIdOf(row: AllShiftsRow): string {
  return row.split?.side === "B" ? row.shiftId.slice(0, -2) : row.shiftId;
}

/** View ↔ Edit toggle — the surface's mode signal now that the subtitle is gone,
 * so it's a pronounced segmented control: the active mode is a filled accent pill
 * (the app's established "selected" idiom — see the crew primary buttons), the
 * other a muted step away. Plain navigation, no client JS (DEC-026); each side
 * preserves the current window (and open pane — DEC-085). `aria-current` carries
 * the mode to assistive tech now that fill, not prose, marks it. */
function ModeToggle({ sp, mode }: { sp: Search; mode: Mode }) {
  const seg = (active: boolean) =>
    `rounded-full px-4 py-1.5 font-semibold ${active ? "bg-accent text-white" : "text-muted"}`;
  // The active mode is an inert <span>, not a <AppLink> to itself — clicking the mode
  // you're already on shouldn't fire a navigation + full re-render of this
  // force-dynamic page. Only the OTHER mode navigates.
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-card p-0.5 text-sm">
      {mode === "view" ? (
        <span aria-current="page" className={seg(true)}>
          View
        </span>
      ) : (
        <AppLink href={hrefFor(sp, "view")} className={`${seg(false)} pressable`}>
          View
        </AppLink>
      )}
      {mode === "edit" ? (
        <span aria-current="page" className={seg(true)}>
          Edit
        </span>
      ) : (
        <AppLink href={hrefFor(sp, "edit")} className={`${seg(false)} pressable`}>
          Edit
        </AppLink>
      )}
    </div>
  );
}

/** Date-range filter — preset links + a no-JS GET form (DEC-026 pattern). The
 * active chip reflects the RESOLVED scope (not "any single day"). Presets and the
 * range form carry the current `mode` AND `sel` (DEC-085), so filtering never
 * kicks you out of Edit or closes the open pane. */
function Filter({
  from,
  to,
  kind,
  mode,
  sel,
}: {
  from: string;
  to: string;
  kind: Scope;
  mode: Mode;
  sel: string | null;
}) {
  const chip = (active: boolean) =>
    `pressable rounded-full border px-3 py-1 ${active ? "border-accent text-accent" : "border-line text-muted"}`;
  const edit = mode === "edit";
  const href = (preset?: string) => {
    const p = new URLSearchParams();
    if (preset) p.set("preset", preset);
    if (edit) p.set("mode", "edit");
    if (sel) p.set("sel", sel);
    const qs = p.toString();
    return qs ? `/admin/shifts?${qs}` : "/admin/shifts";
  };
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AppLink href={href("today")} className={chip(kind === "today")}>
          Today
        </AppLink>
        <AppLink href={href()} className={chip(kind === "next7")}>
          Next 7 days
        </AppLink>
        <AppLink href={href("weekend")} className={chip(kind === "weekend")}>
          This weekend
        </AppLink>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        {edit && <input type="hidden" name="mode" value="edit" />}
        {sel && <input type="hidden" name="sel" value={sel} />}
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
        <GetFormSubmit className="rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent">
          Show
        </GetFormSubmit>
      </form>
    </div>
  );
}

/** One neutral row → the cockpit. State is plain ink; an At-Risk row gets a quiet
 * pointer to the board (where that state is actually worked), never a red block.
 * In Edit mode an un-split multi-trip day grows a Split control; the two halves of
 * an existing split are tagged (DEC-083). The row link opens the cockpit PANE
 * (`?sel=` — DEC-085): a new pane on desktop, full-screen drill-in on mobile; the
 * selected row's border marks the open pane (selection state, not risk colour). */
function ShiftRow({
  row,
  mode,
  back,
  href,
  selected,
  changed,
  isNew,
  canMerge,
}: {
  row: AllShiftsRow;
  mode: Mode;
  back: string;
  href: string;
  selected: boolean;
  changed: boolean;
  /** The latest pull minted this shift (9.10) — a calm "it's new" fact. */
  isNew: boolean;
  canMerge: boolean;
}) {
  const fill =
    row.requiredSeats === 0
      ? "—"
      : `${row.confirmedSeats}/${row.requiredSeats} crewed`;
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
    <div
      // Press cue for the stretched-link row (#250): a calm whole-card background
      // dip on :active — fires because the row `<AppLink>` is in the card's activation
      // chain. Background, NOT transform/filter, so it can't collapse the link's
      // `after:inset-0` overlay (that would establish a containing block).
      className={`relative flex flex-col gap-2 rounded-card border bg-card px-4 py-3 shadow-sm active:bg-accent/10 ${
        selected ? "border-accent" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Stretched link (9.8): the whole card opens the cockpit; the split/
            merge forms and the At-Risk pointer below are positioned, so they
            stack above the ::after overlay and stay independently tappable. */}
        {/* AppLink spinner="overlay" (#250): from the click until the cockpit pane
            renders, a scrim + centered spinner covers the row — "you clicked, it's
            loading." Overlays the relative card (the link isn't a positioned box). */}
        <AppLink
          href={href}
          spinner="overlay"
          className="flex min-w-0 flex-col gap-0.5 after:absolute after:inset-0 after:content-['']"
        >
          {/* Vessel leads — the date now lives in the day-section header (#122).
              The dot is the DEC-086 identity hue: same boat, same hue, always —
              it answers "which boat", never state (aria-hidden; the name is the
              accessible answer). */}
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(row.vesselId)}`}
            />
            {row.vesselName}
            {splitTag && (
              <span className="text-xs font-normal text-muted">{splitTag}</span>
            )}
          </span>
          {/* The LIST stays scannable (operator QA on 9.5): a multi-trip day
              reads as "start · N trips" — the per-trip detail lives in the
              cockpit. A single trip keeps its time · pax fact. (Also renders
              the 9.6 run-on wrap moot: one compact span either way.) */}
          <span className="font-mono text-xs text-muted">
            {row.trips.length === 0
              ? "no scheduled trip"
              : row.trips.length === 1
                ? `${fmt12(row.trips[0]!.time)} · ${row.trips[0]!.pax} pax`
                : `${fmt12(row.trips[0]!.time)} · ${row.trips.length} trips`}
          </span>
          {/* Pips + assigned crew on one line (Variant C, #310): the pips lead,
              the names sit inline to their right in pip order, wrapping under
              when the row is tight (375px / many seats). */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SeatPips seats={row.seats} />
            <AssignedCrew seats={row.seats} />
          </span>
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
          {isNew && (
            // Freshly-spawned cue (9.10, DEC-083 amendment): the last pull
            // minted this shift. A calm fact in the DEC-083 idiom — never the
            // amber "new · review" approval demand DEC-082 killed; nothing to
            // approve, the engine is already working it.
            <span className="text-xs text-muted">new in the last pull</span>
          )}
        </AppLink>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {/* Neutral ink — no per-state colour (DEC-042). */}
          <span className="text-sm text-ink">
            {row.state === "AtRisk" ? "At-Risk" : row.state}
          </span>
          <span className="text-xs text-muted">{fill}</span>
          {row.state === "AtRisk" && (
            <AppLink
              href="/admin/at-risk"
              className="relative inline-flex min-h-9 items-center text-xs font-semibold text-accent"
            >
              needs attention<span aria-hidden="true">&nbsp;↗</span>
            </AppLink>
          )}
        </div>
      </div>

      {canSplit && (
        // No-JS Split (DEC-026): pick the cut → server action → re-form. The cut
        // options are this day's own departure times (each makes a non-empty
        // before/from split), so a picked cut always partitions.
        <form
          action={splitAction}
          className="relative flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm"
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
          <SubmitButton className="rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent">
            Split
          </SubmitButton>
        </form>
      )}

      {mode === "edit" && canMerge && (
        // No-JS Merge (DEC-083 inverse): recombine the split's two sides into one
        // shift. Posts the CANONICAL id (mergeShift requires it) — for a side-B row
        // that's the `-b`-stripped id. Any dropped far-side crew get an assignment
        // notice (DEC-084), surfaced back as the merge count.
        <form
          action={mergeAction}
          className="relative flex items-center gap-2 border-t border-line pt-2 text-sm"
        >
          <input type="hidden" name="shiftId" value={canonicalIdOf(row)} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="rounded-lg border border-line bg-bg px-3 py-1 font-semibold text-accent">
            Merge back into one shift
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
