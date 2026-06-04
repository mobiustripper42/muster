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
 * ⚠️ FLAG FOR OPERATOR VALIDATION (DEC-016): the `vesselId`s are invented handles
 * and the `capacity` numbers are guessed from the product names (the export
 * carries no capacity column). Confirm against the real COIs before trusting.
 */

import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";

export interface ProductMapping {
  vesselId: VesselId;
  /** COI max-pax — guessed from the product name; needs operator validation. */
  capacity: number;
}

const v = (id: string): VesselId => asId<"VesselId">(id);

/** Exact-match map for the live products seen in the 2026 export. */
const PRODUCT_MAP: Record<string, ProductMapping> = {
  "Brew Boat Party Boats with Captain": { vesselId: v("vessel-brewboat-party"), capacity: 16 },
  "BrewBoat Non Cycle | Private 12 Passenger | With Captain": { vesselId: v("vessel-brewboat-private12"), capacity: 12 },
  "Duffy Boat Rental | (1-12 Guests) | Self Captained": { vesselId: v("vessel-duffy-rental"), capacity: 12 },
  "Captained Duffy Boat | (7 to 11 Guests) | With Captain | Single Boat": { vesselId: v("vessel-duffy-captained-11"), capacity: 11 },
  "Captained Duffy Boat | (1-6 Guests) | With Captain": { vesselId: v("vessel-duffy-captained-6"), capacity: 6 },
};

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
