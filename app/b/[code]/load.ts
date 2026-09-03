/**
 * Shared loader for the customer manage surface (12.6, #459; recoded at #741) — resolves the
 * `/b/<code>` credential and reads everything the "Your booking" page + its actions + the
 * calendar route need. One loader so the page and every action apply the SAME guard (a
 * revoked or edited code fails identically everywhere) and read the reservation the SAME way.
 *
 * **Three outcomes, not two** (DEC-154). The HMAC scheme could only say valid/invalid; a stored
 * code can distinguish a link that WAS live from one that never existed:
 *  - `ok` — open the booking.
 *  - `refused` (`revoked` | `expired`) — the code resolved but is dead. Whoever holds it already
 *    knew the booking existed, so saying "this link was replaced" leaks nothing and is the only
 *    way they learn to ask for a new one.
 *  - `unknown` — malformed, absent, or no such code, AND the case where the code resolves but
 *    its reservation doesn't. That last one is folded in deliberately: never confirm a booking
 *    id to someone whose credential didn't resolve.
 */
import type { Event, Gratuity, Location, Offering, Payment, Reservation, Seat, Vessel } from "@core/domain/entities.js";
import { deriveVirtualAvailability } from "@core/reservations/availability.js";
import { bookingCodeRefusal, normalizeBookingCode, type BookingCodeRefusal } from "@core/reservations/booking-code.js";
import { liveBookingCode } from "@core/reservations/ensure-booking-code.js";
import { shiftForEvent } from "@core/reservations/calendar-detail.js";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";

export interface LoadedBooking {
  reservation: Reservation;
  event: Event;
  offering: Offering | undefined;
  vessel: Vessel | undefined;
  location: Location | undefined;
  payments: Payment[];
  gratuities: Gratuity[];
  shift: { shift: import("@core/domain/entities.js").Shift; seats: readonly Seat[] } | undefined;
  taxRateBps: number;
  /** The same contact's OTHER reservations (DEC-122 bearer-token loosening — one link surfaces
   *  the contact's trips), each with its own manage link. Empty when the reservation has no
   *  `customerId`. Computed from the already-loaded lists — no extra reads. */
  pastTrips: PastTrip[];
}

export interface PastTrip {
  reservationId: string;
  date: string;
  time: string;
  status: Reservation["status"];
  /** This trip's own `/b/<code>` href. ABSENT when that booking has no live code — an imported
   *  or pre-#741 booking. The row still renders, just not as a link. */
  href?: string;
}

/** What the presented code resolved to. */
export type BookingLoad =
  | { kind: "ok"; booking: LoadedBooking }
  | { kind: "refused"; reason: BookingCodeRefusal }
  | { kind: "unknown" };

/**
 * Resolve a `/b/<code>` credential and load the booking.
 *
 * `now` is injected at the call sites that have a clock to inject (tests); production passes
 * nothing and gets the real one — the expiry comparison is the only use.
 */
export async function loadBookingByCode(
  rawCode: string | undefined,
  now: () => string = () => new Date().toISOString(),
): Promise<BookingLoad> {
  const code = normalizeBookingCode(rawCode);
  // Malformed never reaches the database — a 400-character path segment is not a lookup.
  if (!code) return { kind: "unknown" };

  try {
    const repo = getRepo();
    const codeRow = await repo.getBookingCode(code);
    if (!codeRow) return { kind: "unknown" };
    const refusal = bookingCodeRefusal(codeRow, now());
    if (refusal) return { kind: "refused", reason: refusal };

    const reservation = await repo.getReservation(codeRow.reservationId);
    if (!reservation) return { kind: "unknown" };
    const event = await repo.getEvent(reservation.eventId);
    if (!event) return { kind: "unknown" };

    const [vessel, payments, gratuities, shifts, config, offerings, vessels, blocks, allEvents, allReservations] =
      await Promise.all([
        repo.getVessel(event.vesselId),
        repo.listPaymentsForReservation(reservation.id),
        repo.listGratuitiesForEvent(event.id),
        repo.listShifts(),
        repo.getPaymentConfig(),
        repo.listOfferings(),
        repo.listVessels(),
        repo.listBlocks(),
        repo.listEvents(),
        repo.listAllReservations(),
      ]);

    // `Event` carries no `offeringId` — the offering is knowable only through the availability
    // deriver's slot for that departure (DEC-125), same as the admin detail pane. Derive the
    // event's day, match the slot by event id, resolve the offering. Absent ⇒ the page degrades
    // (no duration/location/post-tip tiers), never errors.
    const slots = deriveVirtualAvailability({
      offerings,
      vessels,
      dateRange: { start: event.date, end: event.date },
      blocks,
      events: allEvents,
      reservations: allReservations,
    });
    const slot = slots.find((s) => s.eventId && String(s.eventId) === String(event.id));
    const offering = slot ? offerings.find((o) => String(o.id) === String(slot.offeringId)) ?? null : null;
    const location = offering ? await repo.getLocation(offering.locationId) : null;

    const shiftRow = shiftForEvent(shifts, String(event.id));
    let shift: LoadedBooking["shift"];
    if (shiftRow) {
      const seats = await repo.listSeatsForShift(shiftRow.id);
      shift = { shift: shiftRow, seats };
    }

    // The contact's other trips — filtered from the already-loaded reservations + events, newest
    // first (DEC-122's bearer-token loosening: one link surfaces the contact's trips).
    //
    // Each row's href needs THAT booking's own live code, which the HMAC scheme could derive for
    // free and a stored code cannot. So this reads one code list per other trip — bounded by how
    // many trips one contact has — and **mints nothing**: a page render is a GET, and minting
    // here would create credentials on prefetch. A trip with no live code renders unlinked
    // rather than as a link that fails, which is why `href` is optional.
    const eventById = new Map(allEvents.map((e) => [String(e.id), e]));
    const otherTrips = reservation.customerId
      ? allReservations
          .filter(
            (x) =>
              x.customerId &&
              String(x.customerId) === String(reservation.customerId) &&
              String(x.id) !== String(reservation.id),
          )
          .map((x) => ({ x, evt: eventById.get(String(x.eventId)) }))
          .filter((row): row is { x: Reservation; evt: Event } => row.evt !== undefined)
          .sort((a, b) => `${b.evt.date}${b.evt.time}`.localeCompare(`${a.evt.date}${a.evt.time}`))
      : [];
    const pastTrips: PastTrip[] = await Promise.all(
      otherTrips.map(async ({ x, evt }) => {
        const live = await liveBookingCode(repo, x.id, now);
        return {
          reservationId: String(x.id),
          date: evt.date,
          time: evt.time,
          status: x.status,
          ...(live ? { href: `/b/${live}` } : {}),
        };
      }),
    );

    return {
      kind: "ok",
      booking: {
        reservation,
        event,
        offering: offering ?? undefined,
        vessel: vessel ?? undefined,
        location: location ?? undefined,
        payments,
        gratuities,
        shift,
        taxRateBps: config.taxRateBps,
        pastTrips,
      },
    };
  } catch (e) {
    // A read error is NOT reported as a dead code — the customer's link may be perfectly good
    // and the database briefly unreachable. `unknown` renders the generic state, which tells
    // them to try the link again rather than to ask for a replacement they don't need.
    // That is the right call for the customer and the worst case for diagnosis:
    // `unknown` is also what a genuinely bogus code returns, so a broken booking
    // surface is indistinguishable from someone mistyping a link.
    logSwallowed("b/[code]", e, "the booking read failed and was rendered to the customer as an unknown code");
    return { kind: "unknown" };
  }
}
