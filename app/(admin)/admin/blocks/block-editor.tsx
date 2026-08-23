"use client";

import { useState } from "react";
import type { Block, Location, Vessel } from "@core/domain/entities.js";
import { settingsInputClass } from "../../../../components/admin/settings-field";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { AppLink } from "../../../../components/ui/app-link";
import { formatDay, formatTime } from "./block-sections";
import { saveBlock, liftBlock } from "./actions";

/**
 * The /admin/blocks create/edit panel (task 12.10, DEC-125) — a client island because the kind
 * toggle SWAPS the field sets (Location vs Vessel), a real interaction a no-JS form can't
 * express cleanly. `selected` null ⇒ a fresh create (kind toggle + editable target); a scoped
 * block ⇒ edit it (kind fixed, target read-only — you don't re-point a block, you delete and
 * remake — only the dates/times/reason are editable). A single-slot block never reaches here —
 * it is made and unmade on the calendar, and its registry row links straight there (#703).
 * Submits through the server actions (`saveBlock`/`liftBlock`).
 *
 * NOTE: the date/time inputs are the plain native pickers for now — a proper 15-min-enforcing,
 * consistent date/time picker (and unifying the location-vs-vessel date/time shape) is a
 * separate design pass across every surface, tracked as a follow-up.
 */

const inputClass = settingsInputClass;

/** Stacked field — label ON TOP, control below (the mockup's `.fld`), not the label-left grid. */
function Fld({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <label className="mb-1 block text-xs font-medium text-ink">
        {label}
        {sub ? <span className="ml-1 font-normal text-faint">· {sub}</span> : null}
      </label>
      {children}
    </div>
  );
}

export function BlockEditor({
  selected,
  locations,
  vessels,
  draftValues,
}: {
  selected: Block | null;
  locations: Location[];
  vessels: Vessel[];
  /**
   * The refused submission's values, or null when there was no refusal (#780). Plain data, not
   * a `FormDraft` — this is a client island and the draft's accessors can't cross the boundary,
   * so `page.tsx` reads the cookie and flattens it. Every value is a string, including `""` for
   * a field the operator deliberately cleared, which is why the defaults below use `??` and not
   * `||`: an empty answer is still their answer.
   */
  draftValues: Record<string, string> | null;
}) {
  // No `vesselHold` branch, by construction: the page never selects one (its row links straight
  // to the calendar), so `selected` is a location or vessel block or null. The read-only aside
  // that used to live here showed the boat, day and time — every one of them already on the row
  // the operator clicked — plus a link onward to the calendar. Two clicks to reach a page the
  // row could have gone to directly (operator, 2026-08-08, #703).
  const editing = selected !== null;
  const loc = selected?.kind === "location" ? selected : null;
  const ves = selected?.kind === "vessel" ? selected : null;
  const [kindState, setKind] = useState<"location" | "vessel">(
    selected?.kind === "vessel" ? "vessel" : "location",
  );
  // In edit mode the kind is fixed (you don't turn a location block into a vessel block).
  const kind: "location" | "vessel" = editing ? (ves ? "vessel" : "location") : kindState;

  const locName = loc
    ? locations.find((l) => String(l.id) === String(loc.locationId))?.name ?? String(loc.locationId)
    : "";
  const vesName = ves
    ? vessels.find((v) => String(v.id) === String(ves.vesselId))?.name ?? String(ves.vesselId)
    : "";

  return (
    <aside className="self-start rounded-card border border-line bg-card shadow-sm min-[1080px]:sticky min-[1080px]:top-4">
      {editing && (
        <div className="flex justify-end border-b border-line px-4 py-2">
          <AppLink href="/admin/blocks" className="text-xs text-accent">
            + New block
          </AppLink>
        </div>
      )}

      <form action={saveBlock} className="px-4 py-1">
        <input type="hidden" name="id" value={selected ? String(selected.id) : ""} />
        <input type="hidden" name="kind" value={kind} />

        {/* Kind toggle — create only; in edit the kind is fixed. Buttons are equal width. */}
        {!editing && (
          <Fld label="Kind">
            <div className="flex gap-2" role="group" aria-label="Kind">
              {(["location", "vessel"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`flex flex-1 basis-0 cursor-pointer select-none flex-col rounded-lg border px-3 py-1.5 text-left text-sm ${
                    kind === k
                      ? "border-accent bg-bg font-medium text-ink"
                      : "border-line bg-card text-muted"
                  }`}
                >
                  {k === "location" ? "Location" : "Vessel"}
                  <span className="text-[10px] font-normal text-faint">
                    {k === "location" ? "a place closes" : "boat out"}
                  </span>
                </button>
              ))}
            </div>
          </Fld>
        )}

        {kind === "location" ? (
          <div className={editing ? "" : "border-t border-line pt-1"}>
            <Fld label="Location">
              {editing ? (
                <>
                  <input type="hidden" name="locationId" value={loc ? String(loc.locationId) : ""} />
                  <p className="text-sm text-ink">{locName}</p>
                </>
              ) : (
                <select
                  name="locationId"
                  defaultValue={draftValues?.locationId ?? ""}
                  className={`${inputClass} w-full`}
                  aria-label="Block location"
                >
                  <option value="">— pick a location —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </Fld>
            <Fld label="Date">
              <input
                name="date"
                type="date"
                defaultValue={draftValues?.date ?? loc?.date ?? ""}
                className={`${inputClass} w-full font-mono`}
                aria-label="Block date"
              />
            </Fld>
            <Fld label="Time window">
              <span className="flex flex-wrap items-center gap-2">
                <input
                  name="startTime"
                  type="time"
                  defaultValue={draftValues?.startTime ?? loc?.startTime ?? ""}
                  className={`${inputClass} font-mono`}
                  aria-label="Block start time"
                />
                <span className="text-xs text-faint">to</span>
                <input
                  name="endTime"
                  type="time"
                  defaultValue={draftValues?.endTime ?? loc?.endTime ?? ""}
                  className={`${inputClass} font-mono`}
                  aria-label="Block end time"
                />
              </span>
            </Fld>
          </div>
        ) : (
          <div className={editing ? "" : "border-t border-line pt-1"}>
            <Fld label="Vessel">
              {editing ? (
                <>
                  <input type="hidden" name="vesselId" value={ves ? String(ves.vesselId) : ""} />
                  <p className="text-sm text-ink">{vesName}</p>
                </>
              ) : (
                <select
                  name="vesselId"
                  defaultValue={draftValues?.vesselId ?? ""}
                  className={`${inputClass} w-full`}
                  aria-label="Block vessel"
                >
                  <option value="">— pick a vessel —</option>
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </Fld>
            <Fld label="Out of service">
              <span className="flex flex-wrap items-center gap-2">
                <input
                  name="startDate"
                  type="date"
                  defaultValue={draftValues?.startDate ?? ves?.startDate ?? ""}
                  className={`${inputClass} font-mono`}
                  aria-label="Block start date"
                />
                <span className="text-xs text-faint">to</span>
                <input
                  name="endDate"
                  type="date"
                  defaultValue={draftValues?.endDate ?? ves?.endDate ?? ""}
                  className={`${inputClass} font-mono`}
                  aria-label="Block end date"
                />
              </span>
            </Fld>
          </div>
        )}

        <div className="border-t border-line">
          <Fld label="Reason" sub="optional">
            <input
              name="note"
              defaultValue={draftValues?.note ?? selected?.note ?? ""}
              placeholder="e.g. river closed, engine service"
              className={`${inputClass} w-full`}
              aria-label="Block reason"
            />
          </Fld>
        </div>

        <div className="py-3">
          <SubmitButton className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-white">
            Save
          </SubmitButton>
        </div>
      </form>

      {editing && (
        <form action={liftBlock} className="border-t border-line px-4 py-3">
          <input type="hidden" name="id" value={String(selected.id)} />
          <SubmitButton className="text-xs font-semibold text-bad hover:underline">
            Delete
          </SubmitButton>
        </form>
      )}
    </aside>
  );
}
