/**
 * Vessel admin upsert (task 12.9) — the validated write door behind the Vessel settings
 * screen. Mirrors the `addTimeOff` idiom: pure-ish domain function, framework-free, returns a
 * discriminated `{ ok }` result so the server action can map a failure `code` to copy.
 *
 * Scope is the boat's own facts the operator sets here: name, capacity (`coiMaxPax`), identity
 * hue (DEC-086), home Location, and internal notes. Crew-engine config NOT on this screen —
 * `manning` (the seat rule) — is **preserved** across an edit, never clobbered: the form
 * doesn't carry it, so we read the existing row and keep it. (The included-guest count moved
 * to the Offering in 12.8 — pricing is a product fact, not a boat fact.) A brand-new vessel
 * starts with empty manning (its seat rule is set by the crew-engine tooling, not this
 * catalog screen).
 */
import type { Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

/** Palette size (DEC-086) — the stored hue is a 1-based index into `--color-vessel-N`. */
export const VESSEL_HUE_MAX = 6;

export interface VesselAdminInput {
  /** The vessel id — the action mints a fresh one for a create, reuses it for an edit. An
   *  unknown id is simply an upsert of a new row (create), so no separate create/edit flag. */
  id: string;
  name: string;
  coiMaxPax: number;
  hue?: number;
  homeLocationId?: string;
  notes?: string;
}

export type VesselSaveResult = { ok: true; id: string } | { ok: false; code: VesselSaveError };
export type VesselSaveError =
  | "name_required"
  | "bad_capacity"
  | "bad_hue"
  | "bad_location";

export async function saveVesselAdmin(
  repo: Repository,
  input: VesselAdminInput,
): Promise<VesselSaveResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, code: "name_required" };
  if (!Number.isInteger(input.coiMaxPax) || input.coiMaxPax < 1 || input.coiMaxPax > 99) {
    return { ok: false, code: "bad_capacity" };
  }
  if (
    input.hue !== undefined &&
    (!Number.isInteger(input.hue) || input.hue < 1 || input.hue > VESSEL_HUE_MAX)
  ) {
    return { ok: false, code: "bad_hue" };
  }
  if (input.homeLocationId) {
    const loc = await repo.getLocation(asId<"LocationId">(input.homeLocationId));
    if (!loc) return { ok: false, code: "bad_location" };
  }

  const id = asId<"VesselId">(input.id);
  // Preserve the crew-engine field this screen doesn't own (the manning seat rule) — read
  // the existing row and carry it; a new vessel gets the empty default.
  const existing = await repo.getVessel(id);
  const notes = input.notes?.trim();

  const vessel: Vessel = {
    id,
    name,
    coiMaxPax: input.coiMaxPax,
    ...(input.hue !== undefined ? { hue: input.hue } : {}),
    ...(input.homeLocationId
      ? { homeLocationId: asId<"LocationId">(input.homeLocationId) }
      : {}),
    ...(notes ? { notes } : {}),
    manning: existing?.manning ?? [],
  };
  await repo.saveVessel(vessel);
  return { ok: true, id: input.id };
}
