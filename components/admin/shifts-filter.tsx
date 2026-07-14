import { AppLink } from "../ui/app-link";
import { CrewSelect } from "./crew-select";
import { GetFormSubmit } from "../ui/get-form-submit";
import type { Mode, Scope } from "./shifts-view-types";

/** Date-range + crew filter — preset links, a no-JS date GET form, and a no-JS
 * crew dropdown (DEC-026 pattern). The active chip reflects the RESOLVED scope
 * (not "any single day"). Every control carries the current `mode`, `sel`
 * (DEC-085), AND the selected `crew` (#330), so changing one axis never kicks you
 * out of Edit, closes the open pane, or drops the crew filter. */
export function Filter({
  from,
  to,
  kind,
  presetParam,
  mode,
  sel,
  crew,
  crewList,
  showCancelled,
  cancelledHref,
}: {
  from: string;
  to: string;
  kind: Scope;
  /** The RAW `?preset` param — carried by the crew form so picking a crew stays on
   *  the active preset/range (#330). */
  presetParam?: string;
  mode: Mode;
  sel: string | null;
  crew: string | null;
  crewList: { id: string; name: string }[];
  /** #416: is the Cancelled fold-in currently on? */
  showCancelled: boolean;
  /** #416: href that flips the show-cancelled toggle, preserving the rest of state. */
  cancelledHref: string;
}) {
  const chip = (active: boolean) =>
    `pressable rounded-full border px-3 py-1 ${active ? "border-accent text-accent" : "border-line text-muted"}`;
  const edit = mode === "edit";
  const href = (preset?: string) => {
    const p = new URLSearchParams();
    if (preset) p.set("preset", preset);
    if (edit) p.set("mode", "edit");
    if (sel) p.set("sel", sel);
    // Preset chips keep the active crew filter selected as you switch windows (#330).
    if (crew) p.set("crew", crew);
    // ...and keep Show-cancelled on across a window change (#416 persistence).
    if (showCancelled) p.set("cancelled", "1");
    const qs = p.toString();
    return qs ? `/admin/shifts?${qs}` : "/admin/shifts";
  };
  // Re-assert the ACTIVE window on the crew form so picking a crew stays in the
  // window you're looking at (#330 — "what you see is what you filter"; the crew
  // filter never changes the window). An explicit preset is carried; a bare default
  // (no preset) carries nothing and falls back to the default 7-day week — same
  // window either way.
  const KNOWN_PRESETS = new Set([
    "today",
    "weekend",
    "next7",
    "next8to15",
    "days30",
  ]);
  const activePreset =
    presetParam && KNOWN_PRESETS.has(presetParam) ? presetParam : null;
  const windowHidden = activePreset ? (
    <input type="hidden" name="preset" value={activePreset} />
  ) : kind === "range" ? (
    <>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
    </>
  ) : null;
  // Open the More panel by default when a custom range or crew filter is actually
  // in effect, so an active advanced filter is never hidden behind the toggle.
  const moreOpen = kind === "range" || !!crew || showCancelled;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AppLink href={href("today")} className={chip(kind === "today")}>
          Today
        </AppLink>
        <AppLink href={href("weekend")} className={chip(kind === "weekend")}>
          Weekend
        </AppLink>
        <AppLink href={href("next7")} className={chip(kind === "next7")}>
          Week
        </AppLink>
        <AppLink href={href("next8to15")} className={chip(kind === "next8to15")}>
          2 Weeks out
        </AppLink>
        <AppLink href={href("days30")} className={chip(kind === "days30")}>
          30 Days
        </AppLink>
      </div>

      {/* Custom date range + crew filter, tucked behind a no-JS <details> toggle
          (DEC-026 — native disclosure, no client JS). Open by default when one of
          them is actually active so an in-effect filter is never hidden. */}
      <details open={moreOpen} className="flex flex-col gap-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-accent">
          More filters
        </summary>

        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          {edit && <input type="hidden" name="mode" value="edit" />}
          {sel && <input type="hidden" name="sel" value={sel} />}
          {/* Keep the crew filter + Show-cancelled across an explicit date submit. */}
          {crew && <input type="hidden" name="crew" value={crew} />}
          {showCancelled && <input type="hidden" name="cancelled" value="1" />}
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

        {/* Crew filter (#330, DEC-042 amendment) — narrow the board to one crew
            member's shifts. A no-JS GET form (DEC-026): the window hidden inputs
            preserve the active preset/range so the pick stays in the window you're
            looking at ("what you see is what you filter" — the crew filter never
            changes the window). No per-crew count/scoreboard — that's the
            monitor-bait failure mode this surface is guarded against (DEC-042). */}
        {/* Crew filter auto-submits on change — no button (requested). CrewSelect
            is the client island that soft-pushes, reading these hidden inputs. */}
        <form method="get" className="flex flex-wrap items-end gap-2 pt-2 text-sm">
          {edit && <input type="hidden" name="mode" value="edit" />}
          {sel && <input type="hidden" name="sel" value={sel} />}
          {windowHidden}
          {/* Keep Show-cancelled on when the crew select auto-submits (#416). */}
          {showCancelled && <input type="hidden" name="cancelled" value="1" />}
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            Crew
            <CrewSelect
              crew={crew}
              crewList={crewList}
              className="rounded-lg border border-line bg-bg px-2 py-1 text-ink"
            />
          </label>
        </form>

        {/* Show-cancelled toggle (#416) — a rare diagnostic axis, so it lives
            below the fold inside More filters (not up with the window presets):
            off by default (DEC-042 current-only), on folds Cancelled shifts into
            the list greyed. No-JS toggle link (DEC-026); when on, `moreOpen` keeps
            this panel open so the active toggle is never hidden. */}
        <div className="flex items-center pt-2 text-sm">
          <AppLink
            href={cancelledHref}
            aria-pressed={showCancelled}
            className={chip(showCancelled)}
          >
            <span aria-hidden="true">{showCancelled ? "☑" : "☐"}</span> Show cancelled
          </AppLink>
        </div>
      </details>
    </div>
  );
}
