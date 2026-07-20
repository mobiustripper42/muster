import type { ReactNode } from "react";
import type { GratuityKindConfig, Location, Offering, Vessel } from "@core/domain/entities.js";
import { gratuityKindsFor } from "@core/reservations/pricing.js";
import { AppLink } from "../../../../components/ui/app-link";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { PriceVariationsEditor } from "./price-variations-editor";

/**
 * The /admin/offerings editor sections (task 12.8, DEC-123), split out of `page.tsx` to keep
 * the page shell (data load + master list + form) reviewable. Each is a server-rendered
 * section of the one native `<form>` in page.tsx — the only client island is
 * `PriceVariationsEditor` (drag/reorder). `STATUS_COPY` lives here (the status chip renders
 * it) and is re-exported for the page header + sidebar pills, so imports flow one way.
 */

const inputClass = settingsInputClass;
const chipClass =
  "cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-sm text-muted peer-checked:border-ink peer-checked:bg-ink peer-checked:font-medium peer-checked:text-white";

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
        <span className="ml-auto text-right text-xs text-faint">{hint}</span>
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
export function ScheduleSection({ offering }: { offering: Offering | null }) {
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
export function PricingSection({ offering }: { offering: Offering | null }) {
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
export function GratuitySection({ offering }: { offering: Offering | null }) {
  // Render from the effective per-kind config: an offering with none yet shows the code
  // defaults (pre required + post optional, 15/20/25) — saving writes them explicitly.
  const kinds = gratuityKindsFor(offering ?? {});
  const byKind = (k: "pre" | "post"): GratuityKindConfig | undefined =>
    kinds.find((g) => g.kind === k);
  return (
    <Section id="gratuity" title="Gratuity" hint="crew money — not an add-on, not revenue">
      <GratuityKindRow kind="pre" label="Pre" when="at checkout" config={byKind("pre")} />
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
export function AddOnsSection({ offering }: { offering: Offering | null }) {
  const rows = offering?.addOns ?? [];
  return (
    <Section id="addons" title="Add-ons" hint="real upsells only — revenue">
      <div className="flex flex-col gap-2 py-3">
        {rows.map((a, i) => (
          <AddOnRow
            key={`${a.label}-${i}`}
            label={a.label}
            amount={(a.amountCents / 100).toFixed(2)}
            required={a.required}
          />
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
