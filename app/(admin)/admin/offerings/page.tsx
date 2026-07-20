import type { GratuityKindConfig, Location, Offering, Vessel } from "@core/domain/entities.js";
import { gratuityKindsFor } from "@core/reservations/pricing.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { saveOffering } from "./actions";
import { PriceVariationsEditor } from "./price-variations-editor";

/**
 * /admin/offerings (task 12.8, DEC-123) — the Offering catalog editor, laid out to
 * `docs/design/mockups/offering-catalog.html`: a full-width header (breadcrumb + name +
 * status pill + Save), an offerings master list + section side-nav on the left, and the five
 * editor sections (Details / Schedule / Pricing / Gratuity / Add-ons; Photos deferred) on the
 * right. Master–detail via `?sel=<id|new>`, native forms throughout — the ONE client island
 * is the ordered price-variations editor, earned by drag/reorder (order IS the pricing rule).
 *
 * Status semantics (DEC-123): Draft generates no slots; Live publishes the schedule; Hidden
 * is a reversible soft-delete — out of customer browse AND this default list (bookings kept),
 * recoverable via the "Show hidden" toggle (`?hidden=1`). Never a hard delete.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string; hidden?: string };

const ERR_COPY: Record<string, string> = {
  name_required: "Give the offering a name.",
  bad_status: "Pick a status — Draft, Live, or Hidden.",
  bad_location: "That location no longer exists — pick another.",
  bad_vessels: "Pick at least one vessel (and only boats that still exist).",
  bad_schedule: "Check the schedule — season dates must be real and in order, times HH:MM.",
  bad_price: "Prices must be dollar amounts (like 499 or 499.00), not negative.",
  bad_included_guests: "Included guests must be a whole number of at least 1 (or blank).",
  bad_minutes: "The minutes fields must be whole numbers (or blank).",
  bad_variations: "Check the price variations — every row needs a label, a rule, and an amount.",
  bad_gratuity: "Check the gratuity tiers — percentages, with the default one of the tiers.",
  bad_add_ons: "Check the add-ons — every row needs a label and a dollar amount.",
  error: "Couldn’t save that just now — try again in a moment.",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Mon=0…Sun=6

const STATUS_COPY: Record<Offering["status"], { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "border-line bg-bg text-muted" },
  live: { label: "Live", pill: "border-ok-line bg-ok-bg text-ok" },
  hidden: { label: "Hidden", pill: "border-warn-line bg-warn-bg text-warn" },
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
  try {
    const repo = getRepo();
    [offerings, vessels, locations] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listLocations(),
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

  // Hidden is a reversible soft-delete (DEC-123): out of the default list, back via the
  // toggle. Draft + Live always show in admin.
  const showHidden = sp.hidden === "1";
  const hiddenCount = offerings.filter((o) => o.status === "hidden").length;
  const visible = showHidden ? offerings : offerings.filter((o) => o.status !== "hidden");

  const creating = sp.sel === "new" || visible.length === 0;
  const selected = creating ? null : visible.find((o) => o.id === sp.sel) ?? visible[0] ?? null;
  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;
  const title = creating ? "New offering" : selected?.name ?? "Offerings";
  const hiddenParam = showHidden ? "&hidden=1" : "";

  return (
    <Shell width="6xl">
      <BackLink href="/admin">Back</BackLink>
      {/* One form spans the header + both columns; `key` remounts the uncontrolled inputs
          (and the variations island) when the selected offering changes. */}
      <form
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveOffering}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />
        {showHidden && <input type="hidden" name="showHidden" value="1" />}

        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              Settings / Offerings{selected || creating ? ` / ${title}` : ""}
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

        {errCopy && <Notice tone="bad">{errCopy}</Notice>}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[230px_1fr]">
          <div className="flex flex-col gap-3 self-start">
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
              <AddOnsSection offering={selected} />
            </div>
          )}
        </div>
      </form>

      <VersionTag />
    </Shell>
  );
}

const inputClass = settingsInputClass;
const chipClass =
  "cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-ink peer-checked:bg-ink peer-checked:font-medium peer-checked:text-white";

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="ml-auto text-right text-xs text-faint">{hint}</span>
      </div>
      <div className="px-4 py-1">{children}</div>
    </section>
  );
}

// ── 1 · Details ──────────────────────────────────────────────────────────────
function DetailsSection({
  offering,
  vessels,
  locations,
}: {
  offering: Offering | null;
  vessels: Vessel[];
  locations: Location[];
}) {
  return (
    <Section id="details" title="Details" hint="what the customer reads">
      <Field label="Status">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(["draft", "live", "hidden"] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="status"
                value={s}
                defaultChecked={(offering?.status ?? "draft") === s}
                className="peer sr-only"
              />
              <span className={chipClass}>{STATUS_COPY[s].label}</span>
            </label>
          ))}
        </div>
        <p className="pt-1.5 text-xs text-faint">
          Draft = not sellable, generates no slots · Live = on sale · Hidden = pulled from
          browse + this list, bookings kept
        </p>
      </Field>

      <Field label="Name">
        <input
          name="name"
          required
          defaultValue={offering?.name ?? ""}
          className={`${inputClass} w-full max-w-[420px]`}
        />
      </Field>

      <Field label="Description" sub="markdown" align="start">
        <textarea
          name="description"
          defaultValue={offering?.description ?? ""}
          className={`${inputClass} min-h-[80px] w-full py-2`}
        />
      </Field>

      <Field label="Location" sub="launch point">
        <span className="flex flex-wrap items-center gap-3">
          <select
            name="locationId"
            required
            defaultValue={offering?.locationId ?? ""}
            className={`${inputClass} w-full max-w-[280px]`}
          >
            <option value="" disabled>
              — pick a location —
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <AppLink href="/admin/locations" className="text-xs text-accent">
            Manage locations →
          </AppLink>
        </span>
      </Field>

      <Field label="Trip length" sub="on the water">
        <span className="flex items-center gap-2">
          <input
            name="tripLengthMinutes"
            type="number"
            min={0}
            defaultValue={offering?.tripLengthMinutes ?? ""}
            className={`${inputClass} max-w-[110px] font-mono`}
          />
          <span className="text-xs text-faint">minutes</span>
        </span>
      </Field>

      <Field label="Boat held for" sub="turnaround included">
        <span className="flex items-center gap-2">
          <input
            name="holdMinutes"
            type="number"
            min={0}
            defaultValue={offering?.holdMinutes ?? ""}
            className={`${inputClass} max-w-[110px] font-mono`}
          />
          <span className="text-xs text-faint">minutes</span>
        </span>
      </Field>

      <Field label="Arrive before" sub="guest call time">
        <span className="flex items-center gap-2">
          <input
            name="arriveBeforeMinutes"
            type="number"
            min={0}
            defaultValue={offering?.arriveBeforeMinutes ?? ""}
            className={`${inputClass} max-w-[110px] font-mono`}
          />
          <span className="text-xs text-faint">minutes</span>
        </span>
      </Field>

      <Field label="Vessels" sub="which boats run it">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {vessels.map((v) => (
            <label key={v.id}>
              <input
                type="checkbox"
                name="vesselIds"
                value={v.id}
                defaultChecked={offering?.vesselIds.includes(v.id) ?? false}
                className="peer sr-only"
              />
              <span className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-accent/40 peer-checked:bg-bg peer-checked:font-medium peer-checked:text-ink">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                  aria-hidden
                />
                {v.name}
              </span>
            </label>
          ))}
        </div>
        <p className="pt-1.5 text-xs text-faint">
          Capacity is a fact of each vessel, set on the Vessel screen — never here. Boats
          needing a different schedule are a different offering.
        </p>
      </Field>
    </Section>
  );
}

// ── 2 · Schedule ─────────────────────────────────────────────────────────────
function ScheduleSection({ offering }: { offering: Offering | null }) {
  const schedule = offering?.schedule;
  return (
    <Section id="schedule" title="Schedule" hint="a rule, not rows">
      <Field label="Season">
        <span className="flex flex-wrap items-center gap-2">
          <input
            name="seasonStart"
            type="date"
            required
            defaultValue={schedule?.seasonStart ?? ""}
            className={`${inputClass} font-mono`}
          />
          <span className="text-xs text-faint">to</span>
          <input
            name="seasonEnd"
            type="date"
            required
            defaultValue={schedule?.seasonEnd ?? ""}
            className={`${inputClass} font-mono`}
          />
        </span>
      </Field>

      <Field label="Days">
        <div className="flex flex-wrap gap-2 pt-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <label key={label}>
              <input
                type="checkbox"
                name="weekday"
                value={d}
                defaultChecked={schedule?.weekdays.includes(d) ?? false}
                className="peer sr-only"
              />
              <span className={chipClass}>{label}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Departures" sub="uncheck to drop">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(schedule?.departureTimes ?? []).map((t) => (
            <label key={t}>
              <input
                type="checkbox"
                name="departureTime"
                value={t}
                defaultChecked
                className="peer sr-only"
              />
              <span className={`${chipClass} font-mono`}>{t}</span>
            </label>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-faint">+ time</span>
            <input
              name="newDepartureTime"
              type="time"
              className={`${inputClass} font-mono`}
              aria-label="Add departure time"
            />
          </span>
        </div>
        <p className="pt-1.5 text-xs text-faint">
          Availability is computed from this rule — schedule × vessels × dates − blocks −
          bookings. Draft generates no slots; flip to Live and they appear. Blocks/blackout
          live on their own surface, not here.
        </p>
      </Field>
    </Section>
  );
}

// ── 3 · Pricing ──────────────────────────────────────────────────────────────
function PricingSection({ offering }: { offering: Offering | null }) {
  return (
    <Section id="pricing" title="Pricing" hint="the boat, by the guest">
      <Field label="Base fare" sub="buys the whole boat">
        <span className="flex items-center gap-2">
          <span className="text-xs text-faint">$</span>
          <input
            name="basePrice"
            required
            inputMode="decimal"
            defaultValue={offering ? (offering.basePriceCents / 100).toFixed(2) : ""}
            className={`${inputClass} max-w-[130px] font-mono`}
          />
        </span>
      </Field>

      <Field label="Included guests" sub="the base fare covers">
        <span className="flex items-center gap-2">
          <input
            name="includedGuestCount"
            type="number"
            min={1}
            defaultValue={offering?.includedGuestCount ?? ""}
            className={`${inputClass} max-w-[110px] font-mono`}
          />
          <span className="text-xs text-faint">blank = the boat’s full capacity</span>
        </span>
      </Field>

      <Field label="Extra guest" sub="above the included count">
        <span className="flex items-center gap-2">
          <span className="text-xs text-faint">$</span>
          <input
            name="extraGuestPrice"
            required
            inputMode="decimal"
            defaultValue={offering ? (offering.extraGuestPriceCents / 100).toFixed(2) : "0.00"}
            className={`${inputClass} max-w-[130px] font-mono`}
          />
          <span className="text-xs text-faint">each, up to that boat’s max</span>
        </span>
      </Field>

      <Field label="Variations" sub="first match wins" align="start">
        <div className="pt-1">
          <PriceVariationsEditor initial={offering?.priceVariations ?? []} />
        </div>
      </Field>
    </Section>
  );
}

// ── 4 · Gratuity ─────────────────────────────────────────────────────────────
function GratuitySection({ offering }: { offering: Offering | null }) {
  // Render from the effective per-kind config: an offering with none yet shows the code
  // defaults (pre required + post optional, 15/20/25) — saving writes them explicitly.
  const kinds = gratuityKindsFor(offering ?? {});
  const byKind = (k: "pre" | "post"): GratuityKindConfig | undefined =>
    kinds.find((g) => g.kind === k);
  return (
    <Section id="gratuity" title="Gratuity" hint="crew money — not an add-on, not revenue">
      <GratuityKindRow
        kind="pre"
        label="Pre"
        when="at checkout"
        config={byKind("pre")}
      />
      <GratuityKindRow
        kind="post"
        label="Post"
        when="after the trip, via booking link"
        config={byKind("post")}
      />
      <p className="py-3 text-xs text-faint">
        Gratuity is first-class, keyed by kind — deliberately NOT an add-on. It routes to
        crew and is exempt from tax + the service fee (DEC-124); add-ons below are revenue.
      </p>
    </Section>
  );
}

function GratuityKindRow({
  kind,
  label,
  when,
  config,
}: {
  kind: "pre" | "post";
  label: string;
  when: string;
  config: GratuityKindConfig | undefined;
}) {
  const cap = kind === "pre" ? "Pre" : "Post";
  return (
    <Field label={label} sub={when}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" name={`grat${cap}`} defaultChecked={config !== undefined} />
          Collect
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Tiers %
          <input
            name={`grat${cap}Tiers`}
            defaultValue={(config?.tiersBps ?? [1500, 2000, 2500]).map((t) => t / 100).join(", ")}
            className={`${inputClass} max-w-[130px] font-mono`}
            aria-label={`${label} gratuity tiers (percent)`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Default %
          <input
            name={`grat${cap}Default`}
            defaultValue={(config?.defaultBps ?? 2000) / 100}
            className={`${inputClass} max-w-[70px] font-mono`}
            aria-label={`${label} gratuity default (percent)`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            name={`grat${cap}Required`}
            defaultChecked={config?.required ?? kind === "pre"}
          />
          Required
        </label>
      </div>
    </Field>
  );
}

// ── 5 · Add-ons ──────────────────────────────────────────────────────────────
function AddOnsSection({ offering }: { offering: Offering | null }) {
  const rows = offering?.addOns ?? [];
  return (
    <Section id="addons" title="Add-ons" hint="real upsells only — revenue">
      <div className="flex flex-col gap-2 py-3">
        {rows.map((a, i) => (
          <AddOnRow key={`${a.label}-${i}`} label={a.label} amount={(a.amountCents / 100).toFixed(2)} required={a.required} />
        ))}
        {/* The "+ Add-on" row — native-form add: fill it and Save. Clearing a row's label
            removes it. */}
        <AddOnRow label="" amount="" required={false} isNew />
        <p className="text-xs text-faint">
          Add-ons are taxed + fee’d as revenue. Gratuity is NOT here — it’s crew money, its
          own section. Clear a label to remove a row; fill the empty row to add one.
        </p>
      </div>
    </Section>
  );
}

function AddOnRow({
  label,
  amount,
  required,
  isNew,
}: {
  label: string;
  amount: string;
  required: boolean;
  isNew?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        name="addOnLabel"
        defaultValue={label}
        placeholder={isNew ? "+ Add-on (e.g. Extra hour)" : ""}
        aria-label={isNew ? "New add-on label" : `Add-on ${label} label`}
        className={`${inputClass} w-full max-w-[260px]`}
      />
      <span className="text-xs text-faint">$</span>
      <input
        name="addOnAmount"
        inputMode="decimal"
        defaultValue={amount}
        aria-label={isNew ? "New add-on amount" : `Add-on ${label} amount`}
        className={`${inputClass} max-w-[110px] font-mono`}
      />
      <select
        name="addOnRequired"
        defaultValue={required ? "yes" : "no"}
        aria-label={isNew ? "New add-on required" : `Add-on ${label} required`}
        className={`${inputClass} max-w-[120px]`}
      >
        <option value="no">Optional</option>
        <option value="yes">Required</option>
      </select>
    </div>
  );
}
