"use client";

import { useState } from "react";
import type { Block, Location, Vessel } from "@core/domain/entities.js";
import { settingsInputClass } from "../../../../components/admin/settings-field";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { AppLink } from "../../../../components/ui/app-link";
import { UnsavedGuard } from "../../../../components/ui/unsaved-guard";
import { saveBlock, liftBlock } from "./actions";

/**
 * The /admin/blocks create/edit panel (task 12.10, DEC-125; reason-first since issue #1091) — a
 * client island because the answer to "What's happening?" swaps the field sets, a real interaction
 * a no-JS form can't express cleanly.
 *
 * **It asks the reason, not the kind.** It used to open on "Kind: Location | Vessel", which made a
 * new admin learn the data model before they could take a boat off the market. The three answers
 * map one-to-one onto the kinds (SPEC §2.10.3): a boat out is `vessel`, a dock or river closure is
 * `location`, and one departure is `vesselHold` — made on the calendar, so that answer is a pointer
 * there rather than a form (#703).
 *
 * `selected` null ⇒ a fresh create; a scoped block ⇒ edit it (kind fixed, target read-only — you
 * don't re-point a block, you unblock and remake — only the dates/times/reason are editable).
 * Submits through the server actions (`saveBlock`/`liftBlock`).
 *
 * NOTE: the date/time inputs are the plain native pickers for now — a proper 15-min-enforcing
 * picker is a separate design pass across every surface, tracked as a follow-up.
 */

const inputClass = settingsInputClass;

type Choice = "vessel" | "location" | "slot";

const CHOICES: { key: Choice; title: string; sub: string }[] = [
  { key: "vessel", title: "A boat is out of service", sub: "for one or more whole days" },
  { key: "location", title: "A dock or the river is closed", sub: "for part of a day" },
  { key: "slot", title: "Hold one departure", sub: "a private event, or anything that isn’t a booking" },
];

const TITLE: Record<Choice, string> = Object.fromEntries(CHOICES.map((c) => [c.key, c.title])) as Record<
  Choice,
  string
>;

/** Stacked field — label ON TOP, control below (the mockup's `.fld`), tied to its control by id. */
function Fld({
  label,
  sub,
  htmlFor,
  children,
}: {
  label: string;
  sub?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink">
        {label}
        {sub ? <span className="ml-1 font-normal text-muted">· {sub}</span> : null}
      </label>
      {children}
    </div>
  );
}

/** The opening choice a refused create comes back to: the draft's kind, when it is one of ours. */
function draftChoice(draftValues: Record<string, string> | null): Choice | null {
  const k = draftValues?.kind;
  return k === "vessel" || k === "location" ? k : null;
}

export function BlockEditor({
  selected,
  locations,
  vessels,
  draftValues,
  offSale,
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
  /** How many departures the selected block takes off sale — what Unblock puts back. */
  offSale: number;
}) {
  // No `vesselHold` branch, by construction: the page never selects one (its row links straight
  // to the calendar), so `selected` is a location or vessel block or null (#703).
  const editing = selected !== null;
  const loc = selected?.kind === "location" ? selected : null;
  const ves = selected?.kind === "vessel" ? selected : null;
  // Seeded from the refused draft too, not just the selection — a refused boat-out used to come
  // back as a closure form with the boat's typing in it (issue #1090).
  const [choiceState, setChoice] = useState<Choice | null>(draftChoice(draftValues));
  const [confirming, setConfirming] = useState(false);
  // In edit mode the kind is fixed (you don't turn a closure into a boat-out).
  const fixed: Choice = ves ? "vessel" : "location";
  const choice: Choice | null = editing ? fixed : choiceState;

  const locName = loc
    ? locations.find((l) => String(l.id) === String(loc.locationId))?.name ?? String(loc.locationId)
    : "";
  const vesName = ves
    ? vessels.find((v) => String(v.id) === String(ves.vesselId))?.name ?? String(ves.vesselId)
    : "";

  const cancel = (
    <button type="button" onClick={() => setChoice(null)} className="btn-secondary flex-1">
      Cancel
    </button>
  );

  return (
    <aside className="self-start rounded-card border border-line bg-card shadow-sm min-[1080px]:sticky min-[1080px]:top-4">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{choice ? TITLE[choice] : "New block"}</h2>
        {editing && (
          <AppLink href="/admin/blocks" className="btn-secondary shrink-0 px-3 py-1 text-sm">
            + New block
          </AppLink>
        )}
      </div>

      {choice === null && (
        <div className="px-4 py-3">
          <p className="mb-2 text-xs font-medium text-ink">What’s happening?</p>
          <div className="flex flex-col gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setChoice(c.key)}
                className="flex select-none flex-col rounded-lg border border-line bg-card px-3 py-2 text-left text-sm font-medium text-ink hover:border-accent hover:bg-bg"
              >
                {c.title}
                <span className="text-xs font-normal text-muted">{c.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {choice === "slot" && (
        <div className="flex flex-col gap-3 px-4 py-3">
          <AppLink href="/admin/calendar" className="text-sm font-medium text-accent">
            Pick the departure on the calendar →
          </AppLink>
          <div className="flex">{cancel}</div>
        </div>
      )}

      {(choice === "vessel" || choice === "location") && (
        <form action={saveBlock} className="px-4 py-1">
          {/* `draftValues` is non-null exactly when a refusal restored this form. */}
          <UnsavedGuard restored={draftValues !== null} />
          <input type="hidden" name="id" value={selected ? String(selected.id) : ""} />
          <input type="hidden" name="kind" value={choice} />

          {choice === "location" ? (
            <>
              <Fld label="Which location" htmlFor="blk-target">
                {editing ? (
                  <>
                    <input type="hidden" name="locationId" value={loc ? String(loc.locationId) : ""} />
                    <p className="text-sm text-ink">{locName}</p>
                  </>
                ) : (
                  <select
                    id="blk-target"
                    name="locationId"
                    defaultValue={draftValues?.locationId ?? ""}
                    className={`${inputClass} w-full`}
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
              <Fld label="Date" htmlFor="blk-date">
                <input
                  id="blk-date"
                  name="date"
                  type="date"
                  defaultValue={draftValues?.date ?? loc?.date ?? ""}
                  className={`${inputClass} w-full font-mono`}
                />
              </Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="From" htmlFor="blk-from">
                  <input
                    id="blk-from"
                    name="startTime"
                    type="time"
                    defaultValue={draftValues?.startTime ?? loc?.startTime ?? ""}
                    className={`${inputClass} w-full font-mono`}
                  />
                </Fld>
                <Fld label="To" htmlFor="blk-to">
                  <input
                    id="blk-to"
                    name="endTime"
                    type="time"
                    defaultValue={draftValues?.endTime ?? loc?.endTime ?? ""}
                    className={`${inputClass} w-full font-mono`}
                  />
                </Fld>
              </div>
            </>
          ) : (
            <>
              <Fld label="Which boat" htmlFor="blk-target">
                {editing ? (
                  <>
                    <input type="hidden" name="vesselId" value={ves ? String(ves.vesselId) : ""} />
                    <p className="text-sm text-ink">{vesName}</p>
                  </>
                ) : (
                  <select
                    id="blk-target"
                    name="vesselId"
                    defaultValue={draftValues?.vesselId ?? ""}
                    className={`${inputClass} w-full`}
                  >
                    <option value="">— pick a boat —</option>
                    {vessels.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
              </Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="From" htmlFor="blk-from">
                  <input
                    id="blk-from"
                    name="startDate"
                    type="date"
                    defaultValue={draftValues?.startDate ?? ves?.startDate ?? ""}
                    className={`${inputClass} w-full font-mono`}
                  />
                </Fld>
                <Fld label="To" sub="blank = one day" htmlFor="blk-to">
                  <input
                    id="blk-to"
                    name="endDate"
                    type="date"
                    defaultValue={draftValues?.endDate ?? ves?.endDate ?? ""}
                    className={`${inputClass} w-full font-mono`}
                  />
                </Fld>
              </div>
            </>
          )}

          <Fld label="Reason" sub="optional" htmlFor="blk-reason">
            <input
              id="blk-reason"
              name="note"
              defaultValue={draftValues?.note ?? selected?.note ?? ""}
              placeholder={choice === "vessel" ? "e.g. engine service" : "e.g. river closed for a regatta"}
              className={`${inputClass} w-full`}
            />
          </Fld>

          <div className="flex gap-3 py-3">
            <SubmitButton className="btn-primary flex-1">{editing ? "Save" : "Block it"}</SubmitButton>
            {!editing && cancel}
          </div>
        </form>
      )}

      {editing && (
        <div className="border-t border-line px-4 py-3">
          {confirming ? (
            <div data-testid="unblock-confirm" className="flex flex-col gap-3">
              <p className="text-sm text-ink">{unblockQuestion(offSale)}</p>
              <div className="flex gap-3">
                <form action={liftBlock} className="flex flex-1">
                  <input type="hidden" name="id" value={String(selected.id)} />
                  <SubmitButton className="btn-primary w-full">Unblock</SubmitButton>
                </form>
                <button type="button" onClick={() => setConfirming(false)} className="btn-secondary flex-1">
                  Keep blocked
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="btn-quiet text-bad">
              Unblock
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** The Unblock confirm — says what comes back, since a block also stops phone bookings (DEC-184). */
function unblockQuestion(n: number): string {
  if (n === 0) return "Remove this block? Nothing it covers is on sale right now.";
  return n === 1 ? "Put this departure back on sale?" : `Put these ${n} departures back on sale?`;
}
