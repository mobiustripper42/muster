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
import { Chip, Checkbox } from "../../../../components/ui/choice";
import { Input, Select, Textarea } from "../../../../components/ui/input";
import type { FormDraft } from "../../../lib/form-draft";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { PriceVariationsEditor } from "./price-variations-editor";
import { DepartureTimesEditor } from "./departure-times-editor";
import { Card } from "../../../../components/ui/card";

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
    <Card id={id} as="section" pad="none" className="scroll-mt-4">
      <div className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="ml-auto text-right text-xs text-muted">{hint}</span>
      </div>
      <div className="px-4 py-1">{children}</div>
    </Card>
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
      <Field group layout="row" label="Status">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(["draft", "live", "hidden"] as const).map((s) => (
            <Chip
              key={s}
              type="radio"
              name="status"
              value={s}
              defaultChecked={(draft?.get("status") ?? offering?.status ?? "draft") === s}
            >
              {STATUS_COPY[s].label}
            </Chip>
          ))}
        </div>
        <p className="pt-1.5 text-xs text-muted">
          Draft = not sellable, generates no slots · Live = on sale · Hidden = pulled from
          browse + this list, bookings kept
        </p>
      </Field>

      <Field htmlFor="offering-name" layout="row" label="Name">
        <Input
          id="offering-name"
          name="name"
          required
          defaultValue={draft?.get("name") ?? offering?.name ?? ""}
          className="w-full max-w-[420px]"
        />
      </Field>

      <Field
        htmlFor="offering-description"
        layout="row"
        label="Description"
        hint="markdown"
        align="start"
      >
        <Textarea
          id="offering-description"
          name="description"
          defaultValue={draft?.get("description") ?? offering?.description ?? ""}
          className="min-h-[80px] w-full"
        />
      </Field>

      <Field htmlFor="offering-location-id" layout="row" label="Location" hint="launch point">
        <span className="flex flex-wrap items-center gap-3">
          <Select
            id="offering-location-id"
            name="locationId"
            required
            defaultValue={draft?.get("locationId") ?? offering?.locationId ?? ""}
            className="w-full max-w-[280px]"
          >
            <option value="" disabled>
              — pick a location —
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <AppLink href="/admin/locations" className="text-xs text-accent">
            Manage locations →
          </AppLink>
        </span>
      </Field>

      <Field
        htmlFor="offering-trip-length-minutes"
        layout="row"
        label="Trip length"
        hint="on the water"
      >
        <span className="flex items-center gap-2">
          <Input
            id="offering-trip-length-minutes"
            name="tripLengthMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("tripLengthMinutes") ?? offering?.tripLengthMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field
        htmlFor="offering-hold-minutes"
        layout="row"
        label="Boat held for"
        hint="turnaround included"
      >
        <span className="flex items-center gap-2">
          <Input
            id="offering-hold-minutes"
            name="holdMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("holdMinutes") ?? offering?.holdMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field
        htmlFor="offering-arrive-before-minutes"
        layout="row"
        label="Arrive before"
        hint="guest call time"
      >
        <span className="flex items-center gap-2">
          <Input
            id="offering-arrive-before-minutes"
            name="arriveBeforeMinutes"
            type="number"
            min={0}
            defaultValue={draft?.get("arriveBeforeMinutes") ?? offering?.arriveBeforeMinutes ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">minutes</span>
        </span>
      </Field>

      <Field group layout="row" label="Vessels" hint="which boats run it">
        <div className="flex flex-wrap items-center gap-2">
          {vessels.map((v) => (
            <Chip
              key={v.id}
              type="checkbox"
              name="vesselIds"
              value={v.id}
              defaultChecked={
                draft ? draft.has("vesselIds", v.id) : offering?.vesselIds.includes(v.id) ?? false
              }
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(v.id, v.hue)}`}
                aria-hidden
              />
              {v.name}
            </Chip>
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
      <Field group layout="row" label="Season">
        <span className="flex flex-wrap items-center gap-2">
          <Input
            name="seasonStart"
            type="date"
            required
            aria-label="Season start"
            defaultValue={draft?.get("seasonStart") ?? schedule?.seasonStart ?? ""}
            className="font-mono"
          />
          <span className="text-xs text-muted">to</span>
          <Input
            name="seasonEnd"
            type="date"
            required
            aria-label="Season end"
            defaultValue={draft?.get("seasonEnd") ?? schedule?.seasonEnd ?? ""}
            className="font-mono"
          />
        </span>
      </Field>

      <Field group layout="row" label="Days">
        <div className="flex flex-wrap gap-2 pt-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <Chip
              key={label}
              type="checkbox"
              name="weekday"
              value={d}
              defaultChecked={
                draft
                  ? draft.has("weekday", String(d))
                  : schedule?.weekdays.includes(d) ?? false
              }
            >
              {label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field group layout="row" label="Departures" hint="add or remove times">
        <div>
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
      <Field
        htmlFor="offering-base-price"
        layout="row"
        label="Base fare"
        hint="buys the whole boat"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted">$</span>
          <Input
            id="offering-base-price"
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

      <Field
        htmlFor="offering-included-guest-count"
        layout="row"
        label="Included guests"
        hint="the base fare covers"
      >
        <span className="flex items-center gap-2">
          <Input
            id="offering-included-guest-count"
            name="includedGuestCount"
            type="number"
            min={1}
            defaultValue={draft?.get("includedGuestCount") ?? offering?.includedGuestCount ?? ""}
            className="max-w-[110px] font-mono"
          />
          <span className="text-xs text-muted">blank = the boat’s full capacity</span>
        </span>
      </Field>

      <Field
        htmlFor="offering-extra-guest-price"
        layout="row"
        label="Extra guest"
        hint="above the included count"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted">$</span>
          <Input
            id="offering-extra-guest-price"
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

      <Field group layout="row" label="Variations" hint="first match wins">
        <div>
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
    <Field group layout="row" label={label} hint={when}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Checkbox
          density="dense"
          name={`grat${cap}`}
          defaultChecked={draft ? draft.has(`grat${cap}`) : config !== undefined}
        >
          Collect
        </Checkbox>
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
        <Checkbox
          density="dense"
          name={`grat${cap}Required`}
          defaultChecked={
            draft ? draft.has(`grat${cap}Required`) : config?.required ?? kind === "pre"
          }
        >
          Required
        </Checkbox>
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
              <Chip
                key={a.id}
                type="checkbox"
                name="addOnIds"
                value={a.id}
                defaultChecked={draft ? draft.has("addOnIds", a.id) : attached.has(a.id)}
              >
                {a.label}
                {/* No colour of its own: it inherits the chip's, which turns white on the dark
                    "on" fill — `text-muted` here would vanish against it. */}
                <span className="text-xs">${(a.amountCents / 100).toFixed(2)}</span>
                {a.required && (
                  <span className="rounded-full bg-warn-bg px-1.5 text-[10px] uppercase tracking-wide text-warn">
                    Required
                  </span>
                )}
              </Chip>
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
