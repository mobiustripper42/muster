/**
 * Product string → vessel map (DEC-018, thin-path slice).
 *
 * Xola encodes the vessel in a free-text `Product` string. This is the seeded
 * lookup for the products observed in the real export. Per DEC-018 the durable
 * design auto-suggests + operator-confirms unseen products and quarantines the
 * unconfirmed; for the thin-path slice we seed the known live products directly
 * and quarantine anything unrecognized. Test/copy listings ("…TRIAL…") are
 * excluded.
 *
 * ⚠️ FLAG FOR OPERATOR VALIDATION (DEC-016): the `vesselId`s are invented handles,
 * the `capacity` numbers are guessed from the product names (the export carries no
 * capacity column), and the `manning` rows are invented (the export carries no
 * crew rule). Confirm all three against the real COIs/manning before trusting.
 *
 * This realizes DEC-018's "Product → { vessel, manning }" lookup; `seedFleet`
 * materializes the mapped vessels + their role types so the builder can derive
 * seats (M2). Manning is data the seat-deriver iterates (DEC-ROLE-1) — these are
 * just rows: 2-crew party boats, 1-crew captained Duffy, 0-crew self-captained.
 */

import type { ManningRequirement, RoleType, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { RoleTypeId, TenantId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export interface ProductMapping {
  vesselId: VesselId;
  /** COI max-pax — guessed from the product name; needs operator validation. */
  capacity: number;
  /** Per-vessel manning (DEC-018) — invented; needs operator validation. */
  manning: ManningRequirement[];
}

const v = (id: string): VesselId => asId<"VesselId">(id);

// BrewBoat's seeded role rows (DEC-ROLE-1: data, not an enum).
export const BREWBOAT_TENANT: TenantId = asId<"TenantId">("tenant-brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const crew2: ManningRequirement[] = [
  { roleTypeId: CAPTAIN, count: 1 },
  { roleTypeId: MATE, count: 1 },
];
const captainOnly: ManningRequirement[] = [{ roleTypeId: CAPTAIN, count: 1 }];

/** Exact-match map for the live products seen in the 2026 export. */
const PRODUCT_MAP: Record<string, ProductMapping> = {
  "Brew Boat Party Boats with Captain": { vesselId: v("vessel-brewboat-party"), capacity: 16, manning: crew2 },
  "BrewBoat Non Cycle | Private 12 Passenger | With Captain": { vesselId: v("vessel-brewboat-private12"), capacity: 12, manning: crew2 },
  "Duffy Boat Rental | (1-12 Guests) | Self Captained": { vesselId: v("vessel-duffy-rental"), capacity: 12, manning: [] },
  "Captained Duffy Boat | (7 to 11 Guests) | With Captain | Single Boat": { vesselId: v("vessel-duffy-captained-11"), capacity: 11, manning: captainOnly },
  "Captained Duffy Boat | (1-6 Guests) | With Captain": { vesselId: v("vessel-duffy-captained-6"), capacity: 6, manning: captainOnly },
};

/**
 * Materialize the mapped vessels + their role types into the repository so the
 * shift builder can derive seats from manning (M2). Idempotent. Returns the
 * tenant id. The vessel `name` is the product-map key's vesselId handle for now.
 */
export async function seedFleet(repo: Repository): Promise<TenantId> {
  const role = (id: RoleTypeId, name: string): RoleType => ({
    id,
    tenantId: BREWBOAT_TENANT,
    name,
  });
  await repo.saveRoleType(role(CAPTAIN, "captain"));
  await repo.saveRoleType(role(MATE, "mate"));

  const seen = new Set<string>();
  for (const m of Object.values(PRODUCT_MAP)) {
    if (seen.has(m.vesselId)) continue;
    seen.add(m.vesselId);
    const vessel: Vessel = {
      id: m.vesselId,
      name: m.vesselId,
      coiMaxPax: m.capacity,
      manning: m.manning,
    };
    await repo.saveVessel(vessel);
  }
  return BREWBOAT_TENANT;
}

export type ProductResolution =
  | { kind: "mapped"; mapping: ProductMapping }
  | { kind: "ignored"; reason: string }
  | { kind: "unmapped"; reason: string };

/** Resolve a raw Product string to a vessel, an ignore, or a quarantine. */
export function resolveProduct(product: string): ProductResolution {
  if (/trial/i.test(product)) {
    return { kind: "ignored", reason: `test/trial listing: ${product}` };
  }
  const mapping = PRODUCT_MAP[product];
  if (mapping) return { kind: "mapped", mapping };
  return { kind: "unmapped", reason: `unmapped product: ${product}` };
}
