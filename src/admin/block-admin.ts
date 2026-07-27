/**
 * Block admin write door (task 12.10, DEC-125) — the validated create/lift behind the
 * /admin/blocks registry. Same `{ ok }`-result idiom as `saveVesselAdmin`/`saveLocationAdmin`:
 * framework-free, string-union error codes the server action maps to copy.
 *
 * A block is an availability SUBTRACTION (DEC-125), not a per-event flag. Only the two
 * **scoped** kinds are creatable on this surface — `location` (a date + HH:MM window) and
 * `vessel` (an out-of-service date range). The single-slot `vesselHold` is made on the
 * calendar (#464) where the operator is looking at the slot; it shows here read-only, so it is
 * deliberately NOT accepted by this door (`bad_kind`).
 *
 * Blocks DO delete — "Lift" restores availability, reversible-in-spirit (DEC-125). So unlike
 * the other catalog admins, this one ships a real `removeBlockAdmin`.
 *
 * Dates/times are text (DEC-DATA-1), so integrity lives HERE: ISO day, ordered date range,
 * HH:MM window with start ≤ end, and the referenced location/vessel must exist.
 */
import type { Block } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { BlockId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar day, not just the shape — "2026-02-31" must fail (DEC-DATA-1). */
function isIsoDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface BlockAdminInput {
  /** The block id — the action mints a fresh one for a create, reuses it for an edit. */
  id: string;
  /** Only `location` and `vessel` are creatable here; `vesselHold` is a calendar concern. */
  kind: string;
  // ── location kind ──
  locationId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  // ── vessel kind ──
  vesselId?: string;
  startDate?: string;
  endDate?: string;
  // ── both ──
  note?: string;
}

export type BlockSaveResult = { ok: true; id: string } | { ok: false; code: BlockSaveError };
export type BlockSaveError =
  | "bad_kind"
  | "bad_location"
  | "bad_date"
  | "bad_window"
  | "bad_vessel"
  | "bad_range";

export async function saveBlockAdmin(
  repo: Repository,
  input: BlockAdminInput,
): Promise<BlockSaveResult> {
  const note = input.note?.trim();
  const id = asId<"BlockId">(input.id);

  if (input.kind === "location") {
    const locationId = (input.locationId ?? "").trim();
    if (!locationId || !(await repo.getLocation(asId<"LocationId">(locationId)))) {
      return { ok: false, code: "bad_location" };
    }
    const date = (input.date ?? "").trim();
    if (!isIsoDay(date)) return { ok: false, code: "bad_date" };
    const startTime = (input.startTime ?? "").trim();
    const endTime = (input.endTime ?? "").trim();
    if (!CLOCK.test(startTime) || !CLOCK.test(endTime) || startTime > endTime) {
      return { ok: false, code: "bad_window" };
    }
    const block: Block = {
      id,
      kind: "location",
      locationId: asId<"LocationId">(locationId),
      date,
      startTime,
      endTime,
      ...(note ? { note } : {}),
    };
    await repo.saveBlock(block);
    return { ok: true, id: input.id };
  }

  if (input.kind === "vessel") {
    const vesselId = (input.vesselId ?? "").trim();
    if (!vesselId || !(await repo.getVessel(asId<"VesselId">(vesselId)))) {
      return { ok: false, code: "bad_vessel" };
    }
    const startDate = (input.startDate ?? "").trim();
    const endDate = (input.endDate ?? "").trim();
    if (!isIsoDay(startDate) || !isIsoDay(endDate) || startDate > endDate) {
      return { ok: false, code: "bad_range" };
    }
    const block: Block = {
      id,
      kind: "vessel",
      vesselId: asId<"VesselId">(vesselId),
      startDate,
      endDate,
      ...(note ? { note } : {}),
    };
    await repo.saveBlock(block);
    return { ok: true, id: input.id };
  }

  // vesselHold (calendar-made) or anything else — not creatable on this surface.
  return { ok: false, code: "bad_kind" };
}

/**
 * Lift a block — a real delete (DEC-125: reversible-in-spirit, the slots come back). Returns
 * `not_found` if the id is already gone so the caller can distinguish a stale link from a
 * successful lift (the port's `removeBlock` is a silent idempotent no-op, which can't).
 */
export async function removeBlockAdmin(
  repo: Repository,
  id: string,
): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  const blockId = asId<"BlockId">(id) as BlockId;
  const exists = (await repo.listBlocks()).some((b) => String(b.id) === String(blockId));
  if (!exists) return { ok: false, code: "not_found" };
  await repo.removeBlock(blockId);
  return { ok: true };
}
