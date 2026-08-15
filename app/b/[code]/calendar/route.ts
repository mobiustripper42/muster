/**
 * "Add to calendar" download (12.6, #459) — a code-gated `.ics` for the customer's trip at
 * `/b/<code>/calendar`. Same guard as the manage page (the code IS the credential); serves the
 * pure `buildBookingIcs` document with the tenant timezone so the wall-clock lands right in any
 * calendar app. `nodejs` runtime (the loader reads through `pg`).
 *
 * A revoked or expired code 404s here rather than rendering the "replaced" copy — this endpoint
 * has no HTML to say it with, and the customer reaches it from a page that already did.
 */
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { buildBookingIcs } from "@core/reservations/booking-ics.js";
import { loadBookingByCode } from "../load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  const load = await loadBookingByCode(code);
  if (load.kind !== "ok") return new Response("Not found", { status: 404 });
  const booking = load.booking;

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
