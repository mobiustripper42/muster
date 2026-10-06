import type { ReactNode } from "react";
import type {
  AddOn,
  GratuityKindConfig,
  Location,
  Offering,
  PriceVariation,
  Vessel,
} from "@core/domain/entities.js";
import { gratuityKindsFor } from "@core/reservations/pricing.js";
import { AppLink } from "../../../../components/ui/app-link";
import { Field } from "../../../../components/ui/field";
import { fieldClass, Input, Textarea } from "../../../../components/ui/input";
import type { FormDraft } from "../../../lib/form-draft";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { PriceVariationsEditor } from "./price-variations-editor";
import { DepartureTimesEditor } from "./departure-times-editor";

/**
 * The /admin/offerings editor sections (task 12.8, DEC-123), split out of `page.tsx` to keep
 * the page shell (data load + master list + form) reviewable. Each is a server-rendered
 * section of the one native `<form>` in page.tsx — the only client island is
 * `PriceVariationsEditor` (drag/reorder). `STATUS_COPY` lives here (the status chip renders
 * it) and is re-exported for the page header + sidebar pills, so imports flow one way.
 *
 * **Every default here is `draft ?? record ?? blank` (#699).** After a refused save the
 * operator's own submission is the defaults source, because React resets the form on every
 * submit and restores exactly these defaults — see `app/lib/form-draft.ts` for why that can't
 * be fought from the client. Two rules that are easy to get wrong:
 *  - Checkboxes read `draft ? draft.has(…)` and never `??`: an unticked box posts nothing, and
 *    that "nothing" is a real answer that must survive.
 *  - The two islands take their `initial` from the draft as well — a departure time added and
 *    then lost is the same data loss as a cleared text field.
 */

const chipClass =
  "select-none rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-ink peer-checked:bg-ink peer-checked:font-medium peer-checked:text-white";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Mon=0…Sun=6

export const STATUS_COPY: Record<Offering["status"], { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "border-line bg-bg text-muted" },
  live: { label: "Live", pill: "border-ok-line bg-ok-bg text-ok" },
  hidden: { label: "Hidden", pill: "border-warn-line bg-warn-bg text-warn" },
};

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="ml-auto text-right text-xs text-muted">{hint}</span>
      </div>
      <div className="px-4 py-1">{children}</div>
    </section>
  );
}

// ── 1 · Details ──────────────────────────────────────────────────────────────
export function DetailsSection({
  offering,
  vessels,
  locations,
  draft,
}: {
  offering: Offering | null;
  vessels: Vessel[];
  locations: Location[];
  draft: FormDraft | null;
}) {
  return (
    <Section id="details" title="Details" hint="what the customer reads">
      <Field layout="row" label="Status">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(["draft", "live", "hidden"] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="status"
                value={s}
                defaultChecked={(draft?.get("status") ?? offering?.status ?? "draft") === s}
                className="peer sr-only"
              />
              <span className={chipClass}>{STATUS_COPY[s].label}</span>
            </label>
          ))}
        </div>
        <p className="pt-1.5 text-xs text-muted">
          Draft = not sellable, generates no slots · Live = on sale · Hidden = pulled from
          browse + this list, bookings kept
        </p>
      </Field>

      <Field layout="row" label="Name">
        <Input
          name="name"
          required
          defaultValue={draft?.get("name") ?? offering?.name ?? ""}
          className="w-full max-w-[420px]"
        />
      </Field>

      <Field layout="row" label="Description" hint="markdown" align="start">
        <Textarea
          name="description"
          defaultValue={draft?.get("description") ?? offering?.description ?? ""}
          className="min-h-[80px] w-full"
        />
      </Field>

      <Field layout="row" label="Location" hint="launch point">
        <span className="flex flex-wrap items-center gap-3">
          <select
            name="locationId"
            required
            defaultValue={draft?.get("locationId") ?? offering?.locationId ?? ""}
            className={`${fieldClass()} w-full max-w-[280px]`}
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

      <Field layout="row" label="Trip length" hint="on the water">
        <span className="flex items-center gap-2">
          <Input
            name="tripLengthMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("tripLengthMinutes") ?? offering?.tripLengthMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field layout="row" label="Boat held for" hint="turnaround included">
        <span className="flex items-center gap-2">
          <Input
            name="holdMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("holdMinutes") ?? offering?.holdMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field layout="row" label="Arrive before" hint="guest call time">
        <span className="flex items-center gap-2">
          <Input
            name="arriveBeforeMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("arriveBeforeMinutes") ?? offering?.arriveBeforeMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field layout="row" label="Vessels" hint="which boats run it">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {vessels.map((v) => (
            <label key={v.id}>
              <input
                type="checkbox"
                name="vesselIds"
                value={v.id}
                defaultChecked={
                  draft ? draft.has("vesselIds", v.id) : offering?.vesselIds.includes(v.id) ?? false
                }
                className="peer sr-only"
              />
              <span className="flex select-none items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-accent/40 peer-checked:bg-bg peer-checked:font-medium peer-checked:text-ink">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                  aria-hidden
                />
                {v.name}
              </span>
            </label>
          ))}
        </div>
        <p className="pt-1.5 text-xs text-muted">
          Capacity is a fact of each vessel, set on the Vessel screen — never here. Boats
          needing a different schedule are a different offering.
        </p>
      </Field>
    </Section>
  );
}

// ── 2 · Schedule ─────────────────────────────────────────────────────────────
export function ScheduleSection({
  offering,
  draft,
}: {
  offering: Offering | null;
  draft: FormDraft | null;
}) {
  const schedule = offering?.schedule;
  return (
    <Section id="schedule" title="Schedule" hint="a rule, not rows">
      <Field layout="row" label="Season">
        <span className="flex flex-wrap items-center gap-2">
          <Input
            name="seasonStart"
            type="date"
            required
            defaultValue={draft?.get("seasonStart") ?? schedule?.seasonStart ?? ""}
            className="font-mono"
          />
          <span className="text-xs text-muted">to</span>
          <Input
            name="seasonEnd"
            type="date"
            required
            defaultValue={draft?.get("seasonEnd") ?? schedule?.seasonEnd ?? ""}
            className="font-mono"
          />
        </span>
      </Field>

      <Field layout="row" label="Days">
        <div className="flex flex-wrap gap-2 pt-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <label key={label}>
              <input
                type="checkbox"
                name="weekday"
                value={d}
                defaultChecked={
                  draft
                    ? draft.has("weekday", String(d))
                    : schedule?.weekdays.includes(d) ?? false
                }
                className="peer sr-only"
              />
              <span className={chipClass}>{label}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field layout="row" label="Departures" hint="add or remove times" align="start">
        <div className="pt-1">
          {/* The island serializes each time to a hidden `departureTime` input, so the draft
              carries the whole list back — including one added and not yet saved. */}
          <DepartureTimesEditor
            initial={draft ? draft.all("departureTime") : schedule?.departureTimes ?? []}
          />
        </div>
        <p className="pt-1.5 text-xs text-muted">
          Availability is computed from this rule — schedule × vessels × dates − blocks −
          bookings. Draft generates no slots; flip to Live and they appear. Blocks/blackout
          live on their own surface, not here.
        </p>
      </Field>
    </Section>
  );
}

// ── 3 · Pricing ──────────────────────────────────────────────────────────────
/**
 * The variations the island should open with: the draft's serialized list when there is one,
 * else the record's. A draft that won't parse falls back to the record rather than dropping the
 * rows — `bad_variations` is itself a parse refusal, and an empty editor would read as "your
 * rows are gone" when they are merely unsaved.
 */
function variationsFor(draft: FormDraft | null, offering: Offering | null): PriceVariation[] {
  const raw = draft?.get("priceVariations");
  if (raw === undefined) return offering?.priceVariations ?? [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PriceVariation[]) : offering?.priceVariations ?? [];
    // NOT a fault (#854). `raw` is a stashed form draft, i.e. bytes a browser
    // round-tripped through a cookie. An unparseable draft is bad input with a defined
    // answer (fall back to the saved offering), which the line above already handles
    // for the non-array case.
    // eslint-disable-next-line no-restricted-syntax -- unparseable draft cookie, not a fault
  } catch {
    return offering?.priceVariations ?? [];
  }
}

export function PricingSection({
  offering,
  draft,
}: {
  offering: Offering | null;
  draft: FormDraft | null;
}) {
  return (
    <Section id="pricing" title="Pricing" hint="the boat, by the guest">
      <Field layout="row" label="Base fare" hint="buys the whole boat">
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted">$</span>
          <Input
            name="basePrice"
            required
            inputMode="decimal"
            defaultValue={
              draft?.get("basePrice") ?? (offering ? (offering.basePriceCents / 100).toFixed(2) : "")
            }
            className="max-w-[130px] font-mono"
          />
        </span>
      </Field>

      <Field layout="row" label="Included guests" hint="the base fare covers">
        <span className="flex items-center gap-2">
          <Input
            name="includedGuestCount"
            type="number"
            min={1}
            defaultValue={draft?.get("includedGuestCount") ?? offering?.includedGuestCount ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">blank = the boat’s full capacity</span>
        </span>
      </Field>

      <Field layout="row" label="Extra guest" hint="above the included count">
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted">$</span>
          <Input
            name="extraGuestPrice"
            required
            inputMode="decimal"
            defaultValue={
              draft?.get("extraGuestPrice") ??
              (offering ? (offering.extraGuestPriceCents / 100).toFixed(2) : "0.00")
            }
            className="max-w-[130px] font-mono"
          />
          <span className="text-xs text-muted">each, up to that boat’s max</span>
        </span>
      </Field>

      <Field layout="row" label="Variations" hint="first match wins" align="start">
        <div className="pt-1">
          <PriceVariationsEditor initial={variationsFor(draft, offering)} />
        </div>
      </Field>
    </Section>
  );
}

// ── 4 · Gratuity ─────────────────────────────────────────────────────────────
export function GratuitySection({
  offering,
  draft,
}: {
  offering: Offering | null;
  draft: FormDraft | null;
}) {
  // Render from the effective per-kind config: an offering with none yet shows the code
  // default (pre, required, 15/20/25) — saving writes it explicitly. Post-trip tipping went in
  // 15.18, so there is one row here now.
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
        draft={draft}
      />
      <p className="py-3 text-xs text-muted">
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
  draft,
}: {
  kind: "pre" | "post";
  label: string;
  when: string;
  config: GratuityKindConfig | undefined;
  draft: FormDraft | null;
}) {
  const cap = kind === "pre" ? "Pre" : "Post";
  return (
    <Field layout="row" label={label} hint={when}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            name={`grat${cap}`}
            defaultChecked={draft ? draft.has(`grat${cap}`) : config !== undefined}
          />
          Collect
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Tiers %
          <Input
            name={`grat${cap}Tiers`}
            defaultValue={
              draft?.get(`grat${cap}Tiers`) ??
              (config?.tiersBps ?? [1500, 2000, 2500]).map((t) => t / 100).join(", ")
            }
            className="max-w-[130px] font-mono"
            aria-label={`${label} gratuity tiers (percent)`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Default %
          <Input
            name={`grat${cap}Default`}
            defaultValue={draft?.get(`grat${cap}Default`) ?? (config?.defaultBps ?? 2000) / 100}
            className="max-w-[70px] font-mono"
            aria-label={`${label} gratuity default (percent)`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            name={`grat${cap}Required`}
            defaultChecked={
              draft ? draft.has(`grat${cap}Required`) : config?.required ?? kind === "pre"
            }
          />
          Required
        </label>
      </div>
    </Field>
  );
}

// ── 5 · Add-ons ──────────────────────────────────────────────────────────────
export function AddOnsSection({
  offering,
  addOns,
  draft,
}: {
  offering: Offering | null;
  /** ACTIVE add-ons only (#491) — the offering ATTACHES existing add-ons by id; it no longer
   *  defines them inline. The set is edited at /admin/add-ons. */
  addOns: AddOn[];
  draft: FormDraft | null;
}) {
  const attached = new Set(offering?.addOnIds ?? []);
  return (
    <Section id="addons" title="Add-ons" hint="attach shared add-ons — revenue">
      {addOns.length === 0 ? (
        <p className="py-3 text-sm text-muted">
          No add-ons defined yet.{" "}
          <AppLink href="/admin/add-ons" className="text-accent">
            Create one on the Add-ons screen
          </AppLink>{" "}
          — then attach it here.
        </p>
      ) : (
        <div className="flex flex-col gap-2 py-3">
          {/* Structurally the vessels checkbox group: pick which shared add-ons this offering
              sells. `required` is the add-on's own global, shown as a tag, not set here. Only
              ACTIVE add-ons appear — a previously-attached add-on that's since been retired
              won't be in this list and so drops from `addOnIds` on the next save (acceptable
              first cut, #491). */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {addOns.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  name="addOnIds"
                  value={a.id}
                  defaultChecked={draft ? draft.has("addOnIds", a.id) : attached.has(a.id)}
                  className="peer sr-only"
                />
                <span className="flex select-none items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-accent/40 peer-checked:bg-bg peer-checked:font-medium peer-checked:text-ink">
                  {a.label}
                  <span className="text-xs text-muted">${(a.amountCents / 100).toFixed(2)}</span>
                  {a.required && (
                    <span className="rounded-full bg-warn-bg px-1.5 text-[10px] uppercase tracking-wide text-warn">
                      Required
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Add-ons are taxed + fee’d as revenue, and shared across offerings —{" "}
            <AppLink href="/admin/add-ons" className="text-accent">
              manage them here
            </AppLink>
            . Gratuity is NOT an add-on — it’s crew money, its own section.
          </p>
        </div>
      )}
    </Section>
  );
}
