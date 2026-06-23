/**
 * Xola Resource → vessel map (DEC-043, supersedes DEC-016's product collapse).
 *
 * The boat a trip runs on is a Xola **Resource** attached to its event
 * (`event.resourceUsages[].resource.id`), NOT a vessel invented from the free-text
 * product string. This is the seeded lookup from a real Xola resource id → the
 * real BrewBoat vessel, validated against live production data (Session 22):
 *
 *   Brew 1  656e10bc…  cap 14     Brew 2  656e10ce…  cap 16
 *   Brew 3  656e0fcd…  cap 12     Brew 4  656e0feb…  cap 12      (all captain+mate)
 *   Duffy 1 656e0f76… / Duffy 656e0f96…  cap 12 — SELF-CAPTAINED, excluded (0 crew)
 *
 * Per DEC-018 the durable design auto-suggests + operator-confirms unseen
 * resources and quarantines the unconfirmed; here we seed the known live fleet and
 * quarantine any unrecognized resource id — fulfilling DEC-018's own "key off a
 * stable vessel id" revisit (the product string is no longer the vessel axis).
 *
 * `seedFleet` materializes the four crewed vessels + their role types so the
 * builder can derive seats. Manning is data the seat-deriver iterates (DEC-ROLE-1):
 * every BrewBoat is [captain×1, mate×1] — **2 crew, no exceptions** (operator-
 * confirmed, Session 22). Self-captained Duffy boats are excluded from the fleet.
 */

import type { ManningRequirement, RoleType, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { RoleTypeId, TenantId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

// BrewBoat's seeded role rows (DEC-ROLE-1: data, not an enum).
export const BREWBOAT_TENANT: TenantId = asId<"TenantId">("tenant-brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
/** Every BrewBoat: one captain + one mate. The whole fleet, no exceptions. */
const crew2: ManningRequirement[] = [
  { roleTypeId: CAPTAIN, count: 1 },
  { roleTypeId: MATE, count: 1 },
];

const v = (id: string): VesselId => asId<"VesselId">(id);

export interface FleetVessel {
  vesselId: VesselId;
  name: string;
  /** COI max pax — confirmed against the live Xola Resource capacity (Session 22). */
  capacity: number;
  manning: ManningRequirement[];
}

/**
 * Xola Resource id → the real crewed BrewBoat. Keyed by the stable resource id
 * (validated live). The vessel handle is readable so it threads into shift ids
 * legibly (`shift-vessel-brew-2-2026-07-04`), not as an opaque hex id.
 */
const RESOURCE_MAP: Record<string, FleetVessel> = {
  "656e10bc5b8ef1b1800a02c4": { vesselId: v("vessel-brew-1"), name: "Brew 1", capacity: 14, manning: crew2 },
  "656e10ce46c61175bd0de305": { vesselId: v("vessel-brew-2"), name: "Brew 2", capacity: 16, manning: crew2 },
  "656e0fcdf9f593e84b0e1782": { vesselId: v("vessel-brew-3"), name: "Brew 3", capacity: 12, manning: crew2 },
  "656e0feb91aa27f36908371b": { vesselId: v("vessel-brew-4"), name: "Brew 4", capacity: 12, manning: crew2 },
};

/**
 * Self-captained Duffy rentals — real boats, but they carry **no crew**, so
 * they're excluded from the crewing fleet (a known exclusion, not a quarantine).
 */
const EXCLUDED_RESOURCES: Record<string, string> = {
  "656e0f760c4f4326c10c1b8b": "Duffy 1 (self-captained)",
  "656e0f96c4c73ccef3029bc3": "Duffy (self-captained)",
};

export type ResourceResolution =
  | { kind: "mapped"; vessel: FleetVessel }
  | { kind: "ignored"; reason: string }
  | { kind: "unmapped"; reason: string };

/** Resolve a Xola resource id to a crewed vessel, a known exclusion, or a quarantine. */
export function resolveResource(resourceId: string): ResourceResolution {
  const vessel = RESOURCE_MAP[resourceId];
  if (vessel) return { kind: "mapped", vessel };
  const excluded = EXCLUDED_RESOURCES[resourceId];
  if (excluded) return { kind: "ignored", reason: `self-captained resource: ${excluded}` };
  return { kind: "unmapped", reason: `unmapped resource id: ${resourceId}` };
}

const VESSEL_BY_ID: Record<string, FleetVessel> = Object.fromEntries(
  Object.values(RESOURCE_MAP).map((fv) => [fv.vesselId, fv]),
);

/**
 * COI capacity for a known vessel id (reverse lookup). Used when the event upsert
 * knows only the vessel — e.g. a cancelled trip reconciled against its stored
 * event, where no resource is re-resolved. `undefined` for an unknown vessel.
 */
export function vesselCapacity(vesselId: VesselId): number | undefined {
  return VESSEL_BY_ID[vesselId]?.capacity;
}

/**
 * Materialize the 4 crewed vessels + captain/mate role types into the repository
 * so the shift builder can derive seats from manning. Idempotent. Returns the
 * tenant id. The vessel `name` is the human boat name ("Brew 2"), not the id.
 */
export async function seedFleet(repo: Repository): Promise<TenantId> {
  const role = (id: RoleTypeId, name: string): RoleType => ({
    id,
    tenantId: BREWBOAT_TENANT,
    name,
  });
  await repo.saveRoleType(role(CAPTAIN, "captain"));
  await repo.saveRoleType(role(MATE, "mate"));

  for (const fv of Object.values(RESOURCE_MAP)) {
    const vessel: Vessel = {
      id: fv.vesselId,
      name: fv.name,
      coiMaxPax: fv.capacity,
      manning: fv.manning,
    };
    await repo.saveVessel(vessel);
  }
  return BREWBOAT_TENANT;
}
