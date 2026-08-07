/**
 * Hull occupancy (#615, #691) — one boat cannot run two trips that overlap in time.
 *
 * **The bug this closes.** Both the read path and the write CAS guarded on *slot identity*:
 * the exact `(vessel, date, time)` triple. Two trips on one hull at 13:30 and 14:00 are two
 * different identities, so the unique index never fired, the `not exists` reservation guard
 * (keyed on `event_id`) never fired, and **both bookings succeeded**. Nothing reported it —
 * #613's net is for money-moved-no-reservation, and here a clean reservation is written. The
 * first anyone would know is two parties at one slip.
 *
 * Three places called the old guard "defeat-proof" (`claim.ts`, `entities.ts`, DEC-109). It was
 * defeat-proof for an identical triple and trivially defeated by overlap — which is why nobody
 * went looking. Those now say what is actually guaranteed.
 *
 * **Source-blind by design.** A Xola trip occupies the hull exactly as a Muster one does. That
 * is not the cross-source *capacity arithmetic* DEC-106 prohibits — whole-boat is a mutex, not
 * a count, so there is nothing to reconcile: the hull is busy or it isn't. Muster-vs-Muster and
 * Muster-vs-Xola are the same defect (operator, 2026-08-06) and get the same code path.
 *
 * Pure, clock-free, integer minutes. Shared by `deriveVirtualAvailability`, `candidateVessels`,
 * and the write CAS, so the read path and the backstop cannot disagree about what "busy" means.
 */
import type { Event } from "../domain/entities.js";
import type { VesselId } from "../domain/ids.js";

/**
 * The standing trip length in minutes, used when an event carries no duration of its own.
 *
 * Two callers need it. **Imported Xola events never carry a duration** — the importer writes
 * id/vessel/date/time/capacity/status and nothing else, and Xola's trip length is not in the
 * imported shape. And **pre-#570 Muster events** predate `durationMinutes`.
 *
 * 100 minutes is BrewBoat's trip ("1h 40min on the water"), set by the operator 2026-08-06 as a
 * deliberate stand-in. It is a CEILING-ish assumption on purpose: over-estimating a trip costs a
 * sellable slot, under-estimating costs a double-booked boat, and only one of those is
 * recoverable.
 *
 * **This is finite.** Xola stops selling at the cutover (DEC-126) and its events age out, at
 * which point the Xola half of this file is deletable. Until then a real per-event duration
 * would have to come from the Xola API, which is a different job.
 */
export const XOLA_TRIP_MINUTES = 100;

/** A half-open busy window in minutes past midnight, vessel-local: `[start, end)`. */
export interface BusyInterval {
  start: number;
  end: number;
}

/** `"13:30"` → `810`. Minutes past midnight; no timezone maths — the date already fixes the day. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Every window this hull is occupied on this date, from ALL materialized events — both sources.
 *
 * `cancelled` events are skipped: the importer writes `cancelled` when a Xola trip has no live
 * bookings left, and a cancelled Muster event is a released boat. Only `scheduled` occupies.
 */
export function busyIntervalsFor(
  events: readonly Event[],
  vesselId: VesselId,
  date: string,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const e of events) {
    if (e.status !== "scheduled") continue;
    if (String(e.vesselId) !== String(vesselId) || e.date !== date) continue;
    const start = minutesOfDay(e.time);
    // Absent duration ⇒ assume a full trip, never zero. A zero-length window would make an
    // existing booking invisible to this check, which is the exact failure being closed.
    out.push({ start, end: start + (e.durationMinutes ?? XOLA_TRIP_MINUTES) });
  }
  return out;
}

/**
 * Would a trip starting at `startMinute` for `durationMinutes` collide with any busy window?
 *
 * **Half-open**, `[start, end)`: a trip beginning exactly when the previous one ends is legal.
 * That is not a technicality — the operator schedules 13:30/15:30 against a 100-minute trip
 * precisely so departures abut, and a closed interval would refuse every one of them.
 */
export function hullIsBusy(
  busy: readonly BusyInterval[],
  startMinute: number,
  durationMinutes: number,
): boolean {
  const end = startMinute + durationMinutes;
  return busy.some((b) => startMinute < b.end && b.start < end);
}
