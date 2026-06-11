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
import type { EventId } from "../domain/ids.js";
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
 * Import the Reservations rows into the repository. `rows` is the full sheet
 * (both header rows + data). Idempotent on Xola `Reservation ID`. `now` is
 * injected (the import stamps `updatedAt`; the core never reads the clock).
 */
export async function importReservations(
  repo: Repository,
  rows: string[][],
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
  if (rows.length < 3) return result; // two header rows + at least one data row

  const headers = [rows[1] ?? [], rows[0] ?? []]; // sub-row first (DEC-015)
  const col = (name: string) => resolveColumn(headers, name, result.warnings);
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
      result.skipped.push({ reason: "missing a required column in the header" });
      return result;
    }
  }

  const seenEvents = new Set<string>();

  for (const row of rows.slice(2)) {
    const reservationId = (row[cReservationId] ?? "").trim();
    if (!reservationId) continue; // blank/total row

    const product = (row[cProduct] ?? "").trim();
    const resolution = resolveProduct(product);
    if (resolution.kind !== "mapped") {
      result.skipped.push({ reservationId, product, reason: resolution.reason });
      continue;
    }

    const date = parseXolaDate(row[cDate] ?? "");
    const time = parseXolaTime(row[cTime] ?? "");
    // The door (DEC-DATA-1): the parsers shape the strings, but only the shared
    // validator rejects impossible calendar dates (e.g. a malformed Feb 30) that
    // would otherwise persist as text rot. Batch-safe — skip the row, don't abort.
    if (!date || !time || !isIsoDate(date) || !isClockTime(time)) {
      result.skipped.push({
        reservationId,
        product,
        reason: `unparseable date/time: "${row[cDate]}" "${row[cTime]}"`,
      });
      continue;
    }

    const { vesselId, capacity } = resolution.mapping;
    const eventId = asId<"EventId">(`evt-${vesselId}-${date}-${time}`);

    if (!seenEvents.has(eventId)) {
      const existing = await repo.getEvent(eventId);
      // Import is authoritative-for-now: this overwrites the event each run,
      // including capacity. Once operator capacity-validation lands (DEC-016),
      // guard this so a re-import doesn't stomp a corrected COI.
      const event: Event = {
        id: eventId,
        vesselId,
        date,
        time,
        capacity,
        status: "scheduled",
      };
      await repo.saveEvent(event);
      seenEvents.add(eventId);
      if (!existing) result.eventsCreated++;
    }

    const cancelled = /cancel/i.test((row[cStatus] ?? "").trim());
    const email = cEmail !== -1 ? (row[cEmail] ?? "").trim() : "";
    const pax = cPax !== -1 ? parseInt(row[cPax] ?? "", 10) : NaN;

    const internalId = asId<"ReservationId">(`resv-${reservationId}`);
    const existingReservation = await repo.getReservation(internalId);
    // The fields below double as the materiality set — keep in lockstep with
    // `reservationMateriallyChanged` so a new tracked field can't silently
    // suppress the DEC-029 nudge.
    const core: Reservation = {
      id: internalId,
      eventId,
      customerName: (row[cName] ?? "").trim(),
      partySize: Number.isFinite(pax) ? pax : 0,
      status: cancelled ? "cancelled" : "booked",
      ...(email ? { email } : {}),
      // phone left undefined — joined from the customers export later (DEC-017).
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
    if (cancelled && existingReservation?.status !== "cancelled") {
      result.reservationsNewlyCancelled++;
    }
  }

  return result;
}
