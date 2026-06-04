/**
 * Browse imported events + reservations (SPEC §2.2 "States to render").
 *
 * The data-layer view Spink eyeballs before building shifts: events grouped by
 * date with reservation count + pax vs capacity, and per-event detail showing
 * each reservation's name, party size, and (nullable) phone. Structured output
 * for the future M4 UI; a thin text render so it's usable pre-stack.
 */

import type { Reservation } from "../domain/entities.js";
import type { EventId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";

export interface EventBrowseRow {
  eventId: EventId;
  vesselId: string;
  date: string;
  time: string;
  capacity: number;
  reservationCount: number;
  /** Pax across booked (non-cancelled) reservations. */
  paxTotal: number;
}

export async function buildEventBrowse(repo: Repository): Promise<EventBrowseRow[]> {
  const events = await repo.listEvents();
  const rows = await Promise.all(
    events.map(async (e): Promise<EventBrowseRow> => {
      const resvs = await repo.listReservationsForEvent(e.id);
      const booked = resvs.filter((r) => r.status === "booked");
      return {
        eventId: e.id,
        vesselId: e.vesselId,
        date: e.date,
        time: e.time,
        capacity: e.capacity,
        reservationCount: resvs.length,
        paxTotal: booked.reduce((sum, r) => sum + r.partySize, 0),
      };
    }),
  );
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
  );
}

export interface EventDetail {
  eventId: EventId;
  reservations: Array<
    Pick<Reservation, "customerName" | "partySize" | "status"> & {
      phone: string;
      email: string;
    }
  >;
}

export async function buildEventDetail(
  repo: Repository,
  eventId: EventId,
): Promise<EventDetail> {
  const resvs = await repo.listReservationsForEvent(eventId);
  return {
    eventId,
    reservations: resvs.map((r) => ({
      customerName: r.customerName,
      partySize: r.partySize,
      status: r.status,
      phone: r.phone ?? "(no number on file)",
      email: r.email ?? "",
    })),
  };
}

/** Thin text rendering of the event list — one line per event. */
export function renderEventList(rows: EventBrowseRow[]): string {
  if (rows.length === 0) return "(no events)";
  return rows
    .map(
      (r) =>
        `${r.date} ${r.time}  ${r.vesselId}  ${r.reservationCount} resv · ${r.paxTotal}/${r.capacity} pax`,
    )
    .join("\n");
}
