"use client";

import { useState } from "react";
import type { Location, Vessel } from "@core/domain/entities.js";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { HUE_COUNT, vesselHueClass, vesselHueIndex } from "../../../lib/vessel-hue";

/**
 * The "Vessel" facts card — **controlled client fields (#699)**, split out of `page.tsx` when the
 * offerings fix came to the other three CRUD surfaces.
 *
 * Same reasoning as `admin/offerings/offering-sections.tsx`, and it is the measured one rather
 * than the obvious one: returning the refusal instead of redirecting (`ActionForm`) is necessary
 * and **not sufficient**. Next refreshes the route's RSC payload after a server action, and under
 * `force-dynamic` that re-render resets uncontrolled inputs even though nothing navigated. The
 * typed value only survives if React is holding it — so it is held here.
 *
 * The island stops at this card. The page shell, the vessel list and the read-only Offerings
 * lookup stay Server Components and arrive as `children` of the form (DEC-133 pass-through),
 * which is what keeps this a card-sized island rather than a page-sized one (DEC-147 rule 2).
 */
export function VesselCard({
  vessel,
  creating,
  locations,
}: {
  vessel: Vessel | null;
  creating: boolean;
  locations: Location[];
}) {
  const isNew = creating || !vessel;
  const [name, setName] = useState(vessel?.name ?? "");
  // 6 is the create-form default the old `defaultValue` carried; keeping it here keeps the
  // opening state of a new vessel identical to before the conversion.
  const [coiMaxPax, setCoiMaxPax] = useState(String(vessel?.coiMaxPax ?? 6));
  const [hue, setHue] = useState<number | null>(
    isNew ? null : vesselHueIndex(vessel!.id, vessel!.hue),
  );
  const [homeLocationId, setHomeLocationId] = useState(vessel?.homeLocationId ?? "");
  const [notes, setNotes] = useState(vessel?.notes ?? "");

  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Vessel</h2>
      </div>

      <div className="px-4 py-1">
        <Field label="Name">
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${settingsInputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Capacity" sub="The maximum number of passengers">
          <input
            name="coiMaxPax"
            type="number"
            min={1}
            max={99}
            required
            value={coiMaxPax}
            onChange={(e) => setCoiMaxPax(e.target.value)}
            className={`${settingsInputClass} max-w-[110px] font-mono`}
          />
        </Field>

        <Field label="Color">
          <fieldset className="flex flex-wrap gap-2 pt-1.5">
            <legend className="sr-only">Color</legend>
            {Array.from({ length: HUE_COUNT }, (_, i) => i + 1).map((h) => (
              <label key={h} className="cursor-pointer">
                <input
                  type="radio"
                  name="hue"
                  value={h}
                  checked={hue === h}
                  onChange={() => setHue(h)}
                  className="peer sr-only"
                />
                <span
                  className={`block h-7 w-7 rounded-lg border border-ink/10 ${vesselHueClass("", h)} peer-checked:outline peer-checked:outline-2 peer-checked:outline-offset-2 peer-checked:outline-accent`}
                  aria-label={`Color ${h}`}
                />
              </label>
            ))}
          </fieldset>
        </Field>

        <Field label="Home location" sub="default launch">
          <select
            name="homeLocationId"
            value={homeLocationId}
            onChange={(e) => setHomeLocationId(e.target.value)}
            className={`${settingsInputClass} w-full max-w-[280px]`}
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes" align="start">
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${settingsInputClass} min-h-[64px] w-full py-2`}
          />
        </Field>
      </div>
    </section>
  );
}
