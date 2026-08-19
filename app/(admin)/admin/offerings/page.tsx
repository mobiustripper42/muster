import type { AddOn, Location, Offering, Vessel } from "@core/domain/entities.js";
import { ActionForm } from "../../../../components/ui/action-form";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { saveOffering, type OfferingErr } from "./actions";
import { STATUS_COPY } from "./status-copy";
import {
  DetailsSection,
  ScheduleSection,
  PricingSection,
  GratuitySection,
  AddOnsSection,
} from "./offering-sections";

/**
 * /admin/offerings (task 12.8, DEC-123) — the Offering catalog editor, laid out to
 * `docs/design/mockups/offering-catalog.html`: a full-width header (breadcrumb + name +
 * status pill + Save), an offerings master list + section side-nav on the left, and the five
 * editor sections (Details / Schedule / Pricing / Gratuity / Add-ons; Photos deferred) on the
 * right. Master–detail via `?sel=<id|new>`, native forms throughout — the ONE client island
 * is the ordered price-variations editor, earned by drag/reorder (order IS the pricing rule).
 * The section renderers live in `./offering-sections`.
 *
 * Status semantics (DEC-123): Draft generates no slots; Live publishes the schedule; Hidden
 * is a reversible soft-delete — out of customer browse AND this default list (bookings kept),
 * recoverable via the "Show hidden" toggle (`?hidden=1`). Never a hard delete.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string; hidden?: string };

const ERR_COPY: Record<OfferingErr, string> = {
  name_required: "Give the offering a name.",
  bad_status: "Pick a status — Draft, Live, or Hidden.",
  bad_location: "That location no longer exists — pick another.",
  bad_vessels: "Pick at least one vessel (and only boats that still exist).",
  bad_schedule: "Check the schedule — season dates must be real and in order, times HH:MM.",
  bad_price: "Prices must be dollar amounts (like 499 or 499.00), not negative.",
  bad_included_guests: "Included guests must be a whole number of at least 1 (or blank).",
  included_over_capacity: "Included guests can’t exceed the smallest selected vessel’s capacity.",
  bad_minutes: "The minutes fields must be whole numbers (or blank).",
  bad_variations: "Check the price variations — every row needs a label, a rule, and an amount.",
  bad_gratuity: "Check the gratuity tiers — percentages, with the default one of the tiers.",
  bad_add_ons: "Check the add-ons — every row needs a label and a dollar amount.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function AdminOfferings({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let offerings: Offering[];
  let vessels: Vessel[];
  let locations: Location[];
  let addOns: AddOn[];
  try {
    const repo = getRepo();
    [offerings, vessels, locations, addOns] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listLocations(),
      repo.listAddOns(),
    ]);
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the catalog right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  offerings.sort((a, b) => a.name.localeCompare(b.name));
  vessels.sort((a, b) => a.name.localeCompare(b.name));
  // The offering picker attaches ACTIVE add-ons only (#491); retired ones stay out of the list.
  const activeAddOns = addOns
    .filter((a) => a.active)
    .sort((a, b) => a.label.localeCompare(b.label));

  // Hidden is a reversible soft-delete (DEC-123): out of the default list, back via the
  // toggle. Draft + Live always show in admin.
  const showHidden = sp.hidden === "1";
  const hiddenCount = offerings.filter((o) => o.status === "hidden").length;
  const visible = showHidden ? offerings : offerings.filter((o) => o.status !== "hidden");

  const creating = sp.sel === "new" || visible.length === 0;
  // #699 — the distinction the old one-liner collapsed, and the existing catalog spec caught
  // me collapsing it the other way:
  //   - NO `sel` at all (landing on /admin/offerings): defaulting to the first is a courtesy,
  //     nobody asked for a specific record, and that behaviour is relied on.
  //   - A `sel` that matches NOTHING: answer null. Substituting the first record is what turned
  //     a validation error into "here is a different offering's data", and it misfires the same
  //     way on a stale bookmark or a deleted row. `admin/blocks` reached this via #703.
  const selected = creating
    ? null
    : sp.sel
      ? visible.find((o) => o.id === sp.sel) ?? null
      : visible[0] ?? null;
  const title = creating ? "New offering" : selected?.name ?? "Offerings";
  const hiddenParam = showHidden ? "&hidden=1" : "";

  return (
    <Shell width="6xl">
      {/* One form spans the header + both columns; `key` remounts the uncontrolled inputs (and
          the variations island) when the selected offering changes.
          #699: the key stays and stops being a hazard. It used to do double duty — "reset the
          form" AND "which record is this" — and a validation error tripped the second meaning,
          remounting and wiping the first. Now the two triggers are finally separate: switching
          records flips the key (reset intended), a returned refusal doesn't (no reset).
          Everything inside is still server-rendered and arrives as `children`; the island is the
          <form> element and its Notice slot, nothing more. */}
      <ActionForm
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveOffering}
        errCopy={ERR_COPY}
        fallback="error"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />
        {showHidden && <input type="hidden" name="showHidden" value="1" />}

        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              Setup / Offerings{selected || creating ? ` / ${title}` : ""}
            </p>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold leading-tight text-ink">
              <span className="truncate">{title}</span>
              {selected && (
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_COPY[selected.status].pill}`}
                >
                  {STATUS_COPY[selected.status].label}
                </span>
              )}
            </h1>
          </div>
          <SubmitButton className="ml-auto min-h-[40px] shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-white">
            {creating || !selected ? "Create" : "Save"}
          </SubmitButton>
        </header>

        {/* No `?err=` read here any more (#699): `saveOffering` returns its refusal to the
            ActionForm above, which renders it. Nothing on this surface redirects with an error
            code, so a lingering `?err=` in a bookmarked URL is inert rather than misleading. */}
        {/* #699: a `sel` that matches nothing now selects nothing (see above) — say so, rather
            than rendering a blank right-hand panel and leaving the reader to guess whether the
            offering is gone or the page is broken. Failing visibly was the point; failing
            blankly is only half of it. */}
        {!creating && !selected && sp.sel && (
          <Notice tone="bad">That offering no longer exists — pick one from the list.</Notice>
        )}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[230px_1fr]">
          {/* Left column pins while the detail scrolls (desktop only — the mockup's sticky
              sidenav); overflow guard keeps a long offerings list from running off-screen. */}
          <div className="flex flex-col gap-3 self-start min-[900px]:sticky min-[900px]:top-4 min-[900px]:max-h-[calc(100vh-1.5rem)] min-[900px]:overflow-y-auto">
            <nav className="flex flex-col gap-0.5 rounded-card border border-line bg-card p-1.5">
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                Offerings
              </p>
              {visible.map((o) => (
                <AppLink
                  key={o.id}
                  href={`/admin/offerings?sel=${o.id}${hiddenParam}`}
                  aria-current={selected?.id === o.id ? "page" : undefined}
                  className={`block rounded-[9px] px-2.5 py-2 text-sm ${
                    selected?.id === o.id ? "bg-bg font-medium text-ink" : "text-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    {o.status !== "live" && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                        {STATUS_COPY[o.status].label}
                      </span>
                    )}
                  </span>
                </AppLink>
              ))}
              <AppLink
                href={`/admin/offerings?sel=new${hiddenParam}`}
                className={`mx-0.5 mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-sm text-accent ${
                  creating ? "font-medium" : ""
                }`}
              >
                + New offering
              </AppLink>
              {(hiddenCount > 0 || showHidden) && (
                <AppLink
                  href={showHidden ? "/admin/offerings" : "/admin/offerings?hidden=1"}
                  className="mx-0.5 mt-1 px-2.5 py-1.5 text-xs text-muted underline"
                >
                  {showHidden ? "Hide hidden offerings" : `Show hidden (${hiddenCount})`}
                </AppLink>
              )}
            </nav>

            {/* Section side-nav — anchor scroll, per the mockup. */}
            {(selected || creating) && (
              <nav className="hidden flex-col gap-0.5 rounded-card border border-line bg-card p-1.5 min-[900px]:flex">
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Offering
                </p>
                {[
                  ["#details", "Details"],
                  ["#schedule", "Schedule"],
                  ["#pricing", "Pricing"],
                  ["#gratuity", "Gratuity"],
                  ["#addons", "Add-ons"],
                ].map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    className="rounded-[9px] px-2.5 py-1.5 text-sm text-muted"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            )}
          </div>

          {(selected || creating) && (
            <div className="flex min-w-0 flex-col gap-4">
              <DetailsSection offering={selected} vessels={vessels} locations={locations} />
              <ScheduleSection offering={selected} />
              <PricingSection offering={selected} />
              <GratuitySection offering={selected} />
              <AddOnsSection offering={selected} addOns={activeAddOns} />
            </div>
          )}
        </div>
      </ActionForm>

      <VersionTag />
    </Shell>
  );
}
