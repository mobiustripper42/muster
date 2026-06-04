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
import type { Repository } from "../ports/repository.js";
import { resolveProduct } from "./product-map.js";

export interface SkippedRow {
  reservationId?: string;
  product?: string;
  reason: string;
}

export interface ImportResult {
  reservationsAdded: number;
  reservationsUpdated: number;
  reservationsCancelled: number;
  eventsUpserted: number;
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

/** First column index whose header (sub-row preferred, then parent) matches. */
function findColumn(headerRows: string[][], name: string): number {
  for (const row of headerRows) {
    const i = row.findIndex((cell) => cell.trim() === name);
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Import the Reservations rows into the repository. `rows` is the full sheet
 * (both header rows + data). Idempotent on Xola `Reservation ID`.
 */
export async function importReservations(
  repo: Repository,
  rows: string[][],
): Promise<ImportResult> {
  const result: ImportResult = {
    reservationsAdded: 0,
    reservationsUpdated: 0,
    reservationsCancelled: 0,
    eventsUpserted: 0,
    skipped: [],
  };
  if (rows.length < 3) return result; // two header rows + at least one data row

  const headers = [rows[1] ?? [], rows[0] ?? []]; // sub-row first (DEC-015)
  const col = (name: string) => findColumn(headers, name);
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
    if (!date || !time) {
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
      if (!existing) result.eventsUpserted++;
    }

    const cancelled = /cancel/i.test((row[cStatus] ?? "").trim());
    const email = cEmail !== -1 ? (row[cEmail] ?? "").trim() : "";
    const pax = cPax !== -1 ? parseInt(row[cPax] ?? "", 10) : NaN;

    const internalId = asId<"ReservationId">(`resv-${reservationId}`);
    const existingReservation = await repo.getReservation(internalId);
    const reservation: Reservation = {
      id: internalId,
      eventId,
      customerName: (row[cName] ?? "").trim(),
      partySize: Number.isFinite(pax) ? pax : 0,
      status: cancelled ? "cancelled" : "booked",
      ...(email ? { email } : {}),
      // phone left undefined — joined from the customers export later (DEC-017).
    };
    await repo.saveReservation(reservation);

    if (cancelled) result.reservationsCancelled++;
    else if (existingReservation) result.reservationsUpdated++;
    else result.reservationsAdded++;
  }

  return result;
}
