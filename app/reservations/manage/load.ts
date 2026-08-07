/**
 * Shared loader for the customer manage surface (12.6, #459) — verifies the capability token
 * and reads everything the "Your booking" page + its actions + the calendar route need. One
 * loader so the page and every action apply the SAME token guard (a leaked/edited link fails
 * identically everywhere) and read the reservation the SAME way.
 *
 * Returns `null` for a bad/absent token OR a missing reservation — the page shows one generic
 * "link isn't valid" state either way, never distinguishing "wrong token" from "no such
 * booking" (don't confirm a reservation id to someone who couldn't verify it).
 */
import type { Event, Gratuity, Location, Offering, Payment, Reservation, Seat, Vessel } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { deriveVirtualAvailability } from "@core/reservations/availability.js";
import { reservationLinkToken, verifyReservationLinkToken } from "@core/reservations/booking-link.js";
import { shiftForEvent } from "@core/reservations/calendar-detail.js";
import { getRepo } from "../../lib/repo";

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
  /** This trip's own capability manage href. */
  href: string;
}

/** Verify `t` against `r` and load the booking, or `null` (bad token / missing / read error). */
export async function loadVerifiedBooking(
  rawR: string | undefined,
  rawT: string | undefined,
): Promise<LoadedBooking | null> {
  const secret = process.env.RESERVATION_LINK_SECRET;
  if (!secret || !rawR || !rawT) return null;
  const reservationId = asId<"ReservationId">(rawR);
  if (!verifyReservationLinkToken(reservationId, secret, rawT)) return null;

  try {
    const repo = getRepo();
    const reservation = await repo.getReservation(reservationId);
    if (!reservation) return null;
    const event = await repo.getEvent(reservation.eventId);
    if (!event) return null;

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

    // The contact's other trips — filtered from the already-loaded reservations + events (no
    // extra reads), newest first, each minted its own manage link.
    const eventById = new Map(allEvents.map((e) => [String(e.id), e]));
    const pastTrips: PastTrip[] = reservation.customerId
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
          .map(({ x, evt }) => ({
            reservationId: String(x.id),
            date: evt.date,
            time: evt.time,
            status: x.status,
            href: `/reservations/manage?r=${encodeURIComponent(String(x.id))}&t=${reservationLinkToken(x.id, secret)}`,
          }))
      : [];

    return {
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
    };
  } catch {
    return null;
  }
}
