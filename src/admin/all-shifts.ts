/**
 * "All shifts" derivation (#100 Part A, DEC-042) — the operator's deliberate
 * full-visibility PULL surface: every CURRENT shift (not cancelled/completed) in
 * a date window, with the facts to scan and a click-through to the cockpit.
 *
 * A pure read over existing derivations. The live state comes from
 * `resolveShiftStateOnRead` (the DEC-023 corollary — never trust the persisted
 * badge), and trips/pax mirror the assignment view exactly. The anti-dashboard
 * brand guardrails (default-to-today, neutral states, no auto-refresh, a SEPARATE
 * empty state from the board's ✓) live in the SURFACE, not here —
 * see app/(admin)/admin/shifts/page.tsx and DEC-042.
 */
import type { Shift } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { resolveShiftStateOnRead } from "../builder/tick.js";

export interface AllShiftsTrip {
  /** Departure clock time, vessel-local wall-clock ("14:00"). */
  time: string;
  /** Booked pax on this trip. */
  pax: number;
}

export interface AllShiftsRow {
  shiftId: string;
  vesselName: string;
  /** ISO-8601 vessel-local date. */
  date: string;
  /** Live state resolved on read — one of Pending/Filling/Crewed/AtRisk. */
  state: Shift["state"];
  /** Scheduled trips, earliest first. */
  trips: AllShiftsTrip[];
  paxTotal: number;
  requiredSeats: number;
  confirmedSeats: number;
}

/**
 * Every current shift whose date falls in `[from, to]` (inclusive ISO date
 * strings), sorted by date then earliest departure. Cancelled + Completed shifts
 * are excluded — "current" means on the books, not killed or historical.
 *
 * Per-shift `resolveShiftStateOnRead` re-reads events each call (pilot scale —
 * a handful of shifts per day window; revisit with an index if it ever grows).
 */
export async function deriveAllShifts(
  repo: Repository,
  window: { from: string; to: string },
  now: Date,
  opts?: { leadDays?: number; tz?: string },
): Promise<AllShiftsRow[]> {
  const vesselName = new Map(
    (await repo.listVessels()).map((v) => [v.id, v.name]),
  );
  const rows: AllShiftsRow[] = [];

  for (const shift of await repo.listShifts()) {
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;
    if (shift.date < window.from || shift.date > window.to) continue;

    const state =
      (await resolveShiftStateOnRead(repo, shift.id, now, opts)) ?? shift.state;

    const trips: AllShiftsTrip[] = [];
    for (const eventId of shift.eventIds) {
      const event = await repo.getEvent(eventId);
      if (!event || event.status !== "scheduled") continue;
      const booked = (await repo.listReservationsForEvent(event.id)).filter(
        (r) => r.status === "booked",
      );
      trips.push({
        time: event.time,
        pax: booked.reduce((sum, r) => sum + r.partySize, 0),
      });
    }
    trips.sort((a, b) => a.time.localeCompare(b.time));

    const required = (await repo.listSeatsForShift(shift.id)).filter(
      (s) => s.kind === "required",
    );
    rows.push({
      shiftId: String(shift.id),
      vesselName: vesselName.get(shift.vesselId) ?? String(shift.vesselId),
      date: shift.date,
      state,
      trips,
      paxTotal: trips.reduce((sum, t) => sum + t.pax, 0),
      requiredSeats: required.length,
      confirmedSeats: required.filter((s) => s.state === "Confirmed").length,
    });
  }

  rows.sort((a, b) =>
    a.date !== b.date
      ? a.date.localeCompare(b.date)
      : (a.trips[0]?.time ?? "").localeCompare(b.trips[0]?.time ?? ""),
  );
  return rows;
}
