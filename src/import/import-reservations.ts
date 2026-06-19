/**
 * Map + Reconcile: raw Reservations rows → Events + Reservations (DEC-015).
 *
 * Consumes the aligned `string[][]` from the xlsx reader. The Reservations sheet
 * has **two header rows** (row 1 = parent groups, row 2 = sub-headers like
 * Customer→Name/Email, Guest Breakdown→Total Demographics); data starts row 3.
 * The ~10 columns that matter live among ~70 add-on columns that drift between
 * exports, so targets are resolved **by header name, never by column letter**
 * (DEC-015).
 *
 * Reconcile is keyed on the stable Xola `Reservation ID` (and Product+Date+Time
 * for its Event) so re-import updates in place rather than duplicating. The
 * manual-entry merge *policy* stays open (DEC-TBD); this upserts imported rows.
 * Thin-path: phone is left null (joined later via the customers export — DEC-017,
 * not required for the first crew tap).
 */

import type { Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { EventId, VesselId } from "../domain/ids.js";
import {
  assertOptionalIsoDateTime,
  isClockTime,
  isIsoDate,
} from "../domain/iso-date.js";
import type { Repository } from "../ports/repository.js";
import { resolveProduct } from "./product-map.js";

export interface SkippedRow {
  reservationId?: string;
  product?: string;
  reason: string;
}

/**
 * The seam between Land and Map (DEC-015/DEC-036). A decoded reservation row with
 * date/time **already normalized** to ISO date + clock-time — so each Land adapter
 * (the xlsx reader here; the Xola API adapter in 5.4b) does its own normalization
 * before this point and `importRecords` never re-parses a Xola string. `product`
 * stays a raw name — product→vessel resolution is Map's job (`importRecords`).
 */
export interface RawReservationRecord {
  reservationId: string;
  product: string;
  /** ISO date (vessel-local day), e.g. "2026-05-16". Validated by the decoder. */
  date: string;
  /** Clock time, e.g. "15:30". Validated by the decoder. */
  time: string;
  customerName: string;
  email?: string;
  /**
   * Customer phone, when the Land adapter has it inline. The xlsx reader leaves
   * this undefined (its phone came from a separate customers export, DEC-017);
   * the Xola API adapter sets it from `order.phoneCanonical`/`phone` (DEC-036) —
   * which retires that join. Excluded from materiality (a phone correction isn't
   * shift-material), so it populates without crying wolf on a locked shift.
   */
  phone?: string;
  partySize: number;
  status: "booked" | "cancelled";
}

export interface DecodeResult {
  records: RawReservationRecord[];
  /** Header ambiguity etc. — surfaced, not swallowed (DEC-015). */
  warnings: string[];
  /** Rows dropped at decode (missing column, blank id, unparseable date/time). */
  skipped: SkippedRow[];
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
  /** Non-fatal issues surfaced rather than swallowed (DEC-015), e.g. header ambiguity. */
  warnings: string[];
  skipped: SkippedRow[];
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "16-May-2026" → "2026-05-16". Returns null on an unparseable value. */
export function parseXolaDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[(m[2] ?? "").toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${(m[1] ?? "").padStart(2, "0")}`;
}

/** "03:30 PM" → "15:30". Returns null on an unparseable value. */
export function parseXolaTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = +(m[1] ?? "0") % 12;
  if (/pm/i.test(m[3] ?? "")) hour += 12;
  return `${String(hour).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/**
 * Resolve a target column by header name (sub-row preferred, then parent — the
 * caller passes header rows in that order). If the name matches more than one
 * column (a drifted export reintroducing a colliding add-on header), warn rather
 * than bind the wrong column silently (DEC-015). Returns the first match, or -1.
 */
function resolveColumn(
  headerRows: string[][],
  name: string,
  warnings: string[],
): number {
  const matches: number[] = [];
  for (const row of headerRows) {
    row.forEach((cell, i) => {
      if (cell.trim() === name && !matches.includes(i)) matches.push(i);
    });
  }
  if (matches.length > 1) {
    warnings.push(
      `ambiguous header "${name}" matched ${matches.length} columns — using the first`,
    );
  }
  return matches.length ? matches[0]! : -1;
}

/**
 * Whether a re-imported reservation differs from the stored one in any field the
 * operator would want flagged (DEC-029). Drives the `updatedAt` stamp: equal →
 * preserve the old timestamp so a blind re-import doesn't make every locked shift
 * cry wolf. `phone` is excluded — it's joined later from the customers export
 * (DEC-017), not authored here, so it isn't an import-side change.
 */
function reservationMateriallyChanged(
  prev: Reservation,
  next: Reservation,
): boolean {
  return (
    prev.eventId !== next.eventId ||
    prev.customerName !== next.customerName ||
    prev.partySize !== next.partySize ||
    prev.status !== next.status ||
    (prev.email ?? "") !== (next.email ?? "")
  );
}

/**
 * LAND: decode the raw Reservations sheet into normalized records. `rows` is the
 * full sheet (both header rows + data). Pure (no repo, no clock) — header
 * resolution, blank-row skipping, and Xola date/time parsing live here so the Map
 * step (`importRecords`) sees only clean values. The xlsx-specific string parsing
 * stays on this side of the seam; a different Land adapter (the API) emits the
 * same `RawReservationRecord[]` its own way.
 */
export function decodeXlsxRows(rows: string[][]): DecodeResult {
  const warnings: string[] = [];
  const skipped: SkippedRow[] = [];
  const records: RawReservationRecord[] = [];
  if (rows.length < 3) return { records, warnings, skipped }; // 2 headers + ≥1 data

  const headers = [rows[1] ?? [], rows[0] ?? []]; // sub-row first (DEC-015)
  const col = (name: string) => resolveColumn(headers, name, warnings);
  const cReservationId = col("Reservation ID");
  const cProduct = col("Product");
  const cDate = col("Arrival Date");
  const cTime = col("Arrival Time");
  const cName = col("Name");
  const cEmail = col("Email");
  const cPax = col("Total Demographics");
  const cStatus = col("Status");

  for (const required of [cReservationId, cProduct, cDate, cTime, cStatus]) {
    if (required === -1) {
      skipped.push({ reason: "missing a required column in the header" });
      return { records, warnings, skipped };
    }
  }

  for (const row of rows.slice(2)) {
    const reservationId = (row[cReservationId] ?? "").trim();
    if (!reservationId) continue; // blank/total row

    const product = (row[cProduct] ?? "").trim();
    const date = parseXolaDate(row[cDate] ?? "");
    const time = parseXolaTime(row[cTime] ?? "");
    // The door (DEC-DATA-1): the parsers shape the strings, but only the shared
    // validator rejects impossible calendar dates (e.g. a malformed Feb 30) that
    // would otherwise persist as text rot. Batch-safe — skip the row, don't abort.
    if (!date || !time || !isIsoDate(date) || !isClockTime(time)) {
      skipped.push({
        reservationId,
        product,
        reason: `unparseable date/time: "${row[cDate]}" "${row[cTime]}"`,
      });
      continue;
    }

    const cancelled = /cancel/i.test((row[cStatus] ?? "").trim());
    const email = cEmail !== -1 ? (row[cEmail] ?? "").trim() : "";
    const pax = cPax !== -1 ? parseInt(row[cPax] ?? "", 10) : NaN;
    records.push({
      reservationId,
      product,
      date,
      time,
      customerName: (row[cName] ?? "").trim(),
      partySize: Number.isFinite(pax) ? pax : 0,
      status: cancelled ? "cancelled" : "booked",
      ...(email ? { email } : {}),
    });
  }

  return { records, warnings, skipped };
}

/** Per-event accumulator: derive `status` from whether any reservation is booked. */
interface PendingEvent {
  vesselId: VesselId;
  date: string;
  time: string;
  capacity: number;
  /** True once any non-cancelled reservation maps to this event. */
  anyBooked: boolean;
}

/**
 * MAP + RECONCILE: persist decoded records as Events + Reservations (DEC-015).
 * Idempotent on Xola `Reservation ID` (and Product+Date+Time for its Event). `now`
 * is injected (the import stamps `updatedAt`; the core never reads the clock).
 *
 * Product→vessel resolution (and quarantine of the unmapped) happens here. An
 * event's `status` is **derived**: an event with ≥1 booked reservation is
 * `scheduled`; an event whose every reservation is cancelled is `cancelled`, so the
 * import→`formShifts` chain cancels its shift instead of stranding a ghost (the
 * automation must not ask crew for a trip with no passengers). An event that simply
 * vanishes from a later export (vs reappearing with cancelled rows) is NOT
 * reconciled here — out of pilot scope (DEC-037).
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
  };

  // Pass 1: resolve products, partition, and accumulate per-event booked-ness.
  const events = new Map<EventId, PendingEvent>();
  const persistable: { rec: RawReservationRecord; eventId: EventId }[] = [];
  for (const rec of records) {
    const resolution = resolveProduct(rec.product);
    if (resolution.kind !== "mapped") {
      result.skipped.push({
        reservationId: rec.reservationId,
        product: rec.product,
        reason: resolution.reason,
      });
      continue;
    }
    const { vesselId, capacity } = resolution.mapping;
    const eventId = asId<"EventId">(`evt-${vesselId}-${rec.date}-${rec.time}`);
    const booked = rec.status === "booked";
    const pe = events.get(eventId);
    if (pe) pe.anyBooked ||= booked;
    else
      events.set(eventId, {
        vesselId,
        date: rec.date,
        time: rec.time,
        capacity,
        anyBooked: booked,
      });
    persistable.push({ rec, eventId });
  }

  // Pass 2: upsert events with derived status. Import is authoritative-for-now —
  // this overwrites the event each run, including capacity. Once operator
  // capacity-validation lands (DEC-016), guard the capacity stomp.
  for (const [eventId, pe] of events) {
    const existing = await repo.getEvent(eventId);
    const event: Event = {
      id: eventId,
      vesselId: pe.vesselId,
      date: pe.date,
      time: pe.time,
      capacity: pe.capacity,
      status: pe.anyBooked ? "scheduled" : "cancelled",
    };
    await repo.saveEvent(event);
    if (!existing) result.eventsCreated++;
  }

  // Pass 3: upsert reservations (materiality-guarded updatedAt, DEC-029).
  for (const { rec, eventId } of persistable) {
    const internalId = asId<"ReservationId">(`resv-${rec.reservationId}`);
    const existingReservation = await repo.getReservation(internalId);
    // The fields below double as the materiality set — keep in lockstep with
    // `reservationMateriallyChanged` so a new tracked field can't silently
    // suppress the DEC-029 nudge.
    const core: Reservation = {
      id: internalId,
      eventId,
      customerName: rec.customerName,
      partySize: rec.partySize,
      status: rec.status,
      ...(rec.email ? { email: rec.email } : {}),
      // phone: inline from the API adapter when present (DEC-036, retiring the
      // DEC-017 customers-export join); undefined on the xlsx path. Not in the
      // materiality set below — a phone change isn't a shift-material edit.
      ...(rec.phone ? { phone: rec.phone } : {}),
    };
    // Stamp updatedAt on create + material change only (DEC-029); otherwise
    // preserve the stored timestamp so re-imports don't bump unchanged rows.
    const stampChanged =
      !existingReservation ||
      reservationMateriallyChanged(existingReservation, core);
    const updatedAt = stampChanged
      ? now.toISOString()
      : existingReservation.updatedAt;
    assertOptionalIsoDateTime(updatedAt, "reservation.updatedAt");
    const reservation: Reservation = updatedAt ? { ...core, updatedAt } : core;
    await repo.saveReservation(reservation);

    // added/updated partition every imported row by prior existence …
    if (existingReservation) result.reservationsUpdated++;
    else result.reservationsAdded++;
    // … newlyCancelled is the orthogonal "changed to cancelled this run" signal.
    if (rec.status === "cancelled" && existingReservation?.status !== "cancelled") {
      result.reservationsNewlyCancelled++;
    }
  }

  return result;
}

/**
 * Land→Map in one call: decode the full sheet and import it. Idempotent on Xola
 * `Reservation ID`. Kept as the xlsx entry point (and so M1's tests still drive
 * the whole path against raw rows); the seam (`decodeXlsxRows`/`importRecords`) is
 * what the API adapter reuses (DEC-036/DEC-037).
 */
export async function importReservations(
  repo: Repository,
  rows: string[][],
  now: Date = new Date(),
): Promise<ImportResult> {
  const decoded = decodeXlsxRows(rows);
  const result = await importRecords(repo, decoded.records, now);
  result.warnings.unshift(...decoded.warnings);
  result.skipped.unshift(...decoded.skipped);
  return result;
}
