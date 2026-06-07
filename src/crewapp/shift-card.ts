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
import type { Repository } from "../ports/repository.js";

/**
 * Minutes a crew member must arrive before departure. FLAT, fleet-wide (DEC: a
 * single number was the explicit ask). The richer model — per-vessel prep +
 * additive per-event positioning/transit time computed from storage→dock — is
 * parked in FUTURE_IDEAS; swap this constant for that resolver when it lands.
 */
export const CALL_LEAD_MINUTES = 45;

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
  /** Total booked pax across all the shift's events. */
  paxTotal: number;
  /** Per-event manifests, soonest departure first. */
  events: EventManifestView[];
  /** Other crew on this shift (excludes the viewer). */
  coCrew: CoCrewView[];
  /** The viewer's own role on this shift. */
  viewerRole: string;
}

/** Subtract minutes from an "HH:mm" clock time (wraps within a day, just in case). */
function minusMinutes(hhmm: string, mins: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m - mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
  _now: Date,
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
  for (const eventId of shift.eventIds) {
    const event = await repo.getEvent(eventId);
    if (!event) continue;
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

  const callTime =
    events.length > 0 ? minusMinutes(events[0]!.departureTime, CALL_LEAD_MINUTES) : undefined;

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
    paxTotal: events.reduce((sum, e) => sum + e.pax, 0),
    events,
    coCrew,
    viewerRole: await roleName(repo, mySeat.role),
  };
}
