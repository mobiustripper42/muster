import type { Location, Offering, Vessel } from "@core/domain/entities.js";
import { ActionForm } from "../../../../components/ui/action-form";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { saveVessel, type VesselErr } from "./actions";
import { VesselCard } from "./vessel-card";

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

const ERR_COPY: Record<VesselErr, string> = {
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
      <Shell width="6xl">
        <Notice>Couldn’t reach the fleet right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  vessels.sort((a, b) => a.name.localeCompare(b.name));

  // Empty fleet ⇒ open straight into the create form (with its Create button) rather than a
  // blank form with no way to save.
  const creating = sp.sel === "new" || vessels.length === 0;
  // No first-record substitution — see the note in admin/offerings (#699).
  const selected = creating
    ? null
    : sp.sel
      ? vessels.find((v) => v.id === sp.sel) ?? null
      : vessels[0] ?? null;
  const title = creating ? "New vessel" : selected?.name ?? "Vessels";

  return (
    <Shell width="6xl">
      {/* One form spans the header + both columns; `key` remounts the card when the selected
          vessel changes, so switching rows always shows that vessel's values.
          #699: the key stays and stops being a hazard. It used to do double duty — "reset the
          form" AND "which record is this" — and a validation error tripped the second meaning,
          remounting and wiping the first. The two triggers are separate now: switching records
          flips the key (reset intended), a returned refusal doesn't (no reset). */}
      <ActionForm
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveVessel}
        errCopy={ERR_COPY}
        fallback="error"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />

        {/* Header — breadcrumb, boat name, Save (mockup header.top). */}
        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">Setup / Vessels{selected || creating ? ` / ${title}` : ""}</p>
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

        {/* No `?err=` read here any more (#699): `saveVessel` returns its refusal to the
            ActionForm above, which renders it. Nothing on this surface redirects with an error
            code, so a lingering `?err=` in a bookmarked URL is inert rather than misleading. */}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[230px_1fr]">
          <nav className="flex flex-col gap-0.5 self-start rounded-card border border-line bg-card p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Vessels
            </p>
            {vessels.map((v) => (
              <AppLink
                key={v.id}
                href={`/admin/vessels?sel=${v.id}`}
                aria-current={selected?.id === v.id ? "page" : undefined}
                className={`block rounded-[9px] px-2.5 py-2 text-sm ${
                  selected?.id === v.id ? "bg-bg font-medium text-ink" : "text-muted"
                }`}
              >
                {/* Flex lives INSIDE the link: AppLink wraps its children in a label
                    node, so a `gap` on the link itself never reaches the dot + name. */}
                <span className="flex items-center gap-2.5">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                </span>
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
      </ActionForm>

      <VersionTag />
    </Shell>
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
