import { AppLink } from "../ui/app-link";
import { SubmitButton } from "../ui/submit-button";
import { SeatPips, AssignedCrew } from "./seat-pips";
import type { AllShiftsRow } from "@core/admin/all-shifts.js";
import { fmt12 } from "../../app/lib/format";
import { vesselHueClass } from "../../app/lib/vessel-hue";
import { splitAction, mergeAction } from "../../app/(admin)/admin/shifts/actions";
import type { Mode } from "./shifts-view-types";

/** The canonical (split-day) id a row belongs to — itself for side A / un-split,
 * the `-b`-stripped sibling for side B. Only split rows ever match `splitDaysChanged`. */
export function canonicalIdOf(row: AllShiftsRow): string {
  return row.split?.side === "B" ? row.shiftId.slice(0, -2) : row.shiftId;
}

/** One neutral row → the cockpit. State is plain ink; an At-Risk row gets a quiet
 * pointer to the board (where that state is actually worked), never a red block.
 * In Edit mode an un-split multi-trip day grows a Split control; the two halves of
 * an existing split are tagged (DEC-083). The row link opens the cockpit PANE
 * (`?sel=` — DEC-085): a new pane on desktop, full-screen drill-in on mobile; the
 * selected row's border marks the open pane (selection state, not risk colour). */
export function ShiftRow({
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
      // Scroll target for the selected-row reveal (#365, DEC-112): the
      // `RevealSelectedRow` client island finds this row by id and nudges
      // board-col's own scroll so a click doesn't snap the list back to the top on
      // a long list. Kept keyed off `shiftId` (matches the React key + split-side
      // ids), so no collisions.
      id={`shiftrow-${row.shiftId}`}
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
