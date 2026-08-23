import { notFound } from "next/navigation";
import type { Event, Gratuity, Payment, Reservation, Seat, Shift } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { buildReservationDetail, shiftForEvent } from "@core/reservations/calendar-detail.js";
import { quoteCancelRefund, type CancelledBy } from "@core/reservations/cancel-reservation.js";
import { refundableTotalFor, refundedTotalFor } from "@core/reservations/refund-payment.js";
import { zonedWallClockToInstant } from "@core/config/tenant.js";
import { BackLink } from "../../../../../components/ui/back-link";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { readFormDraft } from "../../../../lib/form-draft";
import { isProdDeploy } from "../../../../lib/flags";
import { operatorManageLink } from "../../../../lib/manage-link";
import { liveBookingCode } from "@core/reservations/ensure-booking-code.js";
import { getRepo } from "../../../../lib/repo";
import {
  CalendarControls,
  CalendarGrid,
  CalendarLegend,
  calendarHref,
  loadCalendarData,
  type Search,
} from "../calendar-view";
import {
  ReservationDetailPane,
  actionMessage,
  type PaneActionState,
} from "./reservation-detail-pane";

/**
 * /admin/calendar/[reservationId] (task 12.11 continued, #464) — the reservation detail.
 *
 * Read-only until #616, which adds cancel / refund / resend. Still zero client JS: every
 * action is a `<form>` post, and the cancel confirm step is a query param rather than a
 * dialog, so the whole thing works on a phone with no script running.
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
  /** `Search`, the balance-link round-trip params (11.2b), and the cancel/refund/resend
   *  round-trip params (#616) each action redirects back with. */
  searchParams: Promise<
    Search & {
      balanceUrl?: string;
      balanceErr?: string;
      cancel?: string;
      cancelled?: string;
      cancelErr?: string;
      refunded?: string;
      refundErr?: string;
      refundConfirm?: string;
      resent?: string;
      resendErr?: string;
      /** Present ⇒ the render immediately after a reissue on this booking (#741). Their
       *  PRESENCE reveals the new link on production; their value carries the send outcome. */
      reissued?: string;
      reissueErr?: string;
    }
  >;
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

  // Cancel / refund / resend state (#616). Assembled here rather than inside
  // `buildReservationDetail` because the refund quotes need a CLOCK — how much notice the
  // cancellation gives decides whether the $50 fee applies — and that view model is pure.
  //
  // Xola bookings get NO actions block: their money and their cancellations live in Xola
  // (DEC-105), and a cancel here would be reverted by the next import.
  let actions: PaneActionState | undefined;
  if (reservation.source === "muster") {
    // The manage link, for copying or reading down the phone (#686, gate revised 2026-08-15).
    // Off production: always. On production: only on the render right after a reissue, which is
    // the moment the operator deliberately minted this code and the customer's old one died.
    // See `app/lib/manage-link.ts` for why that trade is the right one now the code is revocable.
    // Built from the trusted APP_BASE_URL, never a Host header (see base-url.ts). This branch is
    // already Muster-only — a Xola booking has no capability URL.
    //
    // `justReissued` reads the reissue action's OWN redirect params, so it cannot be forged into
    // a standing reveal by hand-typing a URL — worst case someone types `?reissued=` and sees the
    // link for one render of a booking they can already fully administer. It also means a reload
    // puts it away.
    //
    // READ-ONLY: shows the live code if there is one, never mints. A page render must not create
    // a credential, and the resend/reissue buttons below are where minting belongs.
    const liveCode = await liveBookingCode(getRepo(), reservation.id, () => new Date().toISOString());
    const justReissued = sp.reissued !== undefined || sp.reissueErr !== undefined;
    const manageUrl = operatorManageLink({
      isProd: isProdDeploy(),
      base: process.env.APP_BASE_URL?.replace(/\/+$/, ""),
      code: liveCode,
      justReissued,
    });
    const detailHref = (extra: Record<string, string>): string => {
      const p = new URLSearchParams();
      if (sp.date) p.set("date", sp.date);
      if (sp.filter) p.set("filter", sp.filter);
      for (const [k, val] of Object.entries(extra)) p.set(k, val);
      const q = p.toString();
      // Same `#booking-actions` anchor the actions redirect to — the confirm-open and
      // back-out links must land in the same place a form post does, or the two routes into
      // the same screen behave differently.
      return `/admin/calendar/${encodeURIComponent(String(reservation.id))}${q ? `?${q}` : ""}#booking-actions`;
    };

    // DEC-032: the departure instant is minted from the vessel-local wall clock, never by
    // parsing `date`+`time` as if they were UTC — which would move the 14-day boundary by
    // four or five hours and silently flip a refund from full to zero at the edge.
    const departureAt = zonedWallClockToInstant(event.date, event.time);
    const now = new Date();
    const quoteFor = (by: CancelledBy): number =>
      quoteCancelRefund({ by, payments, departureAt, now }).refundCents;

    // Stripe's real ceiling. Read before the outcome copy, which needs it: a booking nobody
    // paid for gets no refund box, so the post-cancel message must not promise one.
    const refundable = refundableTotalFor(payments);

    // Which outcome to report, if the last action redirected back with one.
    //
    // **Errors are checked FIRST, and that ordering is load-bearing.** A partial refund
    // redirects with BOTH `refunded=<what moved>` and `refundErr=provider_error`, deliberately,
    // so the operator learns how much actually went back. With success keys first, that landed
    // as the green "Refunded $200.00" — a Stripe failure rendered as a clean success, and the
    // `provider_error` copy written for exactly this case was unreachable. Worse when the FIRST
    // leg fails: "Refunded $0.00 to the card it came from", which is a total failure reported
    // as a completed refund. Found in security review.
    // **`cancelled` outranks `refunded`, and both outrank nothing.** One press can now produce
    // both, so the compound case is the normal one and the cancelled copy reports the money too
    // (see `actionMessage`). Errors still win outright — a partial refund carries `refundErr`
    // AND an amount, and reporting that as a success is the defect security review caught.
    const outcome = (
      ["cancelErr", "refundErr", "resendErr", "cancelled", "refunded", "resent"] as const
    )
      .map((k) => [k, sp[k]] as const)
      .find(([, val]) => val !== undefined);
    // A partial refund failure carries `refunded` alongside `refundErr`; the copy needs both.
    const movedCents = /^\d+$/.test(sp.refunded ?? "") ? Number(sp.refunded) : undefined;
    const message = outcome
      ? actionMessage(outcome[0], outcome[1] ?? "", {
          ...(movedCents !== undefined ? { movedCents } : {}),
          refundableCents: refundable,
          // The resend copy names the address and number it reached (#686). Read off the
          // reservation rather than round-tripped on the query string — a contact detail is
          // prose, and DEC-147 keeps prose out of redirect params.
          ...(reservation.email ? { email: reservation.email } : {}),
          ...(reservation.phone ? { phone: reservation.phone } : {}),
        })
      : undefined;
    const isError = outcome ? outcome[0].endsWith("Err") : false;

    // Prefill: the quote for the reason just chosen if we have just cancelled, otherwise the
    // whole refundable amount. Either way the operator is typing over a number, not into an
    // empty box — "who knows what the refund amount might be" cuts both ways, and a blank
    // field on a money form is its own kind of prompt.
    // What the standalone refund box starts at. After a cancel-and-refund the money has already
    // moved, so the box offers what is STILL refundable rather than re-offering the figure that
    // was just spent — the fastest way to refund the same amount twice is to leave it sitting
    // there looking unspent.
    const prefillCents =
      sp.refunded !== undefined
        ? refundable
        : sp.cancelled !== undefined
          ? Math.min(refundable, quoteFor(sp.cancelled === "operator" ? "operator" : "customer"))
          : refundable;

    /**
     * A refused action's own values (#780).
     *
     * This pane is the one surface that never sets `?err=`: three independent actions share it,
     * so each refuses on its own param (`cancelErr` / `refundErr` / `balanceErr`). A draft read
     * gated on `err` would be written on every refusal here and read on none.
     *
     * Scoped to THIS reservation. `reservationId` is a hidden field on every form in the pane,
     * and the cookie's path (`/admin/calendar`) necessarily covers every booking under it — so
     * without this check a refused refund on one booking would prefill the box on the next one
     * the operator opened, with a money figure they never typed for it.
     */
    const refusalHere =
      sp.cancelErr !== undefined || sp.refundErr !== undefined || sp.balanceErr !== undefined;
    const rawDraft = refusalHere ? await readFormDraft("/admin/calendar") : null;
    const draft =
      rawDraft && rawDraft.get("reservationId") === String(reservation.id) ? rawDraft : null;

    actions = {
      date: sp.date ?? "",
      filter: sp.filter ?? "",
      cancelHref: detailHref({ cancel: "1" }),
      backHref: detailHref({}),
      confirmingCancel: sp.cancel === "1",
      quoteCustomerCents: quoteFor("customer"),
      quoteOperatorCents: quoteFor("operator"),
      refundableCents: refundable,
      refundedTotalCents: refundedTotalFor(payments),
      // The operator's own figure wins over the prefill — see the draft note above.
      refundPrefill: draft?.get("amount") ?? (prefillCents / 100).toFixed(2),
      // Which cancellation reason was chosen. Not `??`: a radio group posts exactly one value,
      // so its absence means "no draft", never "none picked".
      cancelBy: draft?.get("by") === "operator" ? "operator" : "customer",
      // `?refundConfirm=<cents>` is the two-step's second screen. Validated by `startRefund`
      // before the redirect, but re-checked here: the query string is user-editable, and a
      // hand-typed value must not reach a confirm screen that would then move that money.
      ...(/^\d+$/.test(sp.refundConfirm ?? "") &&
      Number(sp.refundConfirm) > 0 &&
      Number(sp.refundConfirm) <= refundable
        ? { confirmingRefundCents: Number(sp.refundConfirm) }
        : {}),
      refundBackHref: detailHref({}),
      canResend: Boolean(reservation.email || reservation.phone),
      // Off-production only (#686), and only for a Muster booking — a Xola reservation has no
      // capability URL at all (DEC-122). Built from the trusted APP_BASE_URL, never a Host
      // header; unset env simply means no link rather than a wrong one.
      ...(manageUrl ? { manageUrl, justReissued } : {}),
      needsRelease:
        reservation.status === "cancelled" &&
        event.source === "muster" &&
        event.status === "scheduled",
      ...(message && !isError ? { done: message } : {}),
      ...(message && isError ? { error: message } : {}),
    };
  }

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
            {...(actions ? { actions } : {})}
          />
        </aside>
      </div>

      <VersionTag />
    </Shell>
  );
}
