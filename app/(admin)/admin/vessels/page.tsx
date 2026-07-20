import type { Location, Offering, Vessel } from "@core/domain/entities.js";
import type { ReactNode } from "react";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { HUE_COUNT, vesselHueClass, vesselHueIndex } from "../../../lib/vessel-hue";
import { saveVessel } from "./actions";

/**
 * /admin/vessels (task 12.9, DEC-123) — the Vessel settings twin, laid out to
 * `docs/design/mockups/vessel.html`: a full-width header (breadcrumb + boat name + Save),
 * then a vessel list on the left and the boat's own facts on the right (name, capacity,
 * identity color, home location, notes) plus a read-only Offerings reverse lookup. One vessel,
 * not a twin — this IS the boat the crew engine already knows. Master–detail via `?sel=<id|new>`,
 * native forms, no JS (DEC-026). Out-of-service (a block) and Retire (soft archive) are deferred.
 *
 * The whole surface is ONE `<form>` so the Save button can sit in the header (mockup) while the
 * fields sit in the detail card — `SubmitButton`'s pending state needs the button inside the
 * form. The sidebar links are `<a>` (navigation, not submit), so they live inside it harmlessly.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  name_required: "Give the vessel a name.",
  bad_capacity: "Capacity must be a whole number of passengers (1–99).",
  bad_hue: "Pick a color from the palette.",
  bad_location: "That home location no longer exists — pick another.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function AdminVessels({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let vessels: Vessel[];
  let locations: Location[];
  let offerings: Offering[];
  try {
    const repo = getRepo();
    [vessels, locations, offerings] = await Promise.all([
      repo.listVessels(),
      repo.listLocations(),
      repo.listOfferings(),
    ]);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the fleet right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  vessels.sort((a, b) => a.name.localeCompare(b.name));

  const creating = sp.sel === "new";
  const selected = creating ? null : vessels.find((v) => v.id === sp.sel) ?? vessels[0] ?? null;
  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;
  const title = creating ? "New vessel" : selected?.name ?? "Vessels";

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      {/* One form spans the header + both columns; `key` remounts the uncontrolled inputs when
          the selected vessel changes, so switching rows always shows that vessel's values. */}
      <form
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveVessel}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />

        {/* Header — breadcrumb, boat name, Save (mockup header.top). */}
        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">Vessels{selected || creating ? ` / ${title}` : ""}</p>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold leading-tight text-ink">
              {selected && (
                <span
                  className={`inline-block h-3 w-3 shrink-0 rounded-full ${vesselHueClass(selected.id, selected.hue)}`}
                  aria-hidden
                />
              )}
              <span className="truncate">{title}</span>
            </h1>
          </div>
          {(selected || creating) && (
            <SubmitButton className="ml-auto min-h-[40px] shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-white">
              {creating || !selected ? "Create" : "Save"}
            </SubmitButton>
          )}
        </header>

        {sp.saved && <Notice tone="ok">Saved.</Notice>}
        {errCopy && <Notice tone="bad">{errCopy}</Notice>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
          <nav className="flex flex-col gap-0.5 self-start rounded-card border border-line bg-card p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Vessels
            </p>
            {vessels.map((v) => (
              <AppLink
                key={v.id}
                href={`/admin/vessels?sel=${v.id}`}
                aria-current={selected?.id === v.id ? "page" : undefined}
                className={`flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-sm ${
                  selected?.id === v.id ? "bg-bg font-medium text-ink" : "text-muted"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
              </AppLink>
            ))}
            <AppLink
              href="/admin/vessels?sel=new"
              className={`mx-0.5 mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-sm text-accent ${
                creating ? "font-medium" : ""
              }`}
            >
              + New vessel
            </AppLink>
          </nav>

          <div className="flex flex-col gap-4">
            <VesselCard vessel={selected} creating={creating} locations={locations} />
            {selected && <OfferingsSection vessel={selected} offerings={offerings} />}
          </div>
        </div>
      </form>

      <VersionTag />
    </Shell>
  );
}

const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";

/** One label-left field row (the mockup's `.f` grid). Top-aligned so a textarea's label
 *  sits with the first line, not dropped to a baseline. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:items-start sm:gap-3">
      <span className="text-sm text-muted sm:pt-2.5">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/** The "Vessel" facts card. The Save button lives in the page header (shared form). */
function VesselCard({
  vessel,
  creating,
  locations,
}: {
  vessel: Vessel | null;
  creating: boolean;
  locations: Location[];
}) {
  const isNew = creating || !vessel;
  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Vessel</h2>
        <span className="text-xs text-faint">the boat’s own facts</span>
      </div>

      <div className="px-4 py-1">
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={vessel?.name ?? ""}
            className={`${inputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Capacity">
          <div className="flex items-center gap-2">
            <input
              name="coiMaxPax"
              type="number"
              min={1}
              max={99}
              required
              defaultValue={vessel?.coiMaxPax ?? 6}
              className={`${inputClass} max-w-[110px] font-mono`}
            />
            <span className="text-xs text-faint">The maximum number of passengers</span>
          </div>
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
                  defaultChecked={!isNew && vesselHueIndex(vessel!.id, vessel!.hue) === h}
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

        <Field label="Home location">
          <select
            name="homeLocationId"
            defaultValue={vessel?.homeLocationId ?? ""}
            className={`${inputClass} w-full max-w-[280px]`}
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes">
          <textarea
            name="notes"
            defaultValue={vessel?.notes ?? ""}
            className={`${inputClass} min-h-[64px] w-full py-2`}
          />
        </Field>
      </div>
    </section>
  );
}

/** Read-only reverse lookup — the offerings this vessel runs on. The Offering owns the link. */
function OfferingsSection({ vessel, offerings }: { vessel: Vessel; offerings: Offering[] }) {
  const runs = offerings.filter((o) => o.vesselIds.includes(vessel.id));
  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Offerings</h2>
      </div>
      <div className="px-4 py-3">
        {runs.length === 0 ? (
          <p className="text-sm text-muted">Not assigned to any offerings yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {runs.map((o) => (
              <span key={o.id} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                {o.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
