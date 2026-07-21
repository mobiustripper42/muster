import type { Location, Vessel } from "@core/domain/entities.js";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { saveBlock } from "./actions";

/**
 * /admin/blocks presentational bits (task 12.10, DEC-125), split out of `page.tsx` to keep the
 * page shell (data load + impact math + registry) reviewable. The registry list lives in the
 * page (it needs the server-computed impact); this file owns the create aside + the kind pill +
 * the display formatters, all server-rendered, no-JS (DEC-026).
 */

const inputClass = settingsInputClass;

export type BlockKind = "location" | "vessel" | "vesselHold";

/** Kind → pill label + a NEUTRAL slate dot for location, a warn-red for vessel, accent for hold.
 *  The dot is deliberately NOT a vessel hue for location/hold-family (that hue carries boat
 *  identity elsewhere — DEC-086; the mockup calls this collision out). */
export const KIND_META: Record<BlockKind, { label: string; dot: string; pill: string }> = {
  location: { label: "Location", dot: "bg-muted", pill: "border-line bg-bg text-muted" },
  vessel: { label: "Vessel", dot: "bg-bad", pill: "border-bad-line bg-bad-bg text-bad" },
  vesselHold: { label: "Hold", dot: "bg-accent", pill: "border-line bg-bg text-ink" },
};

/** "2026-08-12" → "Wed Aug 12". Read at UTC midnight so the label never shifts by TZ. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "13:30" → "1:30 PM". Falls back to the raw string if it isn't HH:MM. */
export function formatTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${ampm}`;
}

/** Integer cents → "$1,098". */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function KindPill({ kind }: { kind: BlockKind }) {
  const meta = KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${meta.pill}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-sm ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * The "New block" create aside — SCOPED kinds only (Location + Vessel). A single native form:
 * a kind radio picks which the action reads, and BOTH field sets render (no-JS, so we can't
 * show/hide by script — the action validates only the chosen kind's fields). A hold / one-off
 * slot blackout is made on the calendar, and appears in the registry read-only.
 */
export function CreateBlockAside({
  locations,
  vessels,
}: {
  locations: Location[];
  vessels: Vessel[];
}) {
  return (
    <aside className="self-start rounded-card border border-line bg-card shadow-sm min-[1080px]:sticky min-[1080px]:top-4">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">New block</h2>
      </div>
      <form action={saveBlock} className="px-4 py-1">
        <input type="hidden" name="id" value="" />

        <Field label="Kind">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(["location", "vessel"] as const).map((k) => (
              <label key={k}>
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  defaultChecked={k === "location"}
                  className="peer sr-only"
                />
                <span className="cursor-pointer select-none rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-accent peer-checked:bg-bg peer-checked:font-medium peer-checked:text-ink">
                  {k === "location" ? "Location — a place closes" : "Vessel — boat out"}
                </span>
              </label>
            ))}
          </div>
          <p className="pt-1.5 text-xs text-faint">
            Scoped blocks only. A hold or a one-off slot blackout is made on the calendar (click
            the slot) — it still appears in the list here.
          </p>
        </Field>

        {/* Location fieldset */}
        <fieldset className="border-t border-line pt-2">
          <legend className="pt-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Location block
          </legend>
          <Field label="Location">
            <select
              name="locationId"
              defaultValue=""
              className={`${inputClass} w-full max-w-[280px]`}
              aria-label="Block location"
            >
              <option value="">— pick a location —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input name="date" type="date" className={`${inputClass} font-mono`} aria-label="Block date" />
          </Field>
          <Field label="Time window">
            <span className="flex flex-wrap items-center gap-2">
              <input name="startTime" type="time" className={`${inputClass} font-mono`} aria-label="Block start time" />
              <span className="text-xs text-faint">to</span>
              <input name="endTime" type="time" className={`${inputClass} font-mono`} aria-label="Block end time" />
            </span>
          </Field>
        </fieldset>

        {/* Vessel fieldset */}
        <fieldset className="border-t border-line pt-2">
          <legend className="pt-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Vessel block
          </legend>
          <Field label="Vessel">
            <select
              name="vesselId"
              defaultValue=""
              className={`${inputClass} w-full max-w-[280px]`}
              aria-label="Block vessel"
            >
              <option value="">— pick a vessel —</option>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Out of service">
            <span className="flex flex-wrap items-center gap-2">
              <input name="startDate" type="date" className={`${inputClass} font-mono`} aria-label="Block start date" />
              <span className="text-xs text-faint">to</span>
              <input name="endDate" type="date" className={`${inputClass} font-mono`} aria-label="Block end date" />
            </span>
          </Field>
        </fieldset>

        <Field label="Reason" sub="optional">
          <input
            name="note"
            defaultValue=""
            placeholder="e.g. river closed, engine service"
            className={`${inputClass} w-full max-w-[280px]`}
            aria-label="Block reason"
          />
        </Field>

        <div className="py-3">
          <SubmitButton className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-white">
            Create block
          </SubmitButton>
          <p className="pt-2 text-xs text-faint">
            A booked trip inside a block isn’t cancelled — the closure is real, so it’s created,
            and any conflicting trips surface on the row to resolve on the reservation side.
          </p>
        </div>
      </form>
    </aside>
  );
}

export function VesselHueDot({ vesselId, hue }: { vesselId: string; hue?: number }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(vesselId, hue)}`}
      aria-hidden
    />
  );
}
