import type { Location, Offering } from "@core/domain/entities.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { saveLocation } from "./actions";

/**
 * /admin/locations (task 12.9, DEC-123) — the Location settings twin. A first-class entity:
 * the customer-facing pickup (description + map link) and route blurb, edited once and read by
 * every Offering that launches here (DEC-125 — a location block subtracts from all of them at
 * once). Master–detail via `?sel=<id|new>`, native forms, no JS (DEC-026). "Block this
 * location" is deferred to the Blocks surface task.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string };

const ERR_COPY: Record<string, string> = {
  name_required: "Give the location a name.",
  pickup_required: "Add a pickup description — where guests meet the boat.",
  route_required: "Add a route description — where the trip goes.",
  bad_link: "The pickup link needs to be a full http(s) URL.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function AdminLocations({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let locations: Location[];
  let offerings: Offering[];
  try {
    const repo = getRepo();
    [locations, offerings] = await Promise.all([repo.listLocations(), repo.listOfferings()]);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the locations right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  locations.sort((a, b) => a.name.localeCompare(b.name));

  const creating = sp.sel === "new";
  const selected = creating
    ? null
    : locations.find((l) => l.id === sp.sel) ?? locations[0] ?? null;
  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;

  return (
    <Shell width="3xl">
      <BackLink href="/admin">Back</BackLink>
      <h1 className="text-xl font-semibold text-ink">Locations</h1>
      <p className="text-sm text-muted">
        Where trips launch. The customer reads the pickup + route; every offering here references
        it, so one edit updates them all.
      </p>

      {sp.saved && <Notice tone="ok">Saved.</Notice>}
      {errCopy && <Notice tone="bad">{errCopy}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-1 rounded-card border border-line bg-card p-2">
          {locations.map((l) => {
            const used = offerings.filter((o) => o.locationId === l.id).length;
            return (
              <AppLink
                key={l.id}
                href={`/admin/locations?sel=${l.id}`}
                aria-current={selected?.id === l.id ? "page" : undefined}
                className={`flex flex-col rounded-lg px-3 py-2 text-sm ${
                  selected?.id === l.id ? "bg-bg font-semibold text-ink" : "text-muted"
                }`}
              >
                <span className="truncate">{l.name}</span>
                <span className="text-xs text-faint">
                  {used} {used === 1 ? "offering" : "offerings"}
                </span>
              </AppLink>
            );
          })}
          <AppLink
            href="/admin/locations?sel=new"
            className={`mt-1 rounded-lg border border-dashed border-line px-3 py-2 text-sm ${
              creating ? "font-semibold text-accent" : "text-accent"
            }`}
          >
            + New location
          </AppLink>
        </nav>

        <div className="flex flex-col gap-4">
          <LocationForm location={selected} creating={creating} />
          {selected && <UsedBySection location={selected} offerings={offerings} />}
        </div>
      </div>

      <VersionTag />
    </Shell>
  );
}

const inputClass = "min-h-[44px] rounded-card border border-line bg-card px-3 text-ink";

function LocationForm({ location, creating }: { location: Location | null; creating: boolean }) {
  const isNew = creating || !location;
  return (
    <form
      action={saveLocation}
      className="flex flex-col gap-4 rounded-card border border-line bg-card px-4 py-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink">
        {isNew ? "New location" : location!.name}
      </h2>
      <input type="hidden" name="id" value={isNew ? "" : location!.id} />

      <label className="flex flex-col gap-1 text-sm text-muted">
        Name
        <input name="name" required defaultValue={location?.name ?? ""} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Pickup <span className="text-xs text-faint">where guests meet the boat</span>
        <textarea
          name="pickupDescription"
          required
          defaultValue={location?.pickupDescription ?? ""}
          className={`${inputClass} min-h-[64px] py-2`}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Pickup link <span className="text-xs text-faint">map / directions (optional)</span>
        <input
          name="pickupLink"
          type="url"
          defaultValue={location?.pickupLink ?? ""}
          placeholder="https://maps.google.com/…"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Route <span className="text-xs text-faint">where the trip goes</span>
        <textarea
          name="routeDescription"
          required
          defaultValue={location?.routeDescription ?? ""}
          className={`${inputClass} min-h-[64px] py-2`}
        />
      </label>

      <SubmitButton className="min-h-[44px] max-w-[180px] rounded-card bg-accent px-4 font-semibold text-white">
        {isNew ? "Create location" : "Save"}
      </SubmitButton>
    </form>
  );
}

/** Read-only reverse lookup — the offerings that launch here. The Offering owns the link. */
function UsedBySection({ location, offerings }: { location: Location; offerings: Offering[] }) {
  const used = offerings.filter((o) => o.locationId === location.id);
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Used by</h2>
      {used.length === 0 ? (
        <p className="text-sm text-muted">No offerings launch here yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {used.map((o) => (
            <span key={o.id} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
              {o.name}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-faint">
        Read-only — set on each Offering. Blocking this location subtracts availability from every
        offering here at once.
      </p>
    </section>
  );
}
