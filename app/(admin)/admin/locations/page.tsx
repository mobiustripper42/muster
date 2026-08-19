import type { Location, Offering } from "@core/domain/entities.js";
import { ActionForm } from "../../../../components/ui/action-form";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { saveLocation, type LocationErr } from "./actions";
import { LocationCard } from "./location-card";

/**
 * /admin/locations (task 12.9, DEC-123) — the Location settings twin, laid out to
 * `docs/design/mockups/location.html` and matching the Vessel screen: a full-width header
 * (breadcrumb + name + Save), a location list on the left, the customer-facing pickup + route
 * on the right, plus a read-only Offerings reverse lookup. Master–detail via `?sel=<id|new>`,
 * native forms, no JS (DEC-026). The whole surface is one `<form>` so Save can sit in the header
 * while the fields sit in the card. "Block this location" is deferred to the Blocks surface task.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string };

const ERR_COPY: Record<LocationErr, string> = {
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
      <Shell width="6xl">
        <Notice>Couldn’t reach the locations right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  locations.sort((a, b) => a.name.localeCompare(b.name));

  // Empty list ⇒ there's nothing to select, so open straight into the create form (with its
  // Create button) rather than a blank form with no way to save.
  const creating = sp.sel === "new" || locations.length === 0;
  // No first-record substitution — see the note in admin/offerings (#699).
  const selected = creating
    ? null
    : sp.sel
      ? locations.find((l) => l.id === sp.sel) ?? null
      : locations[0] ?? null;
  const title = creating ? "New location" : selected?.name ?? "Locations";

  return (
    <Shell width="6xl">
      {/* #699: the `key` still resets the card when you switch records, but a returned refusal
          no longer flips it — so a validation error keeps what you typed. */}
      <ActionForm
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveLocation}
        errCopy={ERR_COPY}
        fallback="error"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />

        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              Setup / Locations{selected || creating ? ` / ${title}` : ""}
            </p>
            <h1 className="truncate text-[22px] font-semibold leading-tight text-ink">{title}</h1>
          </div>
          {(selected || creating) && (
            <SubmitButton className="ml-auto min-h-[40px] shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-white">
              {creating || !selected ? "Create" : "Save"}
            </SubmitButton>
          )}
        </header>

        {/* No `?err=` read here any more (#699): `saveLocation` returns its refusal to the
            ActionForm above, which renders it. */}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[230px_1fr]">
          <nav className="flex flex-col gap-0.5 self-start rounded-card border border-line bg-card p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Locations
            </p>
            {locations.map((l) => {
              const used = offerings.filter((o) => o.locationId === l.id).length;
              return (
                <AppLink
                  key={l.id}
                  href={`/admin/locations?sel=${l.id}`}
                  aria-current={selected?.id === l.id ? "page" : undefined}
                  className={`block rounded-[9px] px-2.5 py-2 text-sm ${
                    selected?.id === l.id ? "bg-bg font-medium text-ink" : "text-muted"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="truncate">{l.name}</span>
                    <span className="text-xs text-faint">
                      {used} {used === 1 ? "offering" : "offerings"}
                    </span>
                  </span>
                </AppLink>
              );
            })}
            <AppLink
              href="/admin/locations?sel=new"
              className={`mx-0.5 mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-sm text-accent ${
                creating ? "font-medium" : ""
              }`}
            >
              + New location
            </AppLink>
          </nav>

          <div className="flex flex-col gap-4">
            <LocationCard location={selected} />
            {selected && <OfferingsSection location={selected} offerings={offerings} />}
          </div>
        </div>
      </ActionForm>

      <VersionTag />
    </Shell>
  );
}

/** Read-only reverse lookup — the offerings that launch here. The Offering owns the link. */
function OfferingsSection({ location, offerings }: { location: Location; offerings: Offering[] }) {
  const used = offerings.filter((o) => o.locationId === location.id);
  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Offerings</h2>
      </div>
      <div className="px-4 py-3">
        {used.length === 0 ? (
          <p className="text-sm text-muted">No offerings use this location yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {used.map((o) => (
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
