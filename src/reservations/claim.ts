/**
 * Departure claim orchestration (Phase 12.1a, DEC-109 amended) — the customer never
 * picks a boat. They pick **offering + time + guest count**; a departure fans out to a
 * SET of same-time boat-`Event`s, and **boat assignment happens here**: enumerate the
 * departure's fitting boats → try to hold the first free one → on contention fall back
 * to the next → else sold-out.
 *
 * This is the OPTIMISTIC front-door. The hold makes the common case collision-free (the
 * second buyer never starts paying). It is NOT the authority — the whole-boat mutex
 * (`saveBookingIfSlotFree`) is the defeat-proof backstop at the write (DEC-109).
 */
import { randomUUID } from "node:crypto";
import type {
  Block,
  CheckoutHold,
  MusterOwnedVesselDay,
  Offering,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutHoldId, OfferingId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { isActiveMusterClaim, isSlotBlocked, slotIdentity } from "./availability.js";

/** The soft-hold lifetime (DEC-109). Lifted from sailbook's proven 15 min. */
export const HOLD_MINUTES = 15;

/**
 * A UNIQUE hold id per acquire attempt — NOT slot-derived. One-hold-per-slot is enforced by
 * the `checkout_holds_slot_identity` unique index, not by the id; the id must differ between
 * two buyers of the same slot so `acquireCheckoutHold` detects contention (a shared id would
 * read as an idempotent re-acquire and hand the second buyer the first's hold). Release is by
 * SLOT identity (`removeCheckoutHoldForSlot`), so the id never needs to be recomputed.
 */
export function mintHoldId(): CheckoutHoldId {
  return asId<"CheckoutHoldId">(`hold_${randomUUID()}`);
}

/** `asOf` (ISO-8601 UTC) + 15 min, as an ISO-8601 UTC string. */
export function holdExpiry(asOf: string): string {
  return new Date(Date.parse(asOf) + HOLD_MINUTES * 60_000).toISOString();
}

/**
 * The departure's fitting boats, in claim order — PURE. Filters `offering.vesselIds` to
 * boats that (a) exist, (b) fit the guest count (`coiMaxPax >= guestCount`), (c) are on a
 * Muster-owned day (DEC-106), (d) aren't operator-blocked at this slot (DEC-125). Ordered
 * **smallest-that-fits, tie-break by vesselId** (DEC-109 build ruling — preserve big hulls
 * for big parties; deterministic for the contract test). Does NOT consider bookings/holds
 * — that dynamic state is layered by `acquireDepartureHold` (booked skip) + the acquire CAS
 * (hold contention).
 */
export function candidateVessels(input: {
  offering: Offering;
  vessels: readonly Vessel[];
  date: string;
  time: string;
  guestCount: number;
  ownedDays: readonly MusterOwnedVesselDay[];
  blocks: readonly Block[];
}): VesselId[] {
  const { offering, vessels, date, time, guestCount, ownedDays, blocks } = input;
  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const owned = new Set(ownedDays.map((o) => `${String(o.vesselId)}|${o.date}`));

  return offering.vesselIds
    .map((id) => vesselById.get(String(id)))
    .filter((v): v is Vessel => v !== undefined)
    .filter((v) => v.coiMaxPax >= guestCount)
    .filter((v) => owned.has(`${String(v.id)}|${date}`))
    .filter((v) => !isSlotBlocked(blocks, String(offering.locationId), v.id, date, time))
    .sort(
      (a, b) =>
        a.coiMaxPax - b.coiMaxPax || String(a.id).localeCompare(String(b.id)),
    )
    .map((v) => v.id);
}

export interface DepartureHoldRequest {
  offeringId: OfferingId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
}

export type DepartureHoldResult =
  | { held: CheckoutHold }
  | { soldOut: true }
  | { unbookable: "offering_missing" | "not_live" | "invalid_guest_count" };

/**
 * Acquire a hold on the first free fitting boat of a departure (fit-and-fallback). `now`
 * is injected (house style) for a deterministic `createdAt`/`expiresAt`. Skips boats
 * already **booked** (a materialized active Muster claim); the acquire CAS handles boats
 * already **held** (a rival's live hold → `acquired:false` → try the next). Exhausted ⇒
 * `soldOut`.
 */
export async function acquireDepartureHold(
  repo: Repository,
  req: DepartureHoldRequest,
  now: () => string,
): Promise<DepartureHoldResult> {
  const offering = await repo.getOffering(req.offeringId);
  if (!offering) return { unbookable: "offering_missing" };
  if (offering.status !== "live") return { unbookable: "not_live" };
  if (!Number.isInteger(req.guestCount) || req.guestCount < 1) {
    return { unbookable: "invalid_guest_count" };
  }

  const [vessels, ownedDays, blocks, events, reservations] = await Promise.all([
    repo.listVessels(),
    repo.listMusterOwnedVesselDays(),
    repo.listBlocks(),
    repo.listEvents(),
    repo.listAllReservations(),
  ]);

  // Slots already sold (a materialized event carrying an active Muster claim) — skip them
  // up front; the hold table doesn't know about bookings, so without this a booked boat
  // could be re-held (the write CAS would then reject + refund — wasteful, avoidable here).
  const eventById = new Map(events.map((e) => [String(e.id), e]));
  const bookedSlots = new Set<string>();
  for (const r of reservations) {
    if (!isActiveMusterClaim(r)) continue;
    const e = eventById.get(String(r.eventId));
    if (e) bookedSlots.add(slotIdentity(e.vesselId, e.date, e.time));
  }

  const candidates = candidateVessels({
    offering,
    vessels,
    date: req.date,
    time: req.time,
    guestCount: req.guestCount,
    ownedDays,
    blocks,
  });

  const at = now();
  for (const vesselId of candidates) {
    if (bookedSlots.has(slotIdentity(vesselId, req.date, req.time))) continue;
    const hold: CheckoutHold = {
      id: mintHoldId(),
      vesselId,
      date: req.date,
      time: req.time,
      source: "muster",
      offeringId: offering.id,
      guestCount: req.guestCount,
      expiresAt: holdExpiry(at),
      createdAt: at,
    };
    const res = await repo.acquireCheckoutHold(hold);
    if (res.acquired) return { held: res.hold };
  }
  return { soldOut: true };
}
