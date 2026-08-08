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
 * The hold's own door is `saveVesselHoldAdmin` / `releaseVesselHoldAdmin` below (#703). Two doors
 * rather than a `kind` case in one, so the split survives contact with a hand-posted form: the
 * blocks action passes raw FormData through, so widening `saveBlockAdmin` to accept `vesselHold`
 * would make the registry able to mint one after all — the exact thing `bad_kind` exists to stop.
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
export type BlockRemoveError = "not_found";
export type BlockRemoveResult = { ok: true } | { ok: false; code: BlockRemoveError };

export async function removeBlockAdmin(
  repo: Repository,
  id: string,
): Promise<BlockRemoveResult> {
  const blockId = asId<"BlockId">(id) as BlockId;
  const exists = (await repo.listBlocks()).some((b) => String(b.id) === String(blockId));
  if (!exists) return { ok: false, code: "not_found" };
  await repo.removeBlock(blockId);
  return { ok: true };
}

export interface VesselHoldInput {
  /** Minted by the caller, as with `saveBlockAdmin` — the calendar never edits a hold in place. */
  id: string;
  vesselId: string;
  /** ISO-8601 day. */
  date: string;
  /** The single departure held, "HH:MM". */
  time: string;
}

export type VesselHoldSaveResult = { ok: true; id: string } | { ok: false; code: VesselHoldSaveError };
export type VesselHoldSaveError =
  | "bad_vessel"
  | "bad_date"
  | "bad_time"
  | "already_held"
  | "slot_taken";

/**
 * Take ONE departure off the market from the calendar (#703) — the write behind clicking an
 * open slot. Produces the same `Block{kind:"vesselHold"}` row the registry already renders
 * read-only, so there is one hold concept and one list of them.
 *
 * The hold is **physical** — boat, day, time. Several offerings can propose that one boat-time
 * (Brew 3 is sold by two), so this removes all of them at once; the calendar's confirm step is
 * where that scope is said out loud, because it is not visible in the row this writes.
 *
 * Two staleness guards, both because the confirm step is a separate request that can sit open:
 *  - `already_held` — a hold is already on the slot. Writing a second row would show the
 *    operator one blackout and the registry two, and lifting one would not restore the slot.
 *  - `slot_taken` — a scheduled `Event` occupies the exact slot. DEC-125: committed state beats
 *    blocks, so the hold loses rather than drawing a blackout over a sold trip. Checked on the
 *    EXACT slot, not overlap: a hold subtracts one enumerable departure, so a neighbouring trip
 *    running long is not this row's business (that is `hull-busy.ts`, on the sell path).
 * Neither is a race-proof guarantee — nothing here is transactional — but a hold subtracts
 * availability rather than committing money, and the sell path has its own CAS (DEC-109/#691).
 */
export async function saveVesselHoldAdmin(
  repo: Repository,
  input: VesselHoldInput,
): Promise<VesselHoldSaveResult> {
  const vesselId = (input.vesselId ?? "").trim();
  if (!vesselId || !(await repo.getVessel(asId<"VesselId">(vesselId)))) {
    return { ok: false, code: "bad_vessel" };
  }
  const date = (input.date ?? "").trim();
  if (!isIsoDay(date)) return { ok: false, code: "bad_date" };
  const time = (input.time ?? "").trim();
  if (!CLOCK.test(time)) return { ok: false, code: "bad_time" };

  const held = (await repo.listBlocks()).some(
    (b) =>
      b.kind === "vesselHold" &&
      String(b.vesselId) === vesselId &&
      b.date === date &&
      b.time === time,
  );
  if (held) return { ok: false, code: "already_held" };

  const occupied = (await repo.listEvents()).some(
    (e) =>
      e.status === "scheduled" &&
      String(e.vesselId) === vesselId &&
      e.date === date &&
      e.time === time,
  );
  if (occupied) return { ok: false, code: "slot_taken" };

  const block: Block = {
    id: asId<"BlockId">(input.id),
    kind: "vesselHold",
    vesselId: asId<"VesselId">(vesselId),
    date,
    time,
  };
  await repo.saveBlock(block);
  return { ok: true, id: input.id };
}

export type VesselHoldReleaseError = "not_found" | "not_a_hold";
export type VesselHoldReleaseResult = { ok: true } | { ok: false; code: VesselHoldReleaseError };

/**
 * Put a held departure back on sale (#703) — the calendar's half of "Lift", scoped to holds.
 *
 * `not_a_hold` is why this is not just `removeBlockAdmin`: the calendar only ever renders a
 * release affordance on a slot a `vesselHold` backs, so a request naming a `location` or
 * `vessel` block arrived by hand. Deleting a whole out-of-service date range from a surface
 * that never showed it is the damage worth refusing, and the registry is where those are lifted.
 */
export async function releaseVesselHoldAdmin(
  repo: Repository,
  id: string,
): Promise<VesselHoldReleaseResult> {
  const blockId = asId<"BlockId">(id) as BlockId;
  const found = (await repo.listBlocks()).find((b) => String(b.id) === String(blockId));
  if (!found) return { ok: false, code: "not_found" };
  if (found.kind !== "vesselHold") return { ok: false, code: "not_a_hold" };
  await repo.removeBlock(blockId);
  return { ok: true };
}
