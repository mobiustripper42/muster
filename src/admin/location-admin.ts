/**
 * Location admin upsert (task 12.9) — the validated write door behind the Location settings
 * screen. Same `{ ok }`-result idiom as `saveVesselAdmin`. A Location is a first-class entity
 * (DEC-123): the customer-facing pickup (description + map link) and route blurb, edited once
 * and referenced by every Offering that launches here, and the target of a location block
 * (DEC-125). No create/edit flag — the action mints an id for a create, reuses it for an edit.
 */
import type { Location } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export interface LocationAdminInput {
  id: string;
  name: string;
  pickupDescription: string;
  pickupLink?: string;
  routeDescription: string;
}

export type LocationSaveResult =
  | { ok: true; id: string }
  | { ok: false; code: LocationSaveError };
export type LocationSaveError =
  | "name_required"
  | "pickup_required"
  | "route_required"
  | "bad_link";

export async function saveLocationAdmin(
  repo: Repository,
  input: LocationAdminInput,
): Promise<LocationSaveResult> {
  const name = input.name.trim();
  const pickupDescription = input.pickupDescription.trim();
  const routeDescription = input.routeDescription.trim();
  const pickupLink = input.pickupLink?.trim();
  if (!name) return { ok: false, code: "name_required" };
  if (!pickupDescription) return { ok: false, code: "pickup_required" };
  if (!routeDescription) return { ok: false, code: "route_required" };
  // A pickup link is optional, but if given it must be a real http(s) URL — a half-typed
  // "maps.google…" would render a dead link on the customer's confirmation.
  if (pickupLink && !/^https?:\/\/\S+$/i.test(pickupLink)) {
    return { ok: false, code: "bad_link" };
  }

  const location: Location = {
    id: asId<"LocationId">(input.id),
    name,
    pickupDescription,
    routeDescription,
    ...(pickupLink ? { pickupLink } : {}),
  };
  await repo.saveLocation(location);
  return { ok: true, id: input.id };
}
