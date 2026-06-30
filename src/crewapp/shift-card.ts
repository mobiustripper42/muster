/**
 * Shift card view model (SPEC §2.6.3) — "single source of truth" for a crew
 * member standing on the dock. Assembles, from the port: call time vs departure
 * time, the per-event guest manifest (the hinge that ends the Xola split — §3.5),
 * pax, the departure dock (for a map pin), and who else is crewing (one-tap
 * contact). Framework-free, data-only; the surface formats it.
 *
 * Deferred to follow-ups (not this card yet): bail action, credential nudge, the
 * "changed since last viewed" live indicator.
 */

import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import {
  bailLatenessMs,
  earliestScheduledStart,
  CALL_LEAD_MINUTES,
  TRIP_DURATION_MINUTES,
} from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";

// The call lead + trip length live in `builder/derive` (the shift *end* needs
// them too, and the outbox reads that end — DEC-041). Re-exported here so the
// card's contract and its test keep importing them from the card.
export { CALL_LEAD_MINUTES };

/** One guest on an event's manifest. Name + party + phone; no waiver (DEC-012). */
export interface ManifestGuest {
  name: string;
  party: number;
  phone?: string;
}

/** One event's slice of the card — its own departure, dock, pax, and guests. */
export interface EventManifestView {
  eventId: string;
  /** Departure clock time, "HH:mm". */
  departureTime: string;
  /** Departure location for the map pin (absent → no pin). */
  dock?: string;
  /** Sum of booked party sizes on this event. */
  pax: number;
  guests: ManifestGuest[];
}

/** A co-crew member on the same shift, with one-tap contact. */
export interface CoCrewView {
  crewMemberId: string;
  name: string;
  phone: string;
}

export interface ShiftCardView {
  shiftId: string;
  vesselName: string;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /** Derived show-up time, "HH:mm" — earliest departure minus the call lead. */
  callTime?: string;
  /**
   * Derived end of the time commitment, "HH:mm" — latest departure + the trip
   * length + the call lead reused as a post-trip teardown buffer (DEC-041). The
   * "when am I free" half of the In/Out decision. Absent on an event-less shift,
   * same as `callTime`.
   */
  shiftEndTime?: string;
  /** Total booked pax across all the shift's events. */
  paxTotal: number;
  /**
   * The one dock, when every event departs from the same place — so the surface
   * can show a single prominent pin (the common case) instead of burying it in
   * each event's manifest. Absent when events differ or any lacks a dock; then
   * the per-event docks on `events[]` carry it.
   */
  sharedDock?: string;
  /** Per-event manifests, soonest departure first. */
  events: EventManifestView[];
  /** Other crew on this shift (excludes the viewer). */
  coCrew: CoCrewView[];
  /** The viewer's own role on this shift. */
  viewerRole: string;
  /** The viewer's own confirmed seat — what a "can't make it" bail acts on (#56). */
  mySeatId: string;
  /**
   * True iff a bail "now" would fall inside the staffing horizon (DEC-028: the
   * notice shortfall is non-zero) — little/no time left to refill, so the
   * "can't make it" copy turns firmer and pushes the operator call (#7).
   */
  bailLate: boolean;
}

/** Subtract minutes from an "HH:mm" clock time (wraps within a day, just in case). */
function minusMinutes(hhmm: string, mins: number): string {
  return plusMinutes(hhmm, -mins);
}

/** Add minutes to an "HH:mm" clock time (wraps within a day — a late trip whose
 * end rolls past midnight reads as the next-day wall clock, like `callTime`).
 * Exported so the crew-view ask card derives its shift end the same way (#92). */
export function plusMinutes(hhmm: string, mins: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The crew member's committed call→back window for a shift-day (DEC-041). */
export interface CommittedWindow {
  /** Show-up time, "HH:mm" — earliest scheduled departure − the call lead. */
  callTime?: string;
  /** End of commitment, "HH:mm" — latest departure + trip length + the call lead
   *  reused as a teardown buffer. */
  shiftEndTime?: string;
}

/**
 * THE committed-window computation (DEC-041) — one home, shared by the shift card,
 * the crew-view ask card, and the /crew/open claimable view so all three agree on
 * the call→back times. Pass **scheduled** departure clock times ("HH:mm"); a
 * cancelled trip moves neither boundary, so the caller filters first. Empty in →
 * empty out (an event-less shift has no window).
 */
export function committedWindow(
  scheduledTimes: readonly string[],
): CommittedWindow {
  if (scheduledTimes.length === 0) return {};
  const sorted = [...scheduledTimes].sort((a, b) => a.localeCompare(b));
  return {
    callTime: minusMinutes(sorted[0]!, CALL_LEAD_MINUTES),
    shiftEndTime: plusMinutes(
      sorted[sorted.length - 1]!,
      TRIP_DURATION_MINUTES + CALL_LEAD_MINUTES,
    ),
  };
}

async function roleName(repo: Repository, roleId: string): Promise<string> {
  const rt = await repo.getRoleType(roleId as Parameters<Repository["getRoleType"]>[0]);
  return rt?.name ?? roleId;
}

/**
 * Build the shift card for `viewerCrewId`. Returns null if the shift doesn't
 * exist OR the viewer isn't crewing it (a crew member only sees cards for shifts
 * they're assigned to — not an open ask, not someone else's shift).
 */
export async function buildShiftCard(
  repo: Repository,
  shiftId: ShiftId,
  viewerCrewId: CrewMemberId,
  now: Date,
): Promise<ShiftCardView | null> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return null;

  const seats = await repo.listSeatsForShift(shiftId);
  const mySeat = seats.find(
    (s) => s.assignedCrewMemberId === viewerCrewId && s.state === "Confirmed",
  );
  if (!mySeat) return null; // viewer isn't (confirmed) crew on this shift

  const vessel = await repo.getVessel(shift.vesselId);
  const vesselName = vessel?.name ?? shift.vesselId;

  // Per-event manifest, booked guests only (a cancelled booking isn't aboard).
  const events: EventManifestView[] = [];
  const rawEvents: Event[] = [];
  for (const eventId of shift.eventIds) {
    const event = await repo.getEvent(eventId);
    if (!event) continue;
    rawEvents.push(event);
    const reservations = (await repo.listReservationsForEvent(eventId)).filter(
      (r) => r.status === "booked",
    );
    const guests: ManifestGuest[] = reservations.map((r) => ({
      name: r.customerName,
      party: r.partySize,
      ...(r.phone !== undefined ? { phone: r.phone } : {}),
    }));
    events.push({
      eventId: event.id,
      departureTime: event.time,
      ...(event.dock !== undefined ? { dock: event.dock } : {}),
      pax: guests.reduce((sum, g) => sum + g.party, 0),
      guests,
    });
  }
  events.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  // Window math uses SCHEDULED departures only — a cancelled trip moves neither
  // the call time nor the shift end (DEC-041). One computation (`committedWindow`)
  // shared with the ask card and the /crew/open claimable view, so all three agree
  // on the window. The manifest above still lists every event.
  const { callTime, shiftEndTime } = committedWindow(
    rawEvents.filter((e) => e.status === "scheduled").map((e) => e.time),
  );

  // A bail "now" is "late" iff it falls inside the staffing horizon — DEC-028's
  // notice shortfall is non-zero (#7). Same instant the score penalizes; the
  // copy uses it only to pick graceful vs firm wording, never to block.
  const bailLate = bailLatenessMs(earliestScheduledStart(rawEvents, TENANT_TIMEZONE), now) > 0;

  // One pin when every event shares a dock; otherwise the per-event docks stand.
  const docks = events.map((e) => e.dock);
  const sharedDock =
    events.length > 0 && docks.every((d) => d !== undefined && d === docks[0])
      ? docks[0]
      : undefined;

  // Co-crew: other confirmed, assigned seats on this shift, with contact.
  const coCrew: CoCrewView[] = [];
  for (const seat of seats) {
    if (seat.state !== "Confirmed" || !seat.assignedCrewMemberId) continue;
    if (seat.assignedCrewMemberId === viewerCrewId) continue;
    const mate = await repo.getCrewMember(seat.assignedCrewMemberId);
    if (mate) coCrew.push({ crewMemberId: mate.id, name: mate.name, phone: mate.phone });
  }

  return {
    shiftId: shift.id,
    vesselName,
    date: shift.date,
    ...(callTime !== undefined ? { callTime } : {}),
    ...(shiftEndTime !== undefined ? { shiftEndTime } : {}),
    paxTotal: events.reduce((sum, e) => sum + e.pax, 0),
    ...(sharedDock !== undefined ? { sharedDock } : {}),
    events,
    coCrew,
    viewerRole: await roleName(repo, mySeat.role),
    mySeatId: mySeat.id,
    bailLate,
  };
}
