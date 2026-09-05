/**
 * Departure claim orchestration (Phase 12.1a, DEC-109 amended) — the customer never
 * picks a boat. They pick **offering + time + guest count**; a departure fans out to a
 * SET of same-time boat-`Event`s, and **boat assignment happens here**: enumerate the
 * departure's fitting boats → try to hold the first free one → on contention fall back
 * to the next → else sold-out.
 *
 * This is the OPTIMISTIC front-door. The hold makes the common case collision-free (the
 * second buyer never starts paying). It is NOT the authority — the whole-boat mutex
 * (`saveBookingIfSlotFree`) is the backstop at the write (DEC-109).
 *
 * **What that backstop actually guarantees (#691).** It used to be called "defeat-proof", and
 * it was — for two buyers of the SAME slot identity. Two buyers of the same boat at 13:30 and
 * 14:00 are two different identities: the unique index never fired, the reservation guard is
 * keyed on `event_id`, and both bookings succeeded silently. It now serializes the hull-day and
 * rejects any overlapping trip, which is what makes the word defensible.
 */
import { randomUUID } from "node:crypto";
import type {
  Block,
  CheckoutHold,
  Offering,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { CheckoutHoldId, OfferingId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { isActiveMusterClaim, isOnScheduleGrid, isSlotBlocked, slotIdentity } from "./availability.js";
import { busyIntervalsFor, candidateHoldMinutes, hullIsBusy, minutesOfDay, pendingIntervalsFor } from "./hull-busy.js";
import { HOLD_MINUTES, pendingLiveSince } from "./pending.js";

// The hold TTL and its env override moved to `pending.ts` in 14.4 — the deriver needs the same
// number and importing it from here would cycle (claim → availability → claim). Re-exported so
// every existing reader keeps its import.
export { HOLD_MINUTES, HOLD_MINUTES_DEFAULT, resolveHoldMinutes } from "./pending.js";

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
 * boats that (a) exist, (b) fit the guest count (`coiMaxPax >= guestCount`), (c) aren't
 * operator-blocked at this slot (DEC-125). Ordered
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
  blocks: readonly Block[];
}): VesselId[] {
  const { offering, vessels, date, time, guestCount, blocks } = input;
  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));

  return offering.vesselIds
    .map((id) => vesselById.get(String(id)))
    .filter((v): v is Vessel => v !== undefined)
    .filter((v) => v.coiMaxPax >= guestCount)
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
  /**
   * The checkout session's holder token (#575) — proof of possession, from the cookie.
   *
   * Absent ⇒ pre-#575 behaviour: always mint, never reuse. NOT the buyer's identity: see
   * `holder-token.ts` for why keying this on an email was a hold hijack.
   */
  holderToken?: string | undefined;
}

export type DepartureHoldResult =
  | { held: CheckoutHold }
  | { soldOut: true }
  | { unbookable: "offering_missing" | "not_live" | "invalid_guest_count" | "off_schedule" };

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
  // The (date, time) must be a real departure this offering runs (issue #799). The engine used to
  // trust these strings verbatim, so a scripted caller could park a hold at `13:31` — a slot no
  // customer can pick, yet one whose interval overlaps the real `13:30` in the claim math while
  // the deriver keys holds on exact identity, locking out `13:30` invisibly. Checked before any
  // read or write: an off-grid request costs one pure predicate and touches nothing.
  //
  // Correct for every CURRENT caller, all of which sell the virtual grid the deriver emits. It is
  // NOT the whole rule for sell-from-calendar (12.11): an admin can MOVE a materialized Event off
  // the grid via a per-departure override, and the deriver reads such an event directly
  // (availability.ts, the time-change carve-out). When 12.11 wires that path through here, this
  // guard must also admit a slot backed by a materialized muster Event at that identity — else it
  // becomes the admin-side mirror of the very lockout it fixes for customers.
  if (!isOnScheduleGrid(offering.schedule, req.date, req.time)) {
    return { unbookable: "off_schedule" };
  }

  // One clock for the whole acquire: the same instant filters the hold read and decides hull
  // liveness below, so a row can't be live for one and dead for the other (issue #713).
  const at0 = now();

  const [vessels, blocks, events, reservations, holds] = await Promise.all([
    repo.listVessels(),
    repo.listBlocks(),
    repo.listEvents(),
    repo.listAllReservations(),
    // Live rows only — an expired hold contributes nothing here and never did. The `expiresAt`
    // check below STAYS: pruning lags, so a present-but-expired row must remain inert.
    repo.listLiveCheckoutHolds(at0),
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

  // …and boats physically occupied by ANOTHER trip over this departure — a Xola booking, or a
  // Muster one at an overlapping-but-different time (#615, #691). `bookedSlots` above only
  // catches an exact-identity Muster claim, which is what let both of those through.
  //
  // The candidate commits the hull for its HOLD minutes (SPEC §2.8.3), not its trip time: a
  // 100-minute trip with 120 hold minutes must refuse a 15:15 departure after a 13:30 one. Same
  // function the write side freezes onto the pending row, so the two cannot disagree.
  const holdMinutes = candidateHoldMinutes(offering);
  const startMinute = minutesOfDay(req.time);

  // A LIVE HOLD occupies the hull as surely as a trip does. The events check above cannot see
  // one — a hold materializes nothing — so two buyers could hold 13:30 and 14:00 on one boat,
  // both pay, and the write CAS would refund the loser. That refund is precisely what the hold
  // exists to avoid; catching it here is the whole point of the optimistic front door.
  //
  // `expiresAt > at` is the same lazy-on-read rule the deriver uses (DEC-109): an expired row is
  // inert everywhere, so a stale hold never holds a boat hostage.
  //
  // A rival hold is measured by hold minutes too (issue #825) — it used to be measured by trip
  // time, which let the 15:15 buyer through while the 13:30 one was still at checkout.
  const heldIntervals = new Map<string, { start: number; end: number }[]>();
  for (const h of holds) {
    if (h.source !== "muster" || h.expiresAt <= at0 || h.date !== req.date) continue;
    const start = minutesOfDay(h.time);
    if (!Number.isFinite(start)) continue;
    const key = String(h.vesselId);
    const list = heldIntervals.get(key) ?? [];
    list.push({ start, end: start + holdMinutes });
    heldIntervals.set(key, list);
  }

  // A LIVE PENDING ROW is the hold's successor (14.4): the customer got past the hold and is at
  // Stripe. It occupies the hull for the row's OWN frozen hold minutes, until it lapses at the
  // payment window. The asker's own row is exempt by holder token — a retry from the same
  // checkout session must not be refused by its earlier attempt.
  const liveSince = pendingLiveSince(at0);

  const candidates = candidateVessels({
    offering,
    vessels,
    date: req.date,
    time: req.time,
    guestCount: req.guestCount,
    blocks,
  });

  /** Everything the mint loop refuses a boat for, asked of one vessel. Shared so the reuse path
   *  below cannot drift from the loop and hand back a boat the loop would have skipped. */
  const vesselIsAvailable = (vesselId: VesselId): boolean => {
    if (bookedSlots.has(slotIdentity(vesselId, req.date, req.time))) return false;
    const ownSlot = slotIdentity(vesselId, req.date, req.time);
    const others = events.filter(
      (e) => !(e.source === "muster" && slotIdentity(e.vesselId, e.date, e.time) === ownSlot),
    );
    const pending = pendingIntervalsFor(reservations, vesselId, req.date, liveSince, {
      holderToken: req.holderToken,
    });
    if (hullIsBusy([...busyIntervalsFor(others, vesselId, req.date), ...pending], startMinute, holdMinutes)) {
      return false;
    }
    const rivalHolds = (heldIntervals.get(String(vesselId)) ?? []).filter(
      (h) => h.start !== startMinute,
    );
    return !hullIsBusy(rivalHolds, startMinute, holdMinutes);
  };

  // ── One checkout session, one hold per departure (#575) ────────────────────
  // Asked before the fit-and-fallback loop runs, because the loop's whole job is finding a boat
  // this session does not yet have — and if it already has one, that search is the bug. A
  // declined card is an ordinary event: without this, retry 2 took the big boat and retry 3
  // reported sold_out on a departure nobody had paid for.
  //
  // Matched on POSSESSION of the holder token, never on the buyer's typed identity. Requires a
  // token on both sides: a tokenless hold is never reused and never matches another tokenless
  // hold, which is the only way this rule could sell a boat twice.
  const holderToken = req.holderToken ?? null;
  if (holderToken) {
    const mine = holds.find(
      (h) =>
        h.source === "muster" &&
        h.holderToken === holderToken &&
        h.expiresAt > at0 &&
        String(h.offeringId) === String(req.offeringId) &&
        h.date === req.date &&
        h.time === req.time,
    );
    // **A reused hold gets the SAME scrutiny a fresh one would.** `candidates` re-applies fit and
    // blocks; `vesselIsAvailable` re-applies booked / hull-busy. Skipping either was a real gap:
    // an operator blocking a vessel for a mechanical fault at 10:00 would otherwise hand the
    // 10:02 retry that same boat, and take payment for it — where before #575 the retry would
    // have moved hull or reported sold_out. The world can change inside a 15-minute hold.
    if (
      mine &&
      candidates.some((v) => String(v) === String(mine.vesselId)) &&
      vesselIsAvailable(mine.vesselId)
    ) {
      // Returned with its ORIGINAL expiry, not a fresh one. A decline-and-retry happens inside a
      // minute, so extending buys almost nothing — and not extending closes the hole where a
      // session parks a boat indefinitely by resubmitting.
      return { held: mine };
    }
    // A hold that no longer qualifies is LEFT ALONE to expire, never released here. Releasing was
    // the second exploit `/security-review` found in the identity-keyed version: it let anyone
    // delete a named person's hold on demand. The token makes that unreachable, but deleting is
    // still the wrong instinct on a path whose input is a raw guest count. One boat idle for the
    // rest of a 15-minute window costs less than a destroyed checkout.
  }

  const at = now();
  for (const vesselId of candidates) {
    // `vesselIsAvailable` is the whole refusal set — booked slot, a foreign trip occupying the
    // hull, a rival's live hold overlapping it. It lives above rather than inline here because
    // the #575 reuse path has to ask exactly the same question, and two copies of this would
    // drift into a reused hold being handed out on a boat the mint loop would have skipped.
    if (!vesselIsAvailable(vesselId)) continue;
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
      ...(holderToken ? { holderToken } : {}),
    };
    const res = await repo.acquireCheckoutHold(hold);
    if (res.acquired) return { held: res.hold };
  }
  return { soldOut: true };
}
