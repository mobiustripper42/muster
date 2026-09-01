/**
 * Vessel admin upsert (task 12.9) — the validated write door behind the Vessel settings
 * screen. Mirrors the `addTimeOff` idiom: pure-ish domain function, framework-free, returns a
 * discriminated `{ ok }` result so the server action can map a failure `code` to copy.
 *
 * Scope is the boat's own facts the operator sets here: name, capacity (`coiMaxPax`), identity
 * hue (DEC-086), home Location, internal notes, and — since #861 — `manning`, the required
 * crew. (The included-guest count moved to the Offering in 12.8 — pricing is a product fact,
 * not a boat fact.)
 *
 * **`manning` used to be excluded from this screen on purpose, and that was the bug.** The
 * reasoning was that a seat rule is crew-engine config rather than a catalog fact, so the form
 * did not carry it and a new vessel was born with an empty one, to be filled in by tooling. That
 * tooling is a pair of withdrawn stubs that redirect (`admin/shift/[shiftId]/actions.ts`), and
 * `seedFleet` only ever writes the boats in `RESOURCE_MAP` — so a boat added here could not be
 * given a crew rule by any means short of editing TypeScript.
 *
 * The consequence was silent: `deriveSeats` iterates `manning`, so an empty rule derives no
 * seats, no ask fires, the At-Risk board finds no gap and drops the row, and `claimableSeatsFor`
 * excludes it. Since #582 it is no longer silent — an empty required-seat set throws — which
 * turns the same mistake into a broken shifts board. Either way the fix is the same: a boat
 * cannot be saved without saying who has to be aboard to sail it.
 */
import type { ManningRequirement, Vessel } from "../domain/entities.js";
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
  /**
   * Who has to be aboard to sail it — one entry per role, with how many of them (#861).
   *
   * **Required, and the screen must not let it be empty.** Optional here only so the type
   * mirrors the form's absent field rather than pretending a missing one is `[]`; both are
   * refused below, and refusing them is the whole point of the change.
   */
  manning?: ManningRequirement[];
}

export type VesselSaveResult = { ok: true; id: string } | { ok: false; code: VesselSaveError };
export type VesselSaveError =
  | "name_required"
  | "bad_capacity"
  | "bad_hue"
  | "bad_location"
  | "crew_required"
  | "bad_crew_count"
  | "unknown_role";

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

  const manning = input.manning ?? [];
  if (manning.length === 0) return { ok: false, code: "crew_required" };
  if (manning.some((m) => !Number.isInteger(m.count) || m.count < 1)) {
    return { ok: false, code: "bad_crew_count" };
  }
  // The role must exist, checked the same way the Location is a few lines up. A picker cannot
  // offer an unknown role, but the posted body is whatever the client sent — and a manning entry
  // naming a role with no row would derive a seat nothing can ever fill, which reads on the board
  // as a boat perpetually short of crew.
  const roleIds = new Set((await repo.listAllRoleTypes()).map((r) => String(r.id)));
  if (manning.some((m) => !roleIds.has(String(m.roleTypeId)))) {
    return { ok: false, code: "unknown_role" };
  }

  const id = asId<"VesselId">(input.id);
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
    manning,
  };
  await repo.saveVessel(vessel);
  return { ok: true, id: input.id };
}
