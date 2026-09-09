/**
 * Customer-facing availability for Muster-native reservations (Phase 11.1; DEC-108/109
 * as amended for the whole-boat model). **Distinct from the crew-eligibility oracle**
 * (`src/oracle`) — that answers "who may crew this seat"; this answers "can a customer
 * book this boat".
 *
 * BrewBoat sells **whole-boat-private** charters, one reservationist per boat-event
 * (DEC-105, `docs/design/reservations-model.md`). So availability is a **mutex, not a
 * seat count**: an event is available iff it carries ZERO active (`booked`)
 * `source='muster'` reservations — remaining is a step function (`capacity` when
 * unclaimed, `0` when claimed), NEVER `COI max − Σ party sizes`. Party size is bounded
 * by the boat's COI cap (`Event.capacity`), checked in `canBook`.
 *
 * Only `source='muster'`, `scheduled` events are sellable through Muster — Xola events
 * keep their money in Xola (DEC-105) and never appear in this funnel. The schema stays
 * n:1 on reservations→event (multi-reservation-per-event is not precluded, DEC-109); the
 * whole-boat rule lives HERE in the predicate, not as a DB constraint.
 */
import type {
  Block,
  Event,
  Offering,
  OfferingSchedule,
  PriceVariation,
  Reservation,
  Vessel,
} from "../domain/entities.js";
import { isBooked } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { EventId, OfferingId, VesselId } from "../domain/ids.js";
import {
  XOLA_TRIP_MINUTES,
  busyIntervalsFor,
  candidateHoldMinutes,
  hullIsBusy,
  minutesOfDay,
  pendingIntervalsFor,
  type BusyInterval,
} from "./hull-busy.js";
import { zonedWallClockToInstant } from "../config/tenant.js";
import { isLivePending, pendingLiveSince } from "./pending.js";

export interface EventAvailability {
  eventId: EventId;
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock, e.g. "17:00". */
  time: string;
  /** Whole-boat COI cap — the party-size ceiling (DEC-108/109). */
  capacity: number;
  /** Per-event price in integer cents (DEC-112); absent if unpriced. */
  price?: number;
  /** Whole-boat mutex: true iff this Muster event has NO active reservation. */
  available: boolean;
}

/** Is `r` a live claim on a Muster boat-event? (booked + Muster-owned). */
export function isActiveMusterClaim(r: Reservation): boolean {
  return r.source === "muster" && isBooked(r);
}

/**
 * Availability for every sellable (Muster-owned, scheduled) event. Pure — feed it
 * `repo.listEvents()` + `repo.listAllReservations()`. The caller (the P11 harness / P12
 * page) filters to `available` for a browse-and-pick surface.
 */
export function deriveAvailability(
  events: readonly Event[],
  reservations: readonly Reservation[],
): EventAvailability[] {
  const claimed = new Set<string>();
  for (const r of reservations) {
    if (isActiveMusterClaim(r)) claimed.add(String(r.eventId));
  }
  return events
    .filter((e) => e.source === "muster" && e.status === "scheduled")
    .map((e) => ({
      eventId: e.id,
      vesselId: e.vesselId,
      date: e.date,
      time: e.time,
      capacity: e.capacity,
      ...(e.price !== undefined ? { price: e.price } : {}),
      available: !claimed.has(String(e.id)),
    }));
}

/**
 * The whole-boat claim predicate — the customer side of DEC-109. A party may book iff:
 * the event is a scheduled Muster event, the party fits the boat's COI cap
 * (`1 ≤ party ≤ capacity`), and the event is **unclaimed** by any active Muster
 * reservation. Pure + synchronous; 11.3's webhook wraps it in an atomic (CAS)
 * transaction so two simultaneous checkouts can't both win — the predicate itself never
 * mutates.
 */
export function canBook(
  event: Event,
  reservations: readonly Reservation[],
  partySize: number,
): boolean {
  if (event.source !== "muster" || event.status !== "scheduled") return false;
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > event.capacity) {
    return false;
  }
  return !reservations.some(
    (r) => String(r.eventId) === String(event.id) && isActiveMusterClaim(r),
  );
}

// ── Virtual availability read model (12.0, DEC-125) ──────────────────────────
//
// DEC-125 changed the model under `deriveAvailability`: Muster no longer writes an
// `Event` per potential departure. The `Offering` + schedule is a **rule**; open
// availability is COMPUTED on read and a row materializes only when a slot gets state.
// `deriveVirtualAvailability` is that computation:
//
//   open slots = schedule × vessels × dates − blocks − bookings
//
// It is PURE — feed it the offerings/vessels/blocks + the already-materialized
// events/reservations, and it returns one `VirtualSlot` per enumerated departure. The
// P11 `deriveAvailability`/`canBook` above are UNTOUCHED (they still serve the seeded-Event
// path); this supersedes the browse path when 12.8 repoints the calendar at it.

/**
 * Is `(date, time)` a real departure the deriver would ever emit for this schedule (issue #799)?
 *
 * The deriver generates bookable slots as `(date ∈ season ∩ weekdays) × schedule.departureTimes`
 * (see the loop below), so those four conditions ARE the grid. Anything else is a slot no
 * legitimate customer can pick — the availability screen never renders it — which is exactly why
 * the write path must reject it: an off-grid hold has no honest source and, worse, its interval
 * overlaps a real departure in the claim path while the deriver keys holds on exact identity, so
 * it locks out the real slot invisibly.
 *
 * Pure and total: a malformed or non-round-tripping date (`2026-09-31`, `not-a-date`) and a time
 * that isn't an exact member of `departureTimes` (`13:3 0`) both return false rather than throwing.
 * Date bounds compare lexically — safe because `yyyy-mm-dd` sorts chronologically.
 */
export function isOnScheduleGrid(
  schedule: OfferingSchedule,
  date: string,
  time: string,
): boolean {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  // Reject a date string that doesn't round-trip — `2026-09-31` would otherwise roll into October
  // and silently pass the weekday check for the wrong day.
  if (new Date(ms).toISOString().slice(0, 10) !== date) return false;
  if (date < schedule.seasonStart || date > schedule.seasonEnd) return false;
  if (!schedule.weekdays.includes(weekdayMon0(date))) return false;
  return schedule.departureTimes.includes(time);
}

/**
 * Has this departure already left (issue #824, criterion 1)?
 *
 * `date` + `time` are a vessel-local WALL CLOCK; `asOf` is an instant. Comparing them needs the
 * zone, and `zonedWallClockToInstant` does it with a two-pass DST fix — which is what makes the
 * boundary right on a spring-forward morning instead of an hour out.
 *
 * `<=`, not `<`: a boat casting off at this exact second is not for sale.
 *
 * **Lives here, with the other shared guards, and is imported by the write.** `claimDepartureSlot`
 * calls this same function rather than restating the expression, for the same reason it imports
 * `isOnScheduleGrid` and `isSlotBlocked`: criterion 5 says the calendar and the write refuse the
 * same set, and two copies of a rule are two things that can drift. The agreement test would
 * catch the drift, but not having the drift is better than catching it.
 */
export function hasDeparted(date: string, time: string, asOf: string): boolean {
  return zonedWallClockToInstant(date, time).getTime() <= Date.parse(asOf);
}

/** The physical boat-slot identity for a Muster event (DEC-125 guardrail). ONE Brew 3
 *  can hold exactly one departure at a given day+time — `source='muster'` is implicit
 *  (only Muster slots virtualize; Xola keeps its money in Xola, DEC-105). This is the
 *  key the deriver overlays materialized events by, AND the key 12.1's conditional insert
 *  guards on — both sides MUST agree, so it lives here, shared. */
export function slotIdentity(
  vesselId: VesselId,
  date: string,
  time: string,
): string {
  return `${String(vesselId)}|${date}|${time}`;
}

/** The DETERMINISTIC event id for a virtual slot. 12.1 mints the first booking's `Event`
 *  with this id via a conditional insert on the slot identity; the deriver matches
 *  materialized events by {@link slotIdentity}, not by id, so this is exported for 12.1
 *  + tests, not consumed by the deriver itself. */
export function eventIdForSlot(
  vesselId: VesselId,
  date: string,
  time: string,
): EventId {
  return asId<"EventId">(`slot_${slotIdentity(vesselId, date, time)}`);
}

/** A computed departure. `available` slots are sellable; `booked`/`blocked` are surfaced
 *  so the caller can grey them (the calendar shows a day dark when nothing is available). */
export interface VirtualSlot {
  offeringId: OfferingId;
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  /** Party-size ceiling — the running vessel's COI cap, or an override Event's capacity. */
  capacity: number;
  /** Resolved DISPLAY base in cents (first-match variation, or an override `Event.price`).
   *  The party fare (base + extras × extraGuestPrice + gratuity, DEC-124) is booking-time,
   *  NOT computed here. */
  priceCents: number;
  /** Five ways a slot is not sellable, and they are NOT interchangeable — the operator needs
   *  them apart even though the customer surface collapses every one of them to "not available":
   *  - `booked` — a reservation exists. The admin calendar draws it with the customer's name.
   *  - `departed` — the trip has already left (issue #824). Its own state and NOT `unavailable`,
   *    because the admin calendar counts `unavailable` as booked (`calendar-view.tsx`, the
   *    `counts` map and the status filter), so reusing it would draw a phantom sold card on every
   *    past departure. A past empty slot is neither sold, nor open, nor blocked, and the counters
   *    should count it nowhere.
   *  - `blocked` — an operator block (DEC-125), deliberate and liftable.
   *  - `held` — a live `pending` row AT THIS SLOT: somebody is at the checkout right now
   *    (§2.8.10). Distinct from `unavailable` because it clears itself in one payment window,
   *    where a foreign trip does not. It meant a `checkout_holds` row until 14.7 dropped that
   *    table; it is driven by the reservation now.
   *  - `unavailable` — the HULL is committed over this departure by something that is not this
   *    slot: another trip overlapping it (#615, #691), or a live pending row at a DIFFERENT time
   *    on the same boat (§2.8.3). Nobody bought this slot; it simply cannot run. Calling it
   *    `booked` put phantom bookings on the operator's calendar — two cards on one hull where
   *    one trip was sold. */
  status: "available" | "held" | "departed" | "booked" | "blocked" | "unavailable";
  /** Set when a materialized `Event` backs this slot (an override or a booking). */
  eventId?: EventId;
}

export interface DeriveVirtualAvailabilityInput {
  offerings: readonly Offering[];
  vessels: readonly Vessel[];
  /** Inclusive ISO-8601 window to compute over. */
  dateRange: { start: string; end: string };
  blocks: readonly Block[];
  /** Already-materialized events — overrides + bookings overlay their virtual slots. */
  events: readonly Event[];
  reservations: readonly Reservation[];
  /** ISO-8601 UTC "now" for pending-row liveness (§2.8.1). Required for a live pending row to
   *  occupy anything; if absent, none is treated as live (conservative — the write CAS still
   *  prevents oversell). A `holds` input sat beside this until 14.7; the `checkout_holds` table
   *  is gone and a customer at Stripe is a `pending` reservation, which `reservations` carries. */
  asOf?: string;
}

/**
 * A virtual slot's status, in precedence order (issue #928 — lifted out of two nested ternaries).
 *
 * `booked` first: a sale is a fact and the admin calendar draws it with the customer's name, on a
 * past trip as much as a future one. `blocked` next: an operator's deliberate blackout has to show
 * as one, and `unavailable` is hidden on the grid where nothing runs — ranking busy above it made
 * a blackout disappear from both the calendar and the Blocked count. Then `held` before
 * `occupied`, being the more specific answer to the same question. `departed` LAST, because it
 * describes an EMPTY slot that has passed, not a passed slot of any kind — anything that actually
 * happened on that hull outranks the fact that it happened in the past.
 *
 * Each caller passes only the flags its branch computed; the rest default to false. A materialized
 * slot can be `booked` and is never asked about blocks; a virtual one is the reverse.
 */
function slotStatus(f: {
  booked?: boolean;
  departed?: boolean;
  blocked?: boolean;
  held?: boolean;
  occupied?: boolean;
}): VirtualSlot["status"] {
  if (f.booked) return "booked";
  if (f.blocked) return "blocked";
  // Before `occupied`, because it is the more specific answer to "why can't I sell this": a
  // pending row AT this slot, rather than the hull being busy from somewhere else.
  if (f.held) return "held";
  if (f.occupied) return "unavailable";
  // LAST before `available`, because `departed` means "nothing was here, and it is too late now"
  // — §2.10.2's wording is "nobody bought it and nobody now can". Ranked above `occupied` it
  // swallowed real history: a XOLA charter earlier today takes the virtual branch (Xola events
  // are never in `eventBySlot`), so it drew as an inert grey "Departed" card instead of the
  // customer's name, and this morning's charters vanished off the operator's grid
  // (/security-review's non-security note). A trip that ran is still a trip that ran.
  if (f.departed) return "departed";
  return "available";
}

/** Mon=0…Sun=6 for an ISO `yyyy-mm-dd`, read at UTC midnight (DST-safe). */
function weekdayMon0(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Inclusive `yyyy-mm-dd` day list from `start` to `end`. Empty if start > end. */
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return out;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/** True iff `variation.applies` covers `date` / its weekday. */
function variationMatches(v: PriceVariation, date: string): boolean {
  const a = v.applies;
  switch (a.kind) {
    case "weekdays":
      return a.weekdays.includes(weekdayMon0(date));
    case "date":
      return a.date === date;
    case "dateRange":
      return a.start <= date && date <= a.end;
  }
}

/** Is the physical slot `(vesselId, date, time)` blocked (DEC-125)? Covers all three block
 *  kinds: a `vesselHold` on the exact slot, a `vessel` block whose date range contains
 *  `date`, or a `location` block at `locationId` on `date` whose time window contains
 *  `time`. Shared by the deriver and `candidateVessels` so both agree. */
export function isSlotBlocked(
  blocks: readonly Block[],
  locationId: string,
  vesselId: VesselId,
  date: string,
  time: string,
): boolean {
  return blocks.some((b) => {
    switch (b.kind) {
      case "vesselHold":
        return (
          String(b.vesselId) === String(vesselId) && b.date === date && b.time === time
        );
      case "vessel":
        return (
          String(b.vesselId) === String(vesselId) &&
          b.startDate <= date &&
          date <= b.endDate
        );
      case "location":
        return (
          String(b.locationId) === locationId &&
          b.date === date &&
          b.startTime <= time &&
          time <= b.endTime
        );
    }
  });
}

/** First-match price resolution (DEC-125): walk the ordered variations, stop at the
 *  first that matches, apply its adjustment to the base; no match ⇒ the base. Exported so
 *  the checkout path prices the held slot exactly as the deriver displayed it. */
export function resolveBasePrice(offering: Offering, date: string): number {
  const hit = offering.priceVariations.find((v) => variationMatches(v, date));
  if (!hit) return offering.basePriceCents;
  return hit.adjustment.kind === "flatCents"
    ? offering.basePriceCents + hit.adjustment.deltaCents
    : Math.round(offering.basePriceCents * (1 + hit.adjustment.percent / 100));
}

/**
 * Every hull-day window a LIVE pending row occupies (14.4), shaped for `busyByHullDay`. One
 * entry per row, keyed `vessel|date`, tagged `pending:<reservation id>` — a namespace no event
 * id shares. A row that names no hull or day cannot occupy one and is skipped; the write side
 * refuses to store such a row, so this is belt to that brace.
 */
function livePendingOccupancy(
  reservations: readonly Reservation[],
  asOf: string,
): { key: string; eventId: string; interval: BusyInterval }[] {
  const liveSince = pendingLiveSince(asOf);
  const out: { key: string; eventId: string; interval: BusyInterval }[] = [];
  for (const r of reservations) {
    if (r.vesselId === undefined || r.date === undefined) continue;
    const [interval] = pendingIntervalsFor([r], r.vesselId, r.date, liveSince);
    if (!interval) continue;
    out.push({ key: `${String(r.vesselId)}|${r.date}`, eventId: `pending:${String(r.id)}`, interval });
  }
  return out;
}

/**
 * Compute every virtual departure across the window (DEC-125). Precedence, in order:
 *  1. Only `live` offerings publish a rule (draft/hidden emit nothing).
 *  2. **Materialized `Event` wins its slot identity** — an override recomputes time/price/
 *     capacity from the Event; a booked slot is frozen `booked`. Committed state beats
 *     blocks (you can't block away a booking).
 *  3. **Blocks subtract virtual (unmaterialized) slots** → `blocked`. An operator block wins
 *     over a busy hull: it is a deliberate act, and the calendar hides `unavailable` slots that
 *     nothing runs at, so ranking the other way made a blackout vanish from the grid.
 *  4. A **live checkout-hold** (`expiresAt > asOf`) on a surviving slot → `held` (12.1).
 *  5. Everything surviving is `available`.
 *
 * **The offering says when; blocks say what's off. Nothing else gates (#688).** There used
 * to be an owned-day mask here — an allowlist requiring a hand-typed row per boat per date
 * before anything could be sold, added under DEC-106 for a period where Muster and Xola
 * would sell simultaneously. That period was never in the plan: Xola sells until the
 * cutover, Muster after, never both. The mask therefore gated on an operator chore that
 * protected nothing, and blanked a whole boat-day when the unit of sale is a boat at a
 * time slot.
 *
 * Grid-driven: slots are enumerated from the schedule and materialized events overlay
 * matching identities. A materialized event that has been moved OFF the schedule grid
 * (a time-change override) is out of this formula — the calendar reads such events
 * directly; the per-departure move UI is 12.8/12.11.
 */
// REFACTOR QUEUE — cognitive complexity 79, against a ceiling of 40 (#909).
// Baselined, NOT accepted: this is on the list in the tracking issue. The ceiling
// ratchets down as the list shrinks, so this disable is meant to be deleted.
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing, score 79
export function deriveVirtualAvailability(
  input: DeriveVirtualAvailabilityInput,
): VirtualSlot[] {
  const { offerings, vessels, dateRange, blocks, events, reservations } = input;

  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));

  // Materialized Muster events, indexed by physical slot identity, + which are booked.
  const bookedEventIds = new Set<string>();
  for (const r of reservations) {
    if (isActiveMusterClaim(r)) bookedEventIds.add(String(r.eventId));
  }
  const eventBySlot = new Map<string, Event>();
  for (const e of events) {
    if (e.source === "muster" && e.status === "scheduled") {
      eventBySlot.set(slotIdentity(e.vesselId, e.date, e.time), e);
    }
  }

  // Hull occupancy from EVERY scheduled event, both sources (#615, #691). Tagged with its own
  // slot identity so a materialized slot is never blocked by its own trip. This is what makes
  // the deriver see an imported Xola booking — and a Muster booking at an OVERLAPPING (not
  // identical) time, which the old slot-identity check missed entirely.
  // Tagged by EVENT ID, not slot identity: a slot must be exempt from its OWN trip, and only
  // its own. Keying on identity was wrong — it also exempted a foreign (Xola) trip sitting at
  // the same clock time, which is precisely the collision this exists to catch.
  const busyByHullDay = new Map<string, { eventId: string; interval: BusyInterval }[]>();
  for (const e of events) {
    if (e.status !== "scheduled") continue;
    const key = `${String(e.vesselId)}|${e.date}`;
    const [interval] = busyIntervalsFor([e], e.vesselId, e.date);
    if (!interval) continue;
    const list = busyByHullDay.get(key) ?? [];
    list.push({ eventId: String(e.id), interval });
    busyByHullDay.set(key, list);
  }

  // …and from every LIVE pending row (14.4, SPEC §2.8.3): a customer who got past the hold and
  // is at Stripe. The row occupies its hull for its OWN frozen hold minutes until it lapses at
  // the payment window, measured from `asOf` exactly as holds are — and, like holds, no `asOf`
  // means no row is live. Tagged under a namespace no event id can collide with, so a slot is
  // never exempted from a pending row the way it is from its own materialized trip.
  if (input.asOf !== undefined) {
    for (const { key, eventId, interval } of livePendingOccupancy(reservations, input.asOf)) {
      const list = busyByHullDay.get(key) ?? [];
      list.push({ eventId, interval });
      busyByHullDay.set(key, list);
    }
  }

  // Slots a customer is at the checkout for RIGHT NOW — a live pending row at this exact
  // identity (§2.8.10). Exact identity is right here and overlap is right for occupancy: `held`
  // answers "who is buying THIS slot", where `unavailable` answers "is this hull free", and the
  // same row supplies both — its own slot reads `held`, every other departure it overlaps reads
  // `unavailable`. No `asOf`, no live rows, same conservative rule as the occupancy math.
  const heldSlots = new Set<string>();
  if (input.asOf !== undefined) {
    const liveSince = pendingLiveSince(input.asOf);
    for (const r of reservations) {
      if (!isLivePending(r, liveSince) || !r.vesselId || !r.date || !r.time) continue;
      heldSlots.add(slotIdentity(r.vesselId, r.date, r.time));
    }
  }

  /** This day's departed check, closed over the render's clock. `undefined` asOf ⇒ nothing has
   *  departed, the same conservative rule the occupancy math gets. */
  const departedAt = (date: string, time: string): boolean =>
    input.asOf !== undefined && hasDeparted(date, time, input.asOf);

  /** Windows occupying this hull-day, minus the given event's own (pass none for a virtual slot). */
  const hullBusyExcept = (vesselId: VesselId, date: string, selfEventId?: string): BusyInterval[] =>
    (busyByHullDay.get(`${String(vesselId)}|${date}`) ?? [])
      .filter((b) => b.eventId !== selfEventId)
      .map((b) => b.interval);

  // NB: slots carry `offeringId`, so two live offerings that schedule the SAME
  // physical (vessel, date, time) each emit their own slot — a scheduling error the
  // deriver does not resolve. 12.1's slot-identity uniqueness (the conditional insert /
  // partial unique index) is what stops both from materializing-and-selling that one
  // boat; catching the overlap at authoring time is a 12.8 catalog concern.
  const slots: VirtualSlot[] = [];
  for (const offering of offerings) {
    if (offering.status !== "live") continue;
    const { schedule } = offering;
    // Effective days = dateRange ∩ season, filtered to the schedule's weekdays.
    const from = dateRange.start > schedule.seasonStart ? dateRange.start : schedule.seasonStart;
    const to = dateRange.end < schedule.seasonEnd ? dateRange.end : schedule.seasonEnd;
    for (const date of eachDay(from, to)) {
      if (!schedule.weekdays.includes(weekdayMon0(date))) continue;
      const basePrice = resolveBasePrice(offering, date);
      for (const vesselId of offering.vesselIds) {
        const vessel = vesselById.get(String(vesselId));
        if (!vessel) continue; // unknown vessel — nothing to price/cap against
        for (const time of schedule.departureTimes) {
          const materialized = eventBySlot.get(slotIdentity(vesselId, date, time));
          if (materialized) {
            // An unbooked override still can't sail if another trip holds the hull over it.
            const collides = hullIsBusy(
              hullBusyExcept(vesselId, date, String(materialized.id)),
              minutesOfDay(time),
              materialized.durationMinutes ?? offering.tripLengthMinutes ?? XOLA_TRIP_MINUTES,
            );
            const booked = bookedEventIds.has(String(materialized.id));
            slots.push({
              offeringId: offering.id,
              vesselId,
              date,
              time,
              capacity: materialized.capacity,
              priceCents: materialized.price ?? basePrice,
              status: slotStatus({
                booked,
                departed: departedAt(date, time),
                held: heldSlots.has(slotIdentity(vesselId, date, time)),
                occupied: collides,
              }),
              eventId: materialized.id,
            });
            continue;
          }
          const identity = slotIdentity(vesselId, date, time);
          // No Muster event backs this identity (the materialized branch returned above), so
          // every window here belongs to another trip.
          // Measured by the offering's HOLD minutes, not its trip time (SPEC §2.8.3, "same rule
          // both sides"): what this slot would commit the hull for if sold is what it must be
          // clear for. The same function freezes the value onto the pending row at checkout.
          const occupied = hullIsBusy(
            hullBusyExcept(vesselId, date),
            minutesOfDay(time),
            candidateHoldMinutes(offering),
          );
          // BLOCK outranks a busy hull. A block is a deliberate operator act and the calendar
          // has to show it; `unavailable` is hidden there when nothing runs at that time, so
          // ranking busy first made an operator's own blackout disappear from the grid and from
          // the Blocked count. Being unsellable twice over is still blocked.
          const blocked = isSlotBlocked(blocks, String(offering.locationId), vesselId, date, time);
          slots.push({
            offeringId: offering.id,
            vesselId,
            date,
            time,
            capacity: vessel.coiMaxPax,
            priceCents: basePrice,
            status: slotStatus({
              departed: departedAt(date, time),
              blocked,
              held: heldSlots.has(identity),
              occupied,
            }),
          });
        }
      }
    }
  }
  return slots;
}
