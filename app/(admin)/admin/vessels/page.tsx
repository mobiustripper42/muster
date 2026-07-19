import type { Location, Offering, Vessel } from "@core/domain/entities.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { HUE_COUNT, vesselHueClass } from "../../../lib/vessel-hue";
import { saveVessel } from "./actions";

/**
 * /admin/vessels (task 12.9, DEC-123) — the Vessel settings twin. The boat's own facts:
 * name, capacity (the hard ceiling), identity hue (DEC-086 — colour is information), home
 * Location, notes. One vessel, not a twin (settled, mockup vessel.html): this IS the boat the
 * crew engine already knows. Master–detail via `?sel=<id|new>`, native forms, no JS (DEC-026).
 * Out-of-service (a block) and Retire (soft archive) are deferred to a later task.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  name_required: "Give the vessel a name.",
  bad_capacity: "Capacity must be a whole number of guests (1–99).",
  bad_hue: "Pick a colour from the palette.",
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

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Vessels</h1>
      <p className="text-sm text-muted">
        The boat’s own facts — set once, here. Offerings and pricing read the capacity; they
        never override it. Colour identifies the boat on the shift board and calendar.
      </p>

      {sp.saved && <Notice tone="ok">Saved.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-1 rounded-card border border-line bg-card p-2">
          {vessels.map((v) => (
            <AppLink
              key={v.id}
              href={`/admin/vessels?sel=${v.id}`}
              aria-current={selected?.id === v.id ? "page" : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                selected?.id === v.id ? "bg-bg font-semibold text-ink" : "text-muted"
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              <span className="font-mono text-xs text-faint">{v.coiMaxPax}</span>
            </AppLink>
          ))}
          <AppLink
            href="/admin/vessels?sel=new"
            className={`mt-1 rounded-lg border border-dashed border-line px-3 py-2 text-sm ${
              creating ? "font-semibold text-accent" : "text-accent"
            }`}
          >
            + New vessel
          </AppLink>
        </nav>

        <div className="flex flex-col gap-4">
          <VesselForm vessel={selected} creating={creating} locations={locations} />
          {selected && <RunsSection vessel={selected} offerings={offerings} />}
        </div>
      </div>

      <VersionTag />
    </Shell>
  );
}

const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";

/** Create/edit form. A blank `id` (create) makes the action mint a fresh vessel id. */
function VesselForm({
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
    <form
      action={saveVessel}
      className="flex flex-col gap-4 rounded-card border border-line bg-card px-4 py-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink">{isNew ? "New vessel" : vessel!.name}</h2>
      <input type="hidden" name="id" value={isNew ? "" : vessel!.id} />

      <label className="flex flex-col gap-1 text-sm text-muted">
        Name
        <input name="name" required defaultValue={vessel?.name ?? ""} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Capacity <span className="text-xs text-faint">the hard ceiling — the “up to N” guests the customer sees</span>
        <input
          name="coiMaxPax"
          type="number"
          min={1}
          max={99}
          required
          defaultValue={vessel?.coiMaxPax ?? 6}
          className={`${inputClass} max-w-[120px] font-mono`}
        />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm text-muted">
        <legend>Colour <span className="text-xs text-faint">carries the boat across the calendar + shift board — a fact, not decoration</span></legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {Array.from({ length: HUE_COUNT }, (_, i) => i + 1).map((h) => (
            <label key={h} className="cursor-pointer">
              <input
                type="radio"
                name="hue"
                value={h}
                defaultChecked={vessel?.hue === h}
                className="peer sr-only"
              />
              <span
                className={`block h-7 w-7 rounded-lg border border-ink/10 ${vesselHueClass("", h)} peer-checked:outline peer-checked:outline-2 peer-checked:outline-offset-2 peer-checked:outline-accent`}
                aria-label={`Colour ${h}`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Home location <span className="text-xs text-faint">default launch</span>
        <select name="homeLocationId" defaultValue={vessel?.homeLocationId ?? ""} className={`${inputClass} max-w-[280px]`}>
          <option value="">— none —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Notes <span className="text-xs text-faint">internal</span>
        <textarea name="notes" defaultValue={vessel?.notes ?? ""} className={`${inputClass} min-h-[64px] py-2`} />
      </label>

      <SubmitButton className="min-h-[44px] max-w-[160px] rounded-card bg-accent px-4 font-semibold text-white">
        {isNew ? "Create vessel" : "Save"}
      </SubmitButton>
    </form>
  );
}

/** Read-only reverse lookup — the offerings this vessel runs on. The Offering owns the link. */
function RunsSection({ vessel, offerings }: { vessel: Vessel; offerings: Offering[] }) {
  const runs = offerings.filter((o) => o.vesselIds.includes(vessel.id));
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Runs</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted">Not on any offering yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {runs.map((o) => (
            <span key={o.id} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
              {o.name}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-faint">
        Read-only — a vessel is added to an Offering on the Offering screen. Capacity is read from here, never overridden.
      </p>
    </section>
  );
}
