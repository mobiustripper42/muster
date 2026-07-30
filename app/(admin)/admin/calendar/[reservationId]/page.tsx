import { notFound } from "next/navigation";
import type { Event, Gratuity, Payment, Reservation, Seat, Shift } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { buildReservationDetail, shiftForEvent } from "@core/reservations/calendar-detail.js";
import { BackLink } from "../../../../../components/ui/back-link";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import {
  CalendarControls,
  CalendarGrid,
  CalendarLegend,
  calendarHref,
  loadCalendarData,
  type Search,
} from "../calendar-view";
import { ReservationDetailPane } from "./reservation-detail-pane";

/**
 * /admin/calendar/[reservationId] (task 12.11 continued, #464) — the reservation detail,
 * READ-ONLY (no actions in this slice).
 *
 * One route, two native layouts, zero client JS: **desktop** renders the day grid beside a
 * sticky pane (the mockup's two-pane calendar, with the open reservation ringed in the grid);
 * **mobile** hides the grid and shows the pane as a full-screen page whose Back link returns
 * to the grid. A server-rendered `href` can't vary by viewport, so the split has to happen
 * here in layout rather than in the link — which is also why the grid links to a route at all
 * instead of a `?r=` pane (DEC-123 dual-form-factor posture).
 *
 * `date`/`filter` ride the query string so the grid behind the pane stays on the day you came
 * from, and Back returns you there.
 */

export const dynamic = "force-dynamic";

/** Decode a path segment, tolerating a malformed `%` rather than throwing a 500 at the user. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function ReservationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reservationId: string }>;
  /** `Search` plus the balance-link round-trip params the action redirects back with (11.2b). */
  searchParams: Promise<Search & { balanceUrl?: string; balanceErr?: string }>;
}) {
  const { reservationId: rawId } = await params;
  const sp = await searchParams;
  // Next hands the dynamic segment percent-ENCODED, and reservation ids carry a colon
  // (`resv-demo-2026-08-13-15:30`) — matching raw would miss every one of them.
  const reservationId = safeDecode(rawId);
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  // Resolve the reservation FIRST, so the grid behind the pane can default to the day the
  // reservation actually sits on. A direct link ("/admin/calendar/<id>", no ?date) otherwise
  // renders today's grid next to a reservation from another week — and the offering join
  // below, which runs through that day's slots, would come up empty.
  let reservation: Reservation | null;
  let event: Event | null;
  try {
    const repo = getRepo();
    reservation = await repo.getReservation(asId<"ReservationId">(reservationId));
    event = reservation ? await repo.getEvent(reservation.eventId) : null;
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t load this reservation right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  if (!reservation || !event) notFound();

  const data = await loadCalendarData({ ...sp, date: sp.date ?? event.date });
  if (!data) {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the calendar right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  // Detail-only reads — the grid's six lists don't carry money, tips, or crew.
  let payments: Payment[];
  let gratuities: Gratuity[];
  let shifts: Shift[];
  let taxRateBps: number;
  try {
    const repo = getRepo();
    const [p, g, s, config] = await Promise.all([
      repo.listPaymentsForReservation(reservation.id),
      repo.listGratuitiesForEvent(event.id),
      repo.listShifts(),
      repo.getPaymentConfig(),
    ]);
    payments = p;
    gratuities = g;
    shifts = s;
    taxRateBps = config.taxRateBps;
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t load this reservation right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const shift = shiftForEvent(shifts, String(event.id));
  let seats: readonly Seat[] = [];
  if (shift) {
    try {
      seats = await getRepo().listSeatsForShift(shift.id);
    } catch {
      // Crew is a cross-link, not the point of this page — degrade to no ratio.
      seats = [];
    }
  }

  // `Event` carries no `offeringId` — the offering is only knowable through the availability
  // deriver's slot for that departure (DEC-125). Absent ⇒ the pane just omits the offering chip.
  const slot = data.slots.find((s) => s.eventId && String(s.eventId) === String(event.id));

  const view = buildReservationDetail({
    reservation,
    event,
    offering: slot ? data.offeringById.get(String(slot.offeringId)) : undefined,
    vessel: data.vesselById.get(String(event.vesselId)),
    payments,
    // An event holds the whole boat for ONE reservation, but filter anyway — a cancelled-and-
    // rebooked event can carry a prior reservation's tips, and those aren't this customer's.
    gratuities: gratuities.filter((g) => String(g.reservationId) === String(reservation.id)),
    taxRateBps,
    ...(shift ? { shift: { shift, seats } } : {}),
  });

  const backHref = calendarHref(data, {});

  return (
    <Shell width="6xl">
      {/* Labelled distinctly from the admin nav's "Calendar" — on mobile this Back link IS the
          way out of the pane, so it must never be confused with a nav entry that drops the day. */}
      <BackLink href={backHref}>Back to calendar</BackLink>

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Calendar / Reservation</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">{view.customerName}</h1>
      </header>

      {/* Desktop: grid + sticky pane. Mobile: pane only, Back returns to the grid. */}
      <div className="mt-1 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-4">
        <div className="hidden lg:block">
          <CalendarControls data={data} />
          <CalendarLegend data={data} />
          <CalendarGrid data={data} selectedReservationId={String(reservation.id)} />
        </div>

        <aside className="mt-3 lg:sticky lg:top-4 lg:mt-0" data-testid="reservation-detail">
          <ReservationDetailPane
            v={view}
            balance={{
              ...(sp.balanceUrl !== undefined ? { url: sp.balanceUrl } : {}),
              ...(sp.balanceErr !== undefined ? { err: sp.balanceErr } : {}),
              date: sp.date ?? "",
              filter: sp.filter ?? "",
            }}
          />
        </aside>
      </div>

      <VersionTag />
    </Shell>
  );
}
