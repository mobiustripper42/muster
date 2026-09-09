/**
 * Departure claim orchestration (Phase 12.1a, DEC-109 amended; 14.7) — the customer never
 * picks a boat. They pick **offering + time + guest count**; a departure fans out to a
 * SET of same-time boat-`Event`s, and **boat assignment happens here**: enumerate the
 * departure's fitting boats → try to write the pending row on the first free one → on
 * contention fall back to the next → else sold-out.
 *
 * **The pending row IS the claim (14.7).** Until this phase there were two of them: a transient
 * `checkout_holds` row taken here, and the `pending` reservation written moments later at
 * `/book/checkout`. Both occupied the same hull for the same 15 minutes, both had to be expired
 * lazily by the same rule, and both had to agree — a second occupancy table whose only job was to
 * say what the first one already said. SPEC §2.8.2 names one row, so the hold table is gone and
 * this function writes the pending row itself.
 *
 * **What that bought, beyond one fewer table.** The write is now the contention point, so a lost
 * write **falls through to the next boat** instead of reporting sold-out. Before, the hold decided
 * the boat and the pending write was a separate all-or-nothing step at the caller: a race lost at
 * that write reported `sold_out` on a departure with a free hull sitting next to it.
 *
 * This is still the OPTIMISTIC front-door and still not the authority — the whole-boat mutex
 * (`bookPendingIfHullFree`) is the backstop at confirm (DEC-109).
 *
 * **What that backstop actually guarantees (#691).** It used to be called "defeat-proof", and
 * it was — for two buyers of the SAME slot identity. Two buyers of the same boat at 13:30 and
 * 14:00 are two different identities: the unique index never fired, the reservation guard is
 * keyed on `event_id`, and both bookings succeeded silently. It now serializes the hull-day and
 * rejects any overlapping trip, which is what makes the word defensible.
 */
import type {
  Block,
  Offering,
  Reservation,
  Vessel,
} from "../domain/entities.js";
import { zonedWallClockToInstant } from "../config/tenant.js";
import type { OfferingId, VesselId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { isActiveMusterClaim, isOnScheduleGrid, isSlotBlocked, slotIdentity } from "./availability.js";
import { busyIntervalsFor, candidateHoldMinutes, hullIsBusy, minutesOfDay, pendingIntervalsFor } from "./hull-busy.js";
import { isLivePending, pendingLiveSince } from "./pending.js";

// The payment window and its env override live in `pending.ts` — the deriver needs the same
// number and importing it from here would cycle (claim → availability → claim). Re-exported so
// every existing reader keeps its import.
export { HOLD_MINUTES, HOLD_MINUTES_DEFAULT, resolveHoldMinutes } from "./pending.js";

/**
 * The departure's fitting boats, in claim order — PURE. Filters `offering.vesselIds` to
 * boats that (a) exist, (b) fit the guest count (`coiMaxPax >= guestCount`), (c) aren't
 * operator-blocked at this slot (DEC-125). Ordered
 * **smallest-that-fits, tie-break by vesselId** (DEC-109 build ruling — preserve big hulls
 * for big parties; deterministic for the contract test). Does NOT consider bookings/pending rows
 * — that dynamic state is layered by `claimDepartureSlot` (booked skip) + the write CAS.
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

export interface DepartureClaimRequest {
  offeringId: OfferingId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  /**
   * The checkout session's holder token (#575) — proof of possession, from the cookie.
   *
   * Absent ⇒ pre-#575 behaviour: always a fresh row, never reuse. NOT the buyer's identity: see
   * `holder-token.ts` for why keying this on an email was a hold hijack.
   */
  holderToken?: string | undefined;
}

/**
 * Builds the pending row this claim will write, for a boat the claim has chosen.
 *
 * Called by `claimDepartureSlot` once per candidate it is willing to try, because the row's money
 * depends on which hull was picked — an override `Event` prices one boat's departure and not
 * another's. Everything about pricing stays at the caller (`create-departure-payment-intent.ts`);
 * everything about *which boat* stays here.
 *
 * `prior` is the session's existing live pending row on a retry, or null on a first attempt. A
 * builder MUST carry `prior.id` and `prior.reservedAt` through (§2.8.5, §2.8.7: one row for life,
 * and a resubmit never moves the payment window forward) and is free to re-freeze everything else
 * — a changed tip reprices. `at` is the claim's clock, so the row's timestamps and the liveness
 * decisions made around it cannot disagree.
 */
export type PendingRowBuilder = (
  vesselId: VesselId,
  prior: Reservation | null,
  at: string,
) => Promise<Reservation> | Reservation;

export type DepartureClaimResult =
  | { claimed: Reservation; reused: boolean }
  | { soldOut: true }
  | { unbookable: "offering_missing" | "not_live" | "invalid_guest_count" | "off_schedule" | "departed" };

/**
 * Claim the first free fitting boat of a departure by writing this checkout's pending row on it
 * (fit-and-fallback). `now` is injected (house style) for a deterministic `reservedAt`. Skips
 * boats already **booked** (a materialized active Muster claim), boats a foreign trip occupies,
 * and boats a rival's live pending row commits; the write CAS (`savePendingIfHullFree`) settles
 * anyone who slipped in between the read and the write → try the next boat. Exhausted ⇒
 * `soldOut`.
 */
export async function claimDepartureSlot(
  repo: Repository,
  req: DepartureClaimRequest,
  buildRow: PendingRowBuilder,
  now: () => string,
): Promise<DepartureClaimResult> {
  const offering = await repo.getOffering(req.offeringId);
  if (!offering) return { unbookable: "offering_missing" };
  if (offering.status !== "live") return { unbookable: "not_live" };
  if (!Number.isInteger(req.guestCount) || req.guestCount < 1) {
    return { unbookable: "invalid_guest_count" };
  }
  // The (date, time) must be a real departure this offering runs (issue #799). The engine used to
  // trust these strings verbatim, so a scripted caller could park a claim at `13:31` — a slot no
  // customer can pick, yet one whose interval overlaps the real `13:30` in the claim math while
  // the deriver keys its own reads on exact identity, locking out `13:30` invisibly. Checked
  // before any read or write: an off-grid request costs one pure predicate and touches nothing.
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

  // One clock for the whole claim: the same instant decides whether this departure has sailed,
  // which pending rows are live for the reads below, and the write CAS — so nothing can be
  // departed for one and future for another (issue #713's rule, extended to the new guard).
  const at = now();

  // The trip must not have LEFT (issue #824, criterion 1's third clause). Off-grid and
  // out-of-season shipped with #799; this half did not exist, so a departure that sailed at 10am
  // was still sellable at 2pm — and the only guard anywhere was `sp.date >= today` on `/book`,
  // which is day granularity and browse-side only, so a scripted caller was never gated at all.
  //
  // Under the pending-row model that is worse than a wasted click: the row confirms into an
  // `Event` in the past, `formShifts` picks it up, and the tick's past-trip guard skips it. The
  // trip is sold, has no crew, and never reaches the board.
  //
  // Compared as an INSTANT. `date` + `time` are a vessel-local wall clock, so the comparison
  // needs the zone: `zonedWallClockToInstant` does the two-pass DST fix, which is what makes the
  // boundary right on a spring-forward morning rather than an hour out.
  //
  // `<=` and not `<`: a departure whose instant is exactly now is casting off, and "it is leaving
  // right this second" is not a sale. Checked before any read or write, like the grid guard above
  // — a refusal this cheap should cost one comparison, not a fleet read.
  if (zonedWallClockToInstant(req.date, req.time).getTime() <= Date.parse(at)) {
    return { unbookable: "departed" };
  }
  const liveSince = pendingLiveSince(at);

  const [vessels, blocks, events, reservations] = await Promise.all([
    repo.listVessels(),
    repo.listBlocks(),
    repo.listEvents(),
    repo.listAllReservations(),
  ]);

  // Slots already sold (a materialized event carrying an active Muster claim) — skip them
  // up front; a booked boat could otherwise be re-claimed and the confirm CAS would reject +
  // refund. Wasteful, and avoidable here.
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
  // function the row freezes at write time, so the two cannot disagree.
  const holdMinutes = candidateHoldMinutes(offering);
  const startMinute = minutesOfDay(req.time);

  const candidates = candidateVessels({
    offering,
    vessels,
    date: req.date,
    time: req.time,
    guestCount: req.guestCount,
    blocks,
  });

  /** Everything the write loop refuses a boat for, asked of one vessel. Shared so the reuse path
   *  below cannot drift from the loop and hand back a boat the loop would have skipped. */
  const vesselIsAvailable = (vesselId: VesselId): boolean => {
    const ownSlot = slotIdentity(vesselId, req.date, req.time);
    if (bookedSlots.has(ownSlot)) return false;
    const others = events.filter(
      (e) => !(e.source === "muster" && slotIdentity(e.vesselId, e.date, e.time) === ownSlot),
    );
    // A LIVE PENDING ROW occupies the hull for its OWN frozen hold minutes until it lapses at the
    // payment window (§2.8.3). Since 14.7 this is the *only* occupancy the checkout funnel
    // produces — it is what the `checkout_holds` read used to add on top. The asker's own row is
    // exempt by holder token: a retry from the same checkout session must not be refused by its
    // earlier attempt.
    const pending = pendingIntervalsFor(reservations, vesselId, req.date, liveSince, {
      holderToken: req.holderToken,
    });
    return !hullIsBusy(
      [...busyIntervalsFor(others, vesselId, req.date), ...pending],
      startMinute,
      holdMinutes,
    );
  };

  // ── One checkout session, one row per departure (#575, §2.8.5) ──────────────
  // Asked before the fit-and-fallback loop runs, because the loop's whole job is finding a boat
  // this session does not yet have — and if it already has one, that search is the bug. A
  // declined card is an ordinary event: without this, retry 2 took the big boat and retry 3
  // reported sold_out on a departure nobody had paid for.
  //
  // Matched on POSSESSION of the holder token, never on the buyer's typed identity. Requires a
  // token on both sides: a tokenless row is never reused and never matches another tokenless
  // row, which is the only way this rule could sell a boat twice.
  //
  // Read out of `reservations` rather than by a targeted query, deliberately: that list is
  // already loaded for the occupancy math above and was read at `at`, so the row this returns is
  // the same row the hull check just reasoned about. A second round-trip would read a different
  // instant.
  const holderToken = req.holderToken ?? null;
  if (holderToken) {
    const mine = reservations.find(
      (r) =>
        r.source === "muster" &&
        r.holderToken === holderToken &&
        isLivePending(r, liveSince) &&
        String(r.offeringId) === String(req.offeringId) &&
        r.date === req.date &&
        r.time === req.time,
    );
    // **A reused row gets the SAME scrutiny a fresh one would.** `candidates` re-applies fit and
    // blocks; `vesselIsAvailable` re-applies booked / hull-busy. Skipping either was a real gap:
    // an operator blocking a vessel for a mechanical fault at 10:00 would otherwise hand the
    // 10:02 retry that same boat, and take payment for it — where before #575 the retry would
    // have moved hull or reported sold_out. The world can change inside a payment window.
    if (
      mine?.vesselId &&
      candidates.some((v) => String(v) === String(mine.vesselId)) &&
      vesselIsAvailable(mine.vesselId)
    ) {
      // No write here: the row already exists and already occupies the hull, so criterion 2 is
      // satisfied without touching the table. The builder re-freezes the invoice (a changed tip
      // reprices) and carries the id and reserved time through — a resubmit must not park the
      // hull by pushing its window forward (§2.8.7). The caller lands the re-freeze on the row
      // with `appendPaymentIntentToPending`, a guarded write that a concurrent confirm survives.
      return { claimed: await buildRow(mine.vesselId, mine, at), reused: true };
    }
    // A row that no longer qualifies is LEFT ALONE to lapse, never cancelled here. Releasing was
    // the second exploit `/security-review` found in the identity-keyed version: it let anyone
    // destroy a named person's claim on demand. The token makes that unreachable, but deleting is
    // still the wrong instinct on a path whose input is a raw guest count. One boat idle for the
    // rest of a payment window costs less than a destroyed checkout.
  }

  for (const vesselId of candidates) {
    // `vesselIsAvailable` is the whole read-side refusal set — booked slot, a foreign trip
    // occupying the hull, a rival's live pending row overlapping it. It lives above rather than
    // inline because the #575 reuse path has to ask exactly the same question, and two copies of
    // this would drift into a reused row being handed back on a boat the loop would have skipped.
    if (!vesselIsAvailable(vesselId)) continue;
    const row = await buildRow(vesselId, null, at);
    // The CAS, under the hull-day lock. A `lost` here is a rival who committed between the read
    // above and this write — so try the NEXT boat rather than reporting sold-out, which is what
    // the separate hold step could not do: it had already picked the hull by the time the row
    // was written, and a loss there ended the checkout with a free boat alongside.
    const written = await repo.savePendingIfHullFree(row, liveSince);
    if (written.result === "won") return { claimed: row, reused: false };
  }
  return { soldOut: true };
}
