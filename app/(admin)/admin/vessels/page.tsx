import type { Location, Offering, RoleType, Vessel } from "@core/domain/entities.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { UnsavedGuard } from "../../../../components/ui/unsaved-guard";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { readFormDraft, type FormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { HUE_COUNT, vesselHueClass, vesselHueIndex } from "../../../lib/vessel-hue";
import { saveVessel, type VesselErr } from "./actions";

/**
 * /admin/vessels (task 12.9, DEC-123) — the Vessel settings twin, laid out to
 * `docs/design/mockups/vessel.html`: a full-width header (breadcrumb + boat name + Save),
 * then a vessel list on the left and the boat's own facts on the right (name, capacity,
 * identity color, home location, notes) plus a read-only Offerings reverse lookup. One vessel,
 * not a twin — this IS the boat the crew engine already knows. Master–detail via `?sel=<id|new>`,
 * native forms, no JS (DEC-147 — corrected from DEC-026 per that decision's fix-when-touched
 * rule). Out-of-service (a block) and Retire (soft archive) are deferred.
 *
 * The whole surface is ONE `<form>` so the Save button can sit in the header (mockup) while the
 * fields sit in the detail card — `SubmitButton`'s pending state needs the button inside the
 * form. The sidebar links are `<a>` (navigation, not submit), so they live inside it harmlessly.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string; crew?: string };

const ERR_COPY: Record<VesselErr, string> = {
  name_required: "Give the vessel a name.",
  bad_capacity: "Capacity must be a whole number of passengers (1–99).",
  bad_hue: "Pick a color from the palette.",
  bad_location: "That home location no longer exists — pick another.",
  crew_required: "Say who has to be aboard to sail it — a boat with no required crew can’t be crewed.",
  bad_crew_count: "Each role needs a whole number of people, at least one.",
  unknown_role: "That role no longer exists — pick another.",
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
  let roleTypes: RoleType[];
  try {
    const repo = getRepo();
    [vessels, locations, offerings, roleTypes] = await Promise.all([
      repo.listVessels(),
      repo.listLocations(),
      repo.listOfferings(),
      repo.listAllRoleTypes(),
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
  // A `?sel=` naming no boat says so rather than substituting one (#699); no `sel` at all is
  // the landing case and still opens the first vessel.
  const requested = creating ? undefined : sp.sel;
  const selected = creating
    ? null
    : requested
      ? vessels.find((v) => v.id === requested) ?? null
      : vessels[0] ?? null;
  const missing = requested !== undefined && selected === null;
  // The submitted values of a refused save, read back as this form's defaults (#699).
  // `?crew=1` is an add/remove of a crew row (#861): nothing was saved and nothing is wrong, but
  // the row set and every typed value live in the draft, so it has to be restored exactly as a
  // refusal's would be.
  const draft = sp.err || sp.crew ? await readFormDraft("/admin/vessels") : null;
  const errCopy = errCopyFor(ERR_COPY, sp.err, "error");
  const title = creating ? "New vessel" : selected?.name ?? "Vessels";

  return (
    <Shell width="6xl">
      {/* One form spans the header + both columns; `key` remounts the uncontrolled inputs when
          the selected vessel changes, so switching rows always shows that vessel's values. */}
      <form
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveVessel}
        className="flex flex-col gap-4"
      >
        <UnsavedGuard restored={draft !== null} />
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

        {errCopy && <Notice tone="bad">{errCopy}</Notice>}
        {missing && (
          <Notice tone="bad">That vessel no longer exists — pick one from the list.</Notice>
        )}

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
            {(selected || creating) && (
              <VesselCard
                vessel={selected}
                creating={creating}
                locations={locations}
                draft={draft}
                roleTypes={roleTypes}
              />
            )}
            {selected && <OfferingsSection vessel={selected} offerings={offerings} />}
          </div>
        </div>
      </form>

      <VersionTag />
    </Shell>
  );
}

const inputClass = settingsInputClass;

/**
 * The "Vessel" facts card. The Save button lives in the page header (shared form).
 *
 * Defaults are `draft ?? record ?? blank` (#699). The colour radio is the reason this surface
 * needed the server-side fix rather than client state: React never mirrors `checked` into
 * `defaultChecked` on update, so the form reset would revert the swatch to its mount value no
 * matter what any island held.
 */
/**
 * The required-crew rows — who has to be aboard to sail this boat (#861).
 *
 * **The row set is form state on a surface with no client JS (DEC-147)**, so Add and Remove are
 * submit buttons that post the whole form, and `saveVessel` rewrites the list and sends it back
 * through the draft. That is why the rows read from `draft.all(...)` first: after an add, the
 * draft is the only place the new row exists.
 *
 * **Remove is disabled on the last row rather than refused on save.** The rule is that a boat
 * cannot have an empty crew rule, and a control that lets you reach a state you are then told off
 * for is a worse way to say so than one that will not go there.
 */
function CrewRows({
  vessel,
  draft,
  roleTypes,
}: {
  vessel: Vessel | null;
  draft: FormDraft | null;
  roleTypes: RoleType[];
}) {
  const draftRoles = draft?.all("crewRole") ?? [];
  const rows =
    draftRoles.length > 0
      ? draftRoles.map((roleTypeId, i) => ({
          roleTypeId,
          count: draft?.all("crewCount")[i] ?? "1",
        }))
      : (vessel?.manning ?? []).map((m) => ({
          roleTypeId: String(m.roleTypeId),
          count: String(m.count),
        }));
  // A boat with no rule yet — a create, or one of the crewless rows this change exists to stop —
  // opens on one blank row rather than nothing, so the control to fill in is visible.
  const shown = rows.length > 0 ? rows : [{ roleTypeId: "", count: "1" }];

  return (
    <Field label="Required crew" sub="Who must be aboard to sail" align="start">
      <div className="flex flex-col gap-2 pt-1.5">
        {shown.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              name="crewCount"
              type="number"
              min={1}
              max={20}
              required
              defaultValue={row.count}
              aria-label="How many"
              className={`${inputClass} max-w-[72px] font-mono`}
            />
            <select
              name="crewRole"
              required
              defaultValue={row.roleTypeId}
              aria-label="Role"
              className={`${inputClass} max-w-[200px]`}
            >
              <option value="">Pick a role…</option>
              {roleTypes.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>
            <SubmitButton
              name="intent"
              value={`remove-crew-${i}`}
              disabled={shown.length === 1}
              formNoValidate
              title={
                shown.length === 1
                  ? "A boat needs at least one required crew role"
                  : "Remove this role"
              }
              className="min-h-[44px] min-w-[44px] rounded-lg border border-line px-2 text-sm text-muted disabled:cursor-not-allowed disabled:text-faint"
            >
              <span aria-hidden="true">✕</span>
              <span className="sr-only">Remove this role</span>
            </SubmitButton>
          </div>
        ))}
        {/* `formNoValidate` on both: adding a row must not be blocked by a row that is still
            blank, which is precisely the state you are in when you want another one. */}
        <SubmitButton
          name="intent"
          value="add-crew"
          formNoValidate
          className="min-h-[44px] self-start rounded-lg border border-line px-3 text-sm font-medium text-accent hover:border-accent"
        >
          + Add a role
        </SubmitButton>
      </div>
    </Field>
  );
}

function VesselCard({
  vessel,
  creating,
  locations,
  draft,
  roleTypes,
}: {
  vessel: Vessel | null;
  creating: boolean;
  locations: Location[];
  draft: FormDraft | null;
  roleTypes: RoleType[];
}) {
  const isNew = creating || !vessel;
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
            defaultValue={draft?.get("name") ?? vessel?.name ?? ""}
            className={`${inputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Capacity" sub="The maximum number of passengers">
          <input
            name="coiMaxPax"
            type="number"
            min={1}
            max={99}
            required
            defaultValue={draft?.get("coiMaxPax") ?? vessel?.coiMaxPax ?? 6}
            className={`${inputClass} max-w-[110px] font-mono`}
          />
        </Field>

        <CrewRows vessel={vessel} draft={draft} roleTypes={roleTypes} />

        <Field label="Color">
          <fieldset className="flex flex-wrap gap-2 pt-1.5">
            <legend className="sr-only">Color</legend>
            {Array.from({ length: HUE_COUNT }, (_, i) => i + 1).map((h) => (
              <label key={h} className="cursor-pointer">
                <input
                  type="radio"
                  name="hue"
                  value={h}
                  defaultChecked={
                    draft
                      ? draft.get("hue") === String(h)
                      : !isNew && vesselHueIndex(vessel!.id, vessel!.hue) === h
                  }
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
            defaultValue={draft?.get("homeLocationId") ?? vessel?.homeLocationId ?? ""}
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

        <Field label="Notes" align="start">
          <textarea
            name="notes"
            defaultValue={draft?.get("notes") ?? vessel?.notes ?? ""}
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
