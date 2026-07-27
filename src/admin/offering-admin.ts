/**
 * Offering admin upsert (task 12.8) — the validated write door behind the /admin/offerings
 * catalog editor. Same `{ ok }`-result idiom as `saveVesselAdmin`/`saveLocationAdmin`:
 * framework-free, string-union error codes the server action maps to copy.
 *
 * Scope is the DEC-123 catalog model: name/status/description, the Location picker, the
 * vessel set (capacity is a Vessel fact — never here), the DEC-125 schedule rule, pricing
 * (base + included count + extra-guest + ordered first-match-wins variations), the per-kind
 * gratuity config (crew money — DEC-124), and generic add-ons (revenue). `tenantId` is the
 * one field the form doesn't carry — preserved from the existing row on an edit, taken from
 * the caller on a create. Hidden is a reversible soft-delete (a status, not a delete path);
 * there is deliberately no remove method.
 */
import type {
  GratuityKindConfig,
  Offering,
  OfferingStatus,
  PriceVariation,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export interface OfferingAdminInput {
  /** The offering id — the action mints a fresh one for a create, reuses it for an edit. */
  id: string;
  /** The owning tenant for a CREATE; an edit preserves the existing row's tenant. */
  tenantId: string;
  name: string;
  status: string;
  description?: string;
  locationId: string;
  vesselIds: string[];
  tripLengthMinutes?: number;
  holdMinutes?: number;
  arriveBeforeMinutes?: number;
  schedule: {
    seasonStart: string;
    seasonEnd: string;
    weekdays: number[];
    departureTimes: string[];
  };
  basePriceCents: number;
  includedGuestCount?: number;
  extraGuestPriceCents: number;
  priceVariations: PriceVariation[];
  gratuityKinds?: GratuityKindConfig[];
  /** Attached add-on ids (#491) — references to first-class AddOn entities, like `vesselIds`. */
  addOnIds?: string[];
}

export type OfferingSaveResult =
  | { ok: true; id: string }
  | { ok: false; code: OfferingSaveError };
export type OfferingSaveError =
  | "name_required"
  | "bad_status"
  | "bad_location"
  | "bad_vessels"
  | "bad_schedule"
  | "bad_price"
  | "bad_included_guests"
  | "included_over_capacity"
  | "bad_minutes"
  | "bad_variations"
  | "bad_gratuity"
  | "bad_add_ons";

const STATUSES: OfferingStatus[] = ["draft", "live", "hidden"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar day, not just the shape — "2026-02-31" must fail (service-layer
 *  integrity: dates are text, DEC-DATA-1, so validation lives here). */
function isIsoDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;
const isWeekday = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;

function validVariation(v: PriceVariation): boolean {
  if (!v.label.trim()) return false;
  const a = v.applies;
  if (a.kind === "weekdays") {
    if (a.weekdays.length === 0 || !a.weekdays.every(isWeekday)) return false;
  } else if (a.kind === "date") {
    if (!isIsoDay(a.date)) return false;
  } else if (a.kind === "dateRange") {
    if (!isIsoDay(a.start) || !isIsoDay(a.end) || a.start > a.end) return false;
  } else {
    return false;
  }
  const adj = v.adjustment;
  if (adj.kind === "flatCents") return Number.isInteger(adj.deltaCents);
  if (adj.kind === "percent") return Number.isFinite(adj.percent) && adj.percent > -100;
  return false;
}

function validGratuityKinds(kinds: GratuityKindConfig[]): boolean {
  const seen = new Set<string>();
  for (const k of kinds) {
    if (k.kind !== "pre" && k.kind !== "post") return false;
    if (seen.has(k.kind)) return false; // one config per kind
    seen.add(k.kind);
    if (k.tiersBps.length === 0) return false;
    if (!k.tiersBps.every((t) => Number.isInteger(t) && t > 0 && t <= 10000)) return false;
    if (!k.tiersBps.includes(k.defaultBps)) return false;
    if (typeof k.required !== "boolean") return false;
  }
  return true;
}

export async function saveOfferingAdmin(
  repo: Repository,
  input: OfferingAdminInput,
): Promise<OfferingSaveResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, code: "name_required" };
  if (!STATUSES.includes(input.status as OfferingStatus)) {
    return { ok: false, code: "bad_status" };
  }

  // Cross-entity references — the picked Location and every picked Vessel must exist.
  if (!input.locationId || !(await repo.getLocation(asId<"LocationId">(input.locationId)))) {
    return { ok: false, code: "bad_location" };
  }
  if (input.vesselIds.length === 0) return { ok: false, code: "bad_vessels" };
  const vessels = [];
  for (const vid of input.vesselIds) {
    const vessel = await repo.getVessel(asId<"VesselId">(vid));
    if (!vessel) return { ok: false, code: "bad_vessels" };
    vessels.push(vessel);
  }

  // The DEC-125 schedule rule. Empty weekdays/times are allowed (a draft-in-progress just
  // publishes nothing); what IS present must be well-formed, and the season must be ordered.
  const s = input.schedule;
  if (
    !isIsoDay(s.seasonStart) ||
    !isIsoDay(s.seasonEnd) ||
    s.seasonStart > s.seasonEnd ||
    !s.weekdays.every(isWeekday) ||
    new Set(s.weekdays).size !== s.weekdays.length ||
    !s.departureTimes.every((t) => CLOCK.test(t)) ||
    new Set(s.departureTimes).size !== s.departureTimes.length
  ) {
    return { ok: false, code: "bad_schedule" };
  }

  if (!isCount(input.basePriceCents) || !isCount(input.extraGuestPriceCents)) {
    return { ok: false, code: "bad_price" };
  }
  if (
    input.includedGuestCount !== undefined &&
    (!Number.isInteger(input.includedGuestCount) || input.includedGuestCount < 1)
  ) {
    return { ok: false, code: "bad_included_guests" };
  }
  // The base-fare included count can't exceed the smallest picked vessel's capacity —
  // otherwise composeFare clamps that boat's extra-guest charge to 0 (a silent discount).
  if (
    input.includedGuestCount !== undefined &&
    input.includedGuestCount > Math.min(...vessels.map((v) => v.coiMaxPax))
  ) {
    return { ok: false, code: "included_over_capacity" };
  }
  for (const m of [input.tripLengthMinutes, input.holdMinutes, input.arriveBeforeMinutes]) {
    if (m !== undefined && (!Number.isInteger(m) || m < 0)) {
      return { ok: false, code: "bad_minutes" };
    }
  }
  if (!input.priceVariations.every(validVariation)) {
    return { ok: false, code: "bad_variations" };
  }
  if (input.gratuityKinds !== undefined && !validGratuityKinds(input.gratuityKinds)) {
    return { ok: false, code: "bad_gratuity" };
  }
  // Add-ons are attached by id (#491) — every referenced add-on must exist (mirrors the vessel
  // existence check). `required`/pricing are the add-on's own facts, validated on its screen.
  if (input.addOnIds !== undefined) {
    for (const aid of input.addOnIds) {
      if (!(await repo.getAddOn(asId<"AddOnId">(aid)))) return { ok: false, code: "bad_add_ons" };
    }
  }

  const id = asId<"OfferingId">(input.id);
  // Preserve the one field the form doesn't carry: an edit keeps the row's tenant.
  const existing = await repo.getOffering(id);
  const description = input.description?.trim();

  const offering: Offering = {
    id,
    tenantId: existing?.tenantId ?? asId<"TenantId">(input.tenantId),
    name,
    status: input.status as OfferingStatus,
    vesselIds: input.vesselIds.map((v) => asId<"VesselId">(v)),
    locationId: asId<"LocationId">(input.locationId),
    schedule: {
      seasonStart: s.seasonStart,
      seasonEnd: s.seasonEnd,
      weekdays: [...s.weekdays],
      departureTimes: [...s.departureTimes],
    },
    basePriceCents: input.basePriceCents,
    // Order is the rule (first match wins, DEC-123) — persist exactly as given.
    priceVariations: input.priceVariations,
    extraGuestPriceCents: input.extraGuestPriceCents,
    ...(description ? { description } : {}),
    ...(input.tripLengthMinutes !== undefined
      ? { tripLengthMinutes: input.tripLengthMinutes }
      : {}),
    ...(input.holdMinutes !== undefined ? { holdMinutes: input.holdMinutes } : {}),
    ...(input.arriveBeforeMinutes !== undefined
      ? { arriveBeforeMinutes: input.arriveBeforeMinutes }
      : {}),
    ...(input.includedGuestCount !== undefined
      ? { includedGuestCount: input.includedGuestCount }
      : {}),
    ...(input.gratuityKinds !== undefined ? { gratuityKinds: input.gratuityKinds } : {}),
    ...(input.addOnIds !== undefined && input.addOnIds.length > 0
      ? { addOnIds: input.addOnIds.map((a) => asId<"AddOnId">(a)) }
      : {}),
  };
  await repo.saveOffering(offering);
  return { ok: true, id: input.id };
}
