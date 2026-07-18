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
  PriceVariation,
  Reservation,
  Vessel,
} from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { EventId, OfferingId, VesselId } from "../domain/ids.js";

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
function isActiveMusterClaim(r: Reservation): boolean {
  return r.source === "muster" && r.status === "booked";
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
//   open slots = schedule × vessels × dates × muster-owned-days − blocks − bookings
//
// It is PURE — feed it the offerings/vessels/blocks/ownedDays + the already-materialized
// events/reservations, and it returns one `VirtualSlot` per enumerated departure. The
// P11 `deriveAvailability`/`canBook` above are UNTOUCHED (they still serve the seeded-Event
// path); this supersedes the browse path when 12.8 repoints the calendar at it.

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
  status: "available" | "booked" | "blocked";
  /** Set when a materialized `Event` backs this slot (an override or a booking). */
  eventId?: EventId;
}

export interface DeriveVirtualAvailabilityInput {
  offerings: readonly Offering[];
  vessels: readonly Vessel[];
  /** Inclusive ISO-8601 window to compute over. */
  dateRange: { start: string; end: string };
  ownedDays: readonly { vesselId: VesselId; date: string }[];
  blocks: readonly Block[];
  /** Already-materialized events — overrides + bookings overlay their virtual slots. */
  events: readonly Event[];
  reservations: readonly Reservation[];
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

/** First-match price resolution (DEC-125): walk the ordered variations, stop at the
 *  first that matches, apply its adjustment to the base; no match ⇒ the base. */
function resolveBasePrice(offering: Offering, date: string): number {
  const hit = offering.priceVariations.find((v) => variationMatches(v, date));
  if (!hit) return offering.basePriceCents;
  return hit.adjustment.kind === "flatCents"
    ? offering.basePriceCents + hit.adjustment.deltaCents
    : Math.round(offering.basePriceCents * (1 + hit.adjustment.percent / 100));
}

/**
 * Compute every virtual departure across the window (DEC-125). Precedence, in order:
 *  1. Only `live` offerings publish a rule (draft/hidden emit nothing).
 *  2. **Owned-day mask** — a slot is emitted only where `(vessel, date)` is Muster-owned
 *     (`× muster-owned-days`); never re-list a Xola-owned boat-day. *(Pilot-coexistence
 *     term; post-DEC-126 cutover the mask is the whole calendar — that generalization is
 *     a later flag, not built here.)*
 *  3. **Materialized `Event` wins its slot identity** — an override recomputes time/price/
 *     capacity from the Event; a booked slot is frozen `booked`. Committed state beats
 *     blocks (you can't block away a booking).
 *  4. **Blocks subtract virtual (unmaterialized) slots** → `blocked`.
 *  5. Everything surviving is `available`.
 *
 * Grid-driven: slots are enumerated from the schedule and materialized events overlay
 * matching identities. A materialized event that has been moved OFF the schedule grid
 * (a time-change override) is out of this formula — the calendar reads such events
 * directly; the per-departure move UI is 12.8/12.11.
 */
export function deriveVirtualAvailability(
  input: DeriveVirtualAvailabilityInput,
): VirtualSlot[] {
  const { offerings, vessels, dateRange, ownedDays, blocks, events, reservations } =
    input;

  const vesselById = new Map(vessels.map((v) => [String(v.id), v]));
  const owned = new Set(ownedDays.map((o) => `${String(o.vesselId)}|${o.date}`));

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

  // Block indexes.
  const locationBlocks = blocks.filter((b) => b.kind === "location");
  const vesselBlocks = blocks.filter((b) => b.kind === "vessel");
  const vesselHolds = new Set(
    blocks
      .filter((b) => b.kind === "vesselHold")
      .map((b) =>
        b.kind === "vesselHold" ? slotIdentity(b.vesselId, b.date, b.time) : "",
      ),
  );

  const isBlocked = (
    locationId: string,
    vesselId: VesselId,
    date: string,
    time: string,
  ): boolean => {
    if (vesselHolds.has(slotIdentity(vesselId, date, time))) return true;
    if (
      vesselBlocks.some(
        (b) =>
          b.kind === "vessel" &&
          String(b.vesselId) === String(vesselId) &&
          b.startDate <= date &&
          date <= b.endDate,
      )
    ) {
      return true;
    }
    return locationBlocks.some(
      (b) =>
        b.kind === "location" &&
        String(b.locationId) === locationId &&
        b.date === date &&
        b.startTime <= time &&
        time <= b.endTime,
    );
  };

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
        if (!owned.has(`${String(vesselId)}|${date}`)) continue; // owned-day mask
        for (const time of schedule.departureTimes) {
          const materialized = eventBySlot.get(slotIdentity(vesselId, date, time));
          if (materialized) {
            const booked = bookedEventIds.has(String(materialized.id));
            slots.push({
              offeringId: offering.id,
              vesselId,
              date,
              time,
              capacity: materialized.capacity,
              priceCents: materialized.price ?? basePrice,
              status: booked ? "booked" : "available",
              eventId: materialized.id,
            });
            continue;
          }
          const blocked = isBlocked(String(offering.locationId), vesselId, date, time);
          slots.push({
            offeringId: offering.id,
            vesselId,
            date,
            time,
            capacity: vessel.coiMaxPax,
            priceCents: basePrice,
            status: blocked ? "blocked" : "available",
          });
        }
      }
    }
  }
  return slots;
}
