/**
 * Map + Reconcile: normalized records → Events + Reservations (DEC-015 / DEC-043).
 *
 * The Land adapter (`xola-client.ts`) hands `RawReservationRecord[]` to
 * `importRecords`, already normalized: the real Xola `event.id`, the resolved
 * `vesselId`, and an ISO date + clock-time. Reconcile is keyed on the stable Xola
 * `items[].id` (reservation) and the real `event.id` (its event), so re-import
 * updates in place rather than duplicating.
 */

import type { Event, Reservation, ReservationStatus } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { VesselId } from "../domain/ids.js";
import { assertOptionalIsoDateTime } from "../domain/iso-date.js";
import { resolveCustomerId } from "../customers/resolve.js";
import type { Repository } from "../ports/repository.js";
import { vesselCapacity, vesselTripLength } from "./resource-map.js";

export interface SkippedRow {
  reservationId?: string;
  product?: string;
  /** Vessel-local trip date "YYYY-MM-DD" (#320) — so a skip says WHICH trip got
   *  dropped, not just an opaque event id. Absent on non-reservation skips
   *  (e.g. an unmapped boat resource, which has only a `reason`). */
  date?: string;
  /** Vessel-local departure clock "HH:mm" (#320). */
  time?: string;
  /** Tags a categorized skip so the pull can distinguish it from the benign
   *  malformed / out-of-window drops: `booked_no_boat` (#338 — a booked trip has no
   *  boat; assign one in Xola + re-import). */
  category?: "booked_no_boat";
  reason: string;
}

/**
 * The seam between Land and Map (DEC-015 / DEC-043). A normalized reservation
 * record: the Land adapter (`xola-client.ts`) resolves the boat + slices the
 * vessel-local date/time before this point, so `importRecords` never re-parses a
 * Xola string. `product` stays a raw name (display only — the vessel comes from
 * `vesselId`, not the product).
 */
export interface RawReservationRecord {
  reservationId: string;
  product: string;
  /** ISO date (vessel-local day), e.g. "2026-05-16". Sliced + validated Land-side. */
  date: string;
  /** Clock time, e.g. "15:30". Sliced + validated Land-side. */
  time: string;
  /**
   * The real Xola event id (`item.event.id`) — the stable reconcile key for the
   * boat-trip (DEC-043), replacing the synthetic vessel+date+time key.
   */
  eventId?: string;
  /**
   * The boat this trip runs on, resolved Land-side from the event's Xola Resource
   * (DEC-043). Set on BOOKED records (their event is boated); ABSENT on cancelled
   * records — a cancelled trip de-boats, so it reconciles against its already-stored
   * event instead of re-resolving a boat.
   */
  vesselId?: VesselId;
  customerName: string;
  email?: string;
  /**
   * Customer phone, inline from the API adapter (`order.phoneCanonical`/`phone`,
   * DEC-036). Excluded from materiality (a phone correction isn't shift-material),
   * so it populates without crying wolf on a locked shift.
   */
  phone?: string;
  partySize: number;
  /**
   * Xola only ever hands us a sold or a cancelled booking — it has no checkout in flight
   * to report — so this is the entity union (§2.8.1) minus `pending`. Widening the entity
   * does not widen this: an import can never write a `pending` row.
   */
  status: Exclude<ReservationStatus, "pending">;
}

/** A reservation's identity in the audit detail (#128) — id + customer name, so a
 * run reads "Brody, Hooper" not just "2 added". */
export interface ReservationRef {
  id: string;
  name: string;
}

export interface ImportResult {
  /** New reservation ids this run. `added + updated` partitions all imported rows. */
  reservationsAdded: number;
  /** Re-seen reservation ids (existed before this run). */
  reservationsUpdated: number;
  /**
   * Rows that became cancelled *this run* (new-and-cancelled, or booked→cancelled)
   * — the actionable signal for the 11pm call, distinct from still-cancelled.
   */
  reservationsNewlyCancelled: number;
  /** Distinct events not previously present (created, not merely re-saved). */
  eventsCreated: number;
  /** Non-fatal issues surfaced rather than swallowed (DEC-015). */
  warnings: string[];
  skipped: SkippedRow[];
  /** Identity behind the counts (#128) — same rows, named. `added.length` etc.
   * equals the matching count; kept alongside so existing count readers don't churn. */
  added: ReservationRef[];
  updated: ReservationRef[];
  newlyCancelled: ReservationRef[];
}

/**
 * Whether a re-imported reservation differs from the stored one in any field the
 * operator would want flagged (DEC-029). Drives the `updatedAt` stamp: equal →
 * preserve the old timestamp so a blind re-import doesn't make every locked shift
 * cry wolf. `phone` is excluded — it isn't a shift-material edit.
 */
function reservationMateriallyChanged(prev: Reservation, next: Reservation): boolean {
  return (
    prev.eventId !== next.eventId ||
    prev.customerName !== next.customerName ||
    prev.partySize !== next.partySize ||
    prev.status !== next.status ||
    (prev.email ?? "") !== (next.email ?? "")
  );
}

/**
 * Per-event accumulator, keyed by the real Xola event id. The vessel comes from a
 * booked record; a fully-cancelled trip de-boats and carries none, so it's optional
 * and falls back to the stored event at upsert. `status` derives from booked-ness.
 */
interface PendingEvent {
  vesselId?: VesselId;
  date: string;
  time: string;
  /** True once any non-cancelled reservation maps to this event. */
  anyBooked: boolean;
}

/**
 * MAP + RECONCILE: persist records as Events + Reservations (DEC-015 / DEC-043).
 * Idempotent on the stable Xola `items[].id` (reservation) and the real
 * `item.event.id` (event). `now` is injected (the import stamps `updatedAt`; the
 * core never reads the clock).
 *
 * The event keys on the **real Xola event id** (DEC-043) — so four boats at the
 * same slot are four events (the DEC-016 collapse is gone), and Drew reassigning a
 * boat reconciles *in place* (same id, new vessel) rather than orphan+create. The
 * vessel is resolved Land-side (`rec.vesselId`); a cancelled trip de-boats and
 * carries none, so it falls back to the already-stored event's vessel.
 *
 * An event's `status` is **derived**: ≥1 booked reservation → `scheduled`; every
 * reservation cancelled → `cancelled`, so the import→`formShifts` chain cancels its
 * shift instead of stranding a ghost. Cancels arrive as explicit status-700 rows
 * (not absence), so no vanish-detection is needed — out of pilot scope (DEC-037).
 */
export async function importRecords(
  repo: Repository,
  records: RawReservationRecord[],
  now: Date = new Date(),
): Promise<ImportResult> {
  const result: ImportResult = {
    reservationsAdded: 0,
    reservationsUpdated: 0,
    reservationsNewlyCancelled: 0,
    eventsCreated: 0,
    warnings: [],
    skipped: [],
    added: [],
    updated: [],
    newlyCancelled: [],
  };

  // Pass 1: group records by the real Xola event id; carry the resolved vessel
  // (from booked records) and accumulate per-event booked-ness.
  const events = new Map<string, PendingEvent>();
  const persistable: { rec: RawReservationRecord; rawEventId: string }[] = [];
  for (const rec of records) {
    const rawEventId = (rec.eventId ?? "").trim();
    if (!rawEventId) {
      result.skipped.push({
        reservationId: rec.reservationId,
        product: rec.product,
        date: rec.date,
        time: rec.time,
        reason: "record missing event id",
      });
      continue;
    }
    const booked = rec.status === "booked";
    const pe = events.get(rawEventId);
    if (pe) {
      pe.anyBooked ||= booked;
      if (rec.vesselId) pe.vesselId = rec.vesselId;
    } else {
      events.set(rawEventId, {
        date: rec.date,
        time: rec.time,
        anyBooked: booked,
        ...(rec.vesselId ? { vesselId: rec.vesselId } : {}),
      });
    }
    persistable.push({ rec, rawEventId });
  }

  // Pass 2: upsert events with derived status. The vessel comes from a booked
  // record, else the already-stored event (a fully-cancelled trip de-boats — we
  // reconcile it to `cancelled` against what we have). An event we can place
  // nowhere (never booked, no boat, not stored) is dropped with its rows.
  const placed = new Set<string>();
  for (const [rawEventId, pe] of events) {
    const eventId = asId<"EventId">(rawEventId);
    const existing = await repo.getEvent(eventId);
    const vesselId = pe.vesselId ?? existing?.vesselId;
    if (!vesselId) {
      for (const { rec } of persistable.filter((p) => p.rawEventId === rawEventId)) {
        result.skipped.push({
          reservationId: rec.reservationId,
          product: rec.product,
          date: rec.date,
          time: rec.time,
          reason: `no resolvable boat for event ${rawEventId}`,
        });
      }
      continue;
    }
    placed.add(rawEventId);
    const capacity = vesselCapacity(vesselId) ?? existing?.capacity ?? 0;
    // Trip length (DEC-041 (b)): the boat's declared length, else whatever the stored
    // event already carried. NO terminal `?? TRIP_DURATION_MINUTES` — a boat that
    // declares nothing leaves the key **omitted**, so the fallback stays a read-time
    // decision. Writing it here would freeze today's constant onto every row forever,
    // and writing `undefined` breaks the omitted-not-undefined round-trip contract.
    const duration = vesselTripLength(vesselId) ?? existing?.durationMinutes;
    const event: Event = {
      id: eventId,
      vesselId,
      date: pe.date,
      time: pe.time,
      capacity,
      status: pe.anyBooked ? "scheduled" : "cancelled",
      source: "xola", // the importer structurally only ever writes Xola-owned events (DEC-106)
      ...(duration !== undefined ? { durationMinutes: duration } : {}),
    };
    await repo.saveEvent(event);
    if (!existing) result.eventsCreated++;
  }

  // Pass 3: upsert reservations whose event got placed (materiality-guarded, DEC-029).
  for (const { rec, rawEventId } of persistable) {
    if (!placed.has(rawEventId)) continue;
    const eventId = asId<"EventId">(rawEventId);
    const internalId = asId<"ReservationId">(`resv-${rec.reservationId}`);
    const existingReservation = await repo.getReservation(internalId);

    // Customer identity (#701, DEC-132) — the same get-or-create the booking path runs, so an
    // imported guest and a Muster guest are one person. Without it every imported reservation
    // lands unlinked, which is invisible now and ruinous at the DEC-126 cutover: the whole back
    // catalogue arrives through here, and a returning guest would read as brand new.
    //
    // Phone-first, and NO name fallback — the resolver returns `undefined` for an absent or
    // uncanonicalizable phone and the row stays unlinked, permanently and by design. That is
    // the answer `db:backfill:customers` already gives for the same input; a second rule here
    // would be the one nobody tests, and matching on name alone merges two different Sarahs.
    const resolved = await resolveCustomerId(
      repo,
      {
        customerName: rec.customerName,
        ...(rec.phone !== undefined ? { phone: rec.phone } : {}),
        ...(rec.email !== undefined ? { email: rec.email } : {}),
      },
      () => now.toISOString(),
    );
    // A link may MOVE but must never be REMOVED. Xola dropping a phone on a later pull is an
    // upstream wobble, not evidence the booking belongs to nobody — and an unlink would be
    // silent, since nothing on this path reports a link that used to exist and now doesn't.
    const customerId = resolved ?? existingReservation?.customerId;

    // The fields below double as the materiality set — keep in lockstep with
    // `reservationMateriallyChanged` so a new tracked field can't silently suppress
    // the DEC-029 nudge. `customerId` is deliberately NOT in it: a customer link appearing is
    // internal bookkeeping, not a change to the booking. If it counted, the first import after
    // #701 shipped would bump `updatedAt` on every row in the catalogue and nudge on all of them.
    const core: Reservation = {
      id: internalId,
      eventId,
      source: "xola", // imported reservations are Xola-owned (DEC-106)
      customerName: rec.customerName,
      partySize: rec.partySize,
      status: rec.status,
      ...(rec.email ? { email: rec.email } : {}),
      ...(rec.phone ? { phone: rec.phone } : {}),
      ...(customerId ? { customerId } : {}),
      // NB this object is built fresh rather than spread over the stored row, so any field it
      // does not name is dropped on re-import — `cancelledBy` (#724) included. That is safe only
      // because `cancelReservation` refuses `source !== 'muster'` (DEC-105), so a Xola row can
      // never carry one. If Muster ever cancels an imported booking, this has to spread first.
    };
    // Stamp updatedAt on create + material change only (DEC-029); otherwise preserve
    // the stored timestamp so re-imports don't bump unchanged rows.
    const stampChanged =
      !existingReservation || reservationMateriallyChanged(existingReservation, core);
    const updatedAt = stampChanged ? now.toISOString() : existingReservation.updatedAt;
    assertOptionalIsoDateTime(updatedAt, "reservation.updatedAt");
    const reservation: Reservation = updatedAt ? { ...core, updatedAt } : core;
    await repo.saveReservation(reservation);

    const ref: ReservationRef = { id: String(internalId), name: rec.customerName };
    if (existingReservation) {
      result.reservationsUpdated++;
      result.updated.push(ref);
    } else {
      result.reservationsAdded++;
      result.added.push(ref);
    }
    if (rec.status === "cancelled" && existingReservation?.status !== "cancelled") {
      result.reservationsNewlyCancelled++;
      result.newlyCancelled.push(ref);
    }
  }

  return result;
}
