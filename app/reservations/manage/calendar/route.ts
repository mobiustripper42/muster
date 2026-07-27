/**
 * "Add to calendar" download (12.6, #459) — a token-gated `.ics` for the customer's trip.
 * Same capability guard as the manage page (a leaked link is the credential); serves the pure
 * `buildBookingIcs` document with the tenant timezone so the wall-clock lands right in any
 * calendar app. `nodejs` runtime (the loader reads through `pg`).
 */
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { buildBookingIcs } from "@core/reservations/booking-ics.js";
import { loadVerifiedBooking } from "../load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const booking = await loadVerifiedBooking(url.searchParams.get("r") ?? undefined, url.searchParams.get("t") ?? undefined);
  if (!booking) return new Response("Not found", { status: 404 });

  const ics = buildBookingIcs({
    uid: String(booking.reservation.id),
    title: booking.offering?.name ?? "Your cruise",
    date: booking.event.date,
    time: booking.event.time,
    ...(booking.offering?.tripLengthMinutes !== undefined
      ? { durationMinutes: booking.offering.tripLengthMinutes }
      : {}),
    tzid: TENANT_TIMEZONE,
    ...(booking.location?.name ? { location: booking.location.name } : {}),
    dtstamp: new Date().toISOString(),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="booking-${String(booking.reservation.id)}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
