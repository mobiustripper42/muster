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
import type { Event, Shift } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import {
  bailLatenessMs,
  earliestScheduledStart,
  shiftEndFromEvents,
  CALL_LEAD_MINUTES,
  TEARDOWN_MINUTES,
} from "../builder/derive.js";
import { TENANT_TIMEZONE, vesselClockOf } from "../config/tenant.js";

// The call lead + teardown + trip length live in `builder/derive` (the shift
// *end* needs them too, and the outbox reads that end — DEC-041). Re-exported
// here so the card's contract and its test keep importing them from the card.
export { CALL_LEAD_MINUTES, TEARDOWN_MINUTES };

/** One guest on an event's manifest. Name + party + phone; no waiver (DEC-012). */
export interface ManifestGuest {
  /** The booking id — keys the guest's Text button + its contact record (#345). */
  reservationId: string;
  name: string;
  party: number;
  phone?: string;
  /** The latest "we texted them" record (#345 Part B), when one exists — `by` is
   *  the contacter's display name, `at` the ISO-8601 instant. */
  contact?: { by: string; at: string };
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
  /** Their role on this shift (captain/mate), from the seat — the same
   *  resolution as `viewerRole`. Drives the DEC-086 role glyph on the card's
   *  "Crewing with you" rows: who's running the boat, at a glance. */
  role: string;
}

export interface ShiftCardView {
  shiftId: string;
  vesselName: string;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /** Derived show-up time, "HH:mm" — earliest departure minus the call lead. */
  callTime?: string;
  /**
   * Derived end of the time commitment, "HH:mm" — the latest trip *end* plus the
   * teardown buffer (DEC-041, #275). Not the latest *departure* plus a length: an
   * earlier trip that runs longer is the one that gets back last. The "when am I
   * free" half of the Yes/No decision. Absent on an event-less shift, as `callTime`.
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
  /**
   * True when the viewer's seat is a supernumerary/trainee ride (DEC-087) —
   * the card hides the bail control (a ride isn't a reliability commitment;
   * the office unstaffs, no penalty) and says so instead.
   */
  traineeSeat: boolean;
}

const MINUTE_MS = 60_000;

/** The crew member's committed call→back window for a shift-day (DEC-041). */
export interface CommittedWindow {
  /** Show-up time, "HH:mm" — earliest scheduled departure − the call lead. */
  callTime?: string;
  /** End of commitment, "HH:mm" — the latest trip END (each trip measured by its own
   *  length) plus the teardown buffer. */
  shiftEndTime?: string;
}

/**
 * The two window boundaries as instants. Both come from `builder/derive` — this file
 * derives neither. Pass the shift's events; cancelled ones are filtered by the callees
 * (a cancelled trip moves neither boundary), so callers need not pre-filter or sort.
 */
function windowInstants(
  events: Event[],
  tz: string,
): { call: Date; end: Date } | null {
  const first = earliestScheduledStart(events, tz);
  const end = shiftEndFromEvents(events, tz);
  if (!first || !end) return null;
  return { call: new Date(first.getTime() - CALL_LEAD_MINUTES * MINUTE_MS), end };
}

/**
 * THE committed-window computation (DEC-041) — one home, shared by the shift card,
 * the crew-view ask card, and the /crew/open claimable view. Empty in → empty out
 * (an event-less shift has no window).
 *
 * **A formatter, not a second computation.** It used to take departure clock strings
 * and add the flat `TRIP_DURATION_MINUTES`, which meant it could not see
 * `Event.durationMinutes` at all. From #570 that made it disagree with
 * `shiftEndFromEvents` on any shift carrying a real per-event length — the operator's
 * outbox card and the crew's ask card rendering different "back by" times for the same
 * ask, and the subscribed calendar feed differing from My Shifts. The claim that "one
 * computation" kept the surfaces agreeing was true only among the clock-string three.
 *
 * It now delegates to the authoritative Date-based pair and formats through
 * `vesselClockOf` — the instant computation is the real one, the "HH:mm" is display.
 * That also makes the boundaries DST-correct, which string arithmetic on a wall clock
 * is not.
 *
 * **This changes a premise DEC-129 reasoned from.** That decision built its own
 * Date-based window in `asks/suppression.ts` rather than reuse this one, because this
 * one was "an `"HH:mm"` display helper that wraps within a day and loses the date."
 * That is no longer what this is. DEC-129 went the same direction independently and
 * is not authority for this change — but its stated reason for keeping two of them
 * has now gone, which is worth knowing before the next person adds a third.
 */
export function committedWindow(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): CommittedWindow {
  const w = windowInstants(events, tz);
  if (!w) return {};
  return {
    callTime: vesselClockOf(w.call, tz),
    shiftEndTime: vesselClockOf(w.end, tz),
  };
}

/**
 * The on-clock DURATION of the committed window, in minutes (DEC-041) — the payroll
 * report's per-shift hours (#347). Exactly the span between {@link committedWindow}'s
 * two boundaries, so the number a crew member is estimated at can never disagree with
 * the window their own card shows them.
 *
 * Measured between **instants**, not by subtracting wall-clock strings: a shift that
 * spans a DST transition is genuinely an hour longer or shorter on the clock, and that
 * hour is worked or not worked. The old string span silently answered as though every
 * day had 24 equal hours. Empty in → 0.
 */
export function committedMinutes(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): number {
  const w = windowInstants(events, tz);
  if (!w) return 0;
  return Math.round((w.end.getTime() - w.call.getTime()) / MINUTE_MS);
}

async function roleName(repo: Repository, roleId: string): Promise<string> {
  const rt = await repo.getRoleType(roleId as Parameters<Repository["getRoleType"]>[0]);
  return rt?.name ?? roleId;
}

/** A per-call memo over `roleName` — the viewer's seat and every co-crew seat
 *  share the same handful of role ids, so resolve each id's name once rather
 *  than re-hitting the port per member (architect note on the co-crew loop). */
function roleResolver(repo: Repository): (roleId: string) => Promise<string> {
  const cache = new Map<string, string>();
  return async (roleId: string) => {
    const hit = cache.get(roleId);
    if (hit !== undefined) return hit;
    const name = await roleName(repo, roleId);
    cache.set(roleId, name);
    return name;
  };
}

/**
 * The viewer-independent manifest of a shift — every event's booked guests, pax,
 * and dock, soonest departure first — plus the raw event rows callers need for
 * schedule math. Shared by the crew shift card (which layers the viewer's seat,
 * co-crew, and bail state on top) and the operator cockpit (#319), so both read
 * ONE assembly, never a parallel query. Booked reservations only — a cancelled
 * booking isn't aboard (DEC-012 no-waiver already encoded in `ManifestGuest`).
 */
export interface ShiftManifestView {
  /** Per-event manifests, soonest departure first. */
  events: EventManifestView[];
  /** Total booked pax across all the shift's events. */
  paxTotal: number;
  /** The one dock when every event shares it; else absent (per-event docks stand). */
  sharedDock?: string;
  /** Underlying event rows (scheduled + cancelled) — for callers doing window/bail math. */
  rawEvents: Event[];
}

export async function buildShiftManifest(
  repo: Repository,
  shift: Shift,
): Promise<ShiftManifestView> {
  // Per-event manifest, booked guests only (a cancelled booking isn't aboard).
  // The shift's guest-contact records (#345 Part B), keyed by reservation, so each
  // guest row shows who (if anyone) has texted them — loaded once for the shift.
  const contactByReservation = new Map(
    (await repo.listGuestContactsForShift(shift.id)).map((c) => [
      String(c.reservationId),
      { by: c.contactedByName, at: c.contactedAt },
    ]),
  );
  const events: EventManifestView[] = [];
  const rawEvents: Event[] = [];
  for (const eventId of shift.eventIds) {
    const event = await repo.getEvent(eventId);
    if (!event) continue;
    rawEvents.push(event);
    const reservations = (await repo.listReservationsForEvent(eventId)).filter(
      (r) => r.status === "booked",
    );
    const guests: ManifestGuest[] = reservations.map((r) => {
      const contact = contactByReservation.get(String(r.id));
      return {
        reservationId: String(r.id),
        name: r.customerName,
        party: r.partySize,
        ...(r.phone !== undefined ? { phone: r.phone } : {}),
        ...(contact ? { contact } : {}),
      };
    });
    events.push({
      eventId: event.id,
      departureTime: event.time,
      ...(event.dock !== undefined ? { dock: event.dock } : {}),
      pax: guests.reduce((sum, g) => sum + g.party, 0),
      guests,
    });
  }
  events.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  // One pin when every event shares a dock; otherwise the per-event docks stand.
  const docks = events.map((e) => e.dock);
  const sharedDock =
    events.length > 0 && docks.every((d) => d !== undefined && d === docks[0])
      ? docks[0]
      : undefined;

  return {
    events,
    paxTotal: events.reduce((sum, e) => sum + e.pax, 0),
    ...(sharedDock !== undefined ? { sharedDock } : {}),
    rawEvents,
  };
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

  // Per-event manifest + pax + shared dock — the viewer-independent assembly,
  // shared with the operator cockpit (#319). `rawEvents` feed the window/bail math.
  const { events, paxTotal, sharedDock, rawEvents } = await buildShiftManifest(
    repo,
    shift,
  );

  // Window math uses SCHEDULED departures only — a cancelled trip moves neither the
  // call time nor the shift end (DEC-041); `committedWindow` filters them itself.
  // One computation, shared with the ask card, the /crew/open claimable view, AND
  // (since it delegates to `shiftEndFromEvents`) the outbox and the calendar feed.
  // The manifest above still lists every event.
  const { callTime, shiftEndTime } = committedWindow(rawEvents, TENANT_TIMEZONE);

  // A bail "now" is "late" iff it falls inside the staffing horizon — DEC-028's
  // notice shortfall is non-zero (#7). Same instant the score penalizes; the
  // copy uses it only to pick graceful vs firm wording, never to block.
  const bailLate = bailLatenessMs(earliestScheduledStart(rawEvents, TENANT_TIMEZONE), now) > 0;

  // Co-crew: other confirmed, assigned seats on this shift, with contact + role.
  // One role resolver shared with viewerRole below — the seat ids repeat, so the
  // getRoleType lookups collapse to one per distinct role.
  const resolveRole = roleResolver(repo);
  const coCrew: CoCrewView[] = [];
  for (const seat of seats) {
    if (seat.state !== "Confirmed" || !seat.assignedCrewMemberId) continue;
    if (seat.assignedCrewMemberId === viewerCrewId) continue;
    const mate = await repo.getCrewMember(seat.assignedCrewMemberId);
    if (mate)
      coCrew.push({
        crewMemberId: mate.id,
        name: mate.name,
        phone: mate.phone,
        role: await resolveRole(seat.role),
      });
  }

  return {
    shiftId: shift.id,
    vesselName,
    date: shift.date,
    ...(callTime !== undefined ? { callTime } : {}),
    ...(shiftEndTime !== undefined ? { shiftEndTime } : {}),
    paxTotal,
    ...(sharedDock !== undefined ? { sharedDock } : {}),
    events,
    coCrew,
    viewerRole: await resolveRole(mySeat.role),
    mySeatId: mySeat.id,
    bailLate,
    traineeSeat: mySeat.kind === "supernumerary",
  };
}
