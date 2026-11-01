/**
 * Customer "Your booking" manage page (Phase 12.6, #459) — the capability-URL landing (DEC-122).
 * One page, two states driven by trip time (`buildManageView`): **upcoming** (trip · balance ·
 * manage actions) and **completed** (post-trip tip · receipt). Bearer token, no login — the
 * shared `loadVerifiedBooking` guards page + actions + calendar identically.
 *
 * Re-expresses the "Your booking" mockup in Muster tokens (DEC-021). Customer-facing rules the
 * mockup settled (2026-07-17): the BOAT is never named (crew are, once assigned); "Message us"
 * reaches the operator, never crew. A date/time change is a request emailed to the operator. A
 * cancel the published terms refund is the customer's own action (16.9, issue #1074, `?cancel=1` →
 * a two-step confirm); inside the window, or at a $0 refund, it stays a request. Deferred here and
 * flagged: crew NAMES (view model gives counts), the guest waiver roster (no per-attendee
 * roster, DEC-110), leave-a-review, email-receipt.
 */
import { ensureTripLink, tripDayOver } from "@core/checkin/trip-link.js";
import { vesselClockOf, vesselDateOf } from "@core/config/tenant.js";
import type { EventId } from "@core/domain/ids.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { buildManageView } from "@core/reservations/manage-view.js";
import { customerCancelQuote, manageHref, type CustomerCancelQuote } from "@core/reservations/customer-cancel.js";
import { cancellationTerms, dollars } from "@core/reservations/refund-terms.js";
import { hasFlex } from "@core/reservations/booking-invoice.js";
import { flexChargedCents } from "@core/reservations/discount.js";
import { AppLink } from "../../../components/ui/app-link";
import { Notice } from "../../../components/ui/notice";
import { Badge } from "../../../components/ui/badge";
import { SubmitButton } from "../../../components/ui/submit-button";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";
import { cancelFromManagePage, requestBookingChange } from "./actions";
import { loadBookingByCode, loadCancelledFigure } from "./load";
import { Textarea } from "../../../components/ui/input";
import { Card, Well } from "../../../components/ui/card";

export const dynamic = "force-dynamic";

type Search = { requested?: string; error?: string; cancel?: string; cancelled?: string };

const ERROR_COPY: Record<string, React.ReactNode> = {
  link: "That didn’t work — please reopen your booking link.",
  cancel_changed: (
    <>
      <b>The refund changed since you opened this.</b> Here’s the new figure — nothing has been cancelled.
    </>
  ),
  cancel_closed: (
    <>
      <b>It’s too close to your trip to cancel online now.</b> Nothing has been cancelled — send us a request below
      and our team will help.
    </>
  ),
  cancel_failed: (
    <>
      <b>Couldn’t cancel just now.</b> Nothing changed — try again in a moment.
    </>
  ),
};

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const load = await loadBookingByCode(code);

  // A code that resolved but is dead gets its own state (DEC-154). Whoever holds it already knew
  // the booking existed, so this leaks nothing — and without it, a customer whose link was
  // reissued reads "isn't valid" and concludes their booking is gone rather than asking for the
  // new link. The generic state below still never confirms a booking exists.
  if (load.kind === "refused") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-2 text-xl font-semibold">
          {load.reason === "revoked" ? "This booking link was replaced" : "This booking link has expired"}
        </h1>
        <p className="text-muted">
          Your booking is still there — this particular link just doesn’t open it any more. Click
          the button below and we’ll send you a new one.
        </p>
        {/* A BUTTON, not an inline link (operator, 2026-08-15). This is the only thing to do on
            this page, and an underlined phrase in the middle of a sentence reads as explanation
            rather than as the way out — the customer is already confused about why their link
            stopped working. Sized to its label rather than the column (operator, same day); still
            44px tall, which is the part that matters at 375px. */}
        <div className="mt-5 flex justify-center">
          <AppLink
            href="/b/find"
            className="btn-primary min-h-[44px]"
          >
            Send me a new link
          </AppLink>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">
          Or reply to your confirmation text and we’ll sort it out.
        </p>
      </main>
    );
  }

  if (load.kind === "unknown") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-2 text-xl font-semibold">This booking link isn’t valid</h1>
        <p className="text-muted">
          The link may be incomplete or mistyped. Check the text or email we sent you,{" "}
          <AppLink href="/b/find" className="text-accent">
            have your link sent again
          </AppLink>
          , or{" "}
          <AppLink href="/book" className="text-accent">
            start a new booking
          </AppLink>
          .
        </p>
      </main>
    );
  }

  const booking = load.booking;

  const now = new Date();
  const view = buildManageView({
    reservation: booking.reservation,
    event: booking.event,
    offering: booking.offering,
    vessel: booking.vessel,
    payments: booking.payments,
    gratuities: booking.gratuities,
    taxRateBps: booking.taxRateBps,
    ...(booking.shift ? { shift: booking.shift } : {}),
    now: { date: vesselDateOf(now), time: vesselClockOf(now) },
  });
  const { detail, timing, phase } = view;
  const m = detail.money;
  const serviceFeeCents = booking.payments.reduce((s, p) => s + (p.serviceFeeCents ?? 0), 0);
  // One link per payment that HAS a hosted receipt (#679) — a deposit booking later collects a
  // balance, so this is a list rather than a single link. Payments with no `receiptUrl` drop out
  // entirely: pre-#679 rows, and any whose lookup failed at webhook time.
  const receiptLinks = booking.payments
    .filter((p) => p.receiptUrl !== undefined)
    .map((p) => ({ id: String(p.id), url: p.receiptUrl!, amountCents: p.amountCents }));
  const taxAndFees = m.taxCents + serviceFeeCents;
  const insured = hasFlex(booking.reservation.invoice);
  const cancelled = detail.status === "cancelled";
  // Cancel is offered only when the terms refund something (16.9); otherwise the request form stays.
  const cancelQuote = cancelled
    ? null
    : customerCancelQuote({
        reservation: booking.reservation,
        event: booking.event,
        payments: booking.payments,
        now,
      });
  // The notice (which one, and its figure) is the trail's, never the URL's: `?cancelled=1` only says to
  // look. Read only once a cancel is claimed.
  const cancelledNotice = cancelled && sp.cancelled === "1" ? await loadCancelledFigure(booking) : null;
  // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
  const statusLabel = cancelled ? "Cancelled" : phase === "completed" ? "Completed" : "Confirmed";
  const waivers =
    cancelled || booking.event.status === "cancelled" ? null : await waiverLinks(booking.event.id, booking.event.date);

  return (
    <main className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-8">
      <Card pad="none" className="overflow-hidden">
        {/* header */}
        <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Your booking
            </span>
            <Badge
              tone={
                cancelled
                  ? "bad"
                  // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
                  : phase === "completed"
                    ? "ok"
                    : "accent"
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <h1 className="mt-1.5 text-[19px] font-semibold">{detail.offeringName ?? "Your cruise"}</h1>
          <div className="mt-0.5 text-[12.5px] text-muted">{detail.customerName}</div>
        </div>

        <div className="px-5 py-4">
          {sp.error && ERROR_COPY[sp.error] && (
            <div className="mb-4">
              <Notice tone="bad">{ERROR_COPY[sp.error]}</Notice>
            </div>
          )}
          {cancelledNotice !== null && (
            <div className="mb-4">
              {cancelledNotice.kind === "issued" ? (
                <Notice tone="ok">
                  <b>Your booking is cancelled.</b> {formatCents(cancelledNotice.cents)} is on its way back to your card.
                </Notice>
              ) : (
                <Notice tone="bad">
                  <b>Your booking is cancelled, but your {formatCents(cancelledNotice.cents)} refund didn’t go through yet.</b>{" "}
                  Our team has been told and will send it.
                </Notice>
              )}
            </div>
          )}
          {sp.requested && (
            <div className="mb-4">
              <Notice tone="ok">
                Got it — we’ve sent your {sp.requested === "cancel" ? "cancellation" : "change"} request to the team and
                we’ll be in touch shortly.
              </Notice>
            </div>
          )}

          <Well as="p" className="mb-5 text-[12.5px] text-muted">
            <b className="text-ink">Save this link</b> — it’s how you manage your booking. We texted and emailed it to
            you too.
          </Well>

          {/* trip */}
          <Section title="Your trip">
            <Row label={formatShortDay(detail.date)} value={timing.startLabel} strong />
            {timing.backByLabel && (
              <Row
                label="On the water"
                value={`${view.timing.durationMinutes ? `${Math.floor(view.timing.durationMinutes / 60)}h ${view.timing.durationMinutes % 60}min` : ""} · back by ${timing.backByLabel}`}
              />
            )}
            {booking.location?.name && (
              <Row
                label="Location"
                value={
                  booking.location.pickupLink ? (
                    <a href={booking.location.pickupLink} className="text-accent" target="_blank" rel="noopener noreferrer">
                      {booking.location.name} · directions
                    </a>
                  ) : (
                    booking.location.name
                  )
                }
              />
            )}
            {timing.arriveByLabel && <Row label="Arrive by" value={`${timing.arriveByLabel} (a little early)`} />}
            {/* Crew NAMES are deferred (the view model gives counts, not names, #459 follow-up);
                the boat is never named to the customer (mockup rule). */}
            <Row
              label="Your crew"
              value={detail.crew && detail.crew.filled > 0 ? "Your captain + mate are assigned" : "Your captain + mate show here once assigned"}
            />
            <Row label="Guests" value={`${detail.guestCount} — whole boat`} />
          </Section>

          {/* waivers (18.10) — the booker signs here, then shares from the signing page's success
              screen; the party page shows who has. No section on a cancelled trip or with no waiver
              in effect; once the trip's day is over, only who signed. */}
          {waivers && (
            <Section title="Waivers" named>
              {waivers.signHref && (
                <>
                  <p className="pb-1 text-[12.5px] text-muted">Everyone aboard signs before the trip.</p>
                  <AppLink
                    href={waivers.signHref}
                    className="btn-quiet flex items-center gap-2 border-b border-line-soft py-3 text-[13.5px]"
                  >
                    ✍ Sign the waiver ›
                  </AppLink>
                </>
              )}
              <AppLink
                href={`/b/${code}/party`}
                className="btn-quiet flex items-center gap-2 py-3 text-[13.5px]"
              >
                See who’s signed ›
              </AppLink>
            </Section>
          )}

          {/* money */}
          <Section title={phase === "completed" ? "Receipt" : "Payment"}>
            {m.priceKnown ? (
              <>
                <Row label={`Fare — ${detail.offeringName ?? "your cruise"}`} value={formatCents(m.fareCents)} mono />
                {m.gratuityCents > 0 && <Row label="Tip · 100% to crew" value={formatCents(m.gratuityCents)} mono />}
                <Row label="Tax + service fee" value={formatCents(taxAndFees)} mono />
                {/* Cancellation insurance (16.8): what was charged for it, off the frozen invoice —
                    so a comp that took it to $0 still shows the booking has it. */}
                {insured && (
                  <Row label="Cancellation insurance" value={formatCents(flexChargedCents(booking.reservation.invoice!))} mono />
                )}
                {view.paidInFull ? (
                  <Row label="Paid in full" value={formatCents(m.paidCents)} mono strong />
                ) : (
                  <>
                    <Row label="Paid so far" value={formatCents(m.paidCents)} mono />
                    {/* "charged" promised an automatic collection that does not exist — nothing in
                        Muster reads `balanceDueDaysBeforeEvent` on a schedule (#617; #712 is the
                        unbuilt auto-collect). The obligation is real; the mechanism is a link the
                        operator sends, so the label states the first and claims nothing about the second. */}
                    {m.balanceCents > 0 && (
                      <Row label="Balance · due before your trip" value={formatCents(m.balanceCents)} mono strong />
                    )}
                  </>
                )}
                {m.refundedCents > 0 && <Row label="Refunded" value={`−${formatCents(m.refundedCents)}`} mono />}
                {/* Stripe's own hosted receipt (#679) — the itemised, printable one, and the only
                    copy a guest who gave no email will ever have. Safe to show: `pay.stripe.com`,
                    not the dashboard. Absent on pre-#679 bookings and on any payment whose receipt
                    lookup failed, so this renders nothing rather than a dead link. */}
                {receiptLinks.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {receiptLinks.map((r) => (
                      <a
                        key={r.id}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12.5px] text-accent underline underline-offset-2"
                      >
                        {receiptLinks.length > 1
                          ? `View Stripe receipt — ${formatCents(r.amountCents)}`
                          : "View Stripe receipt"}
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Your receipt will appear here once payment settles.</p>
            )}
          </Section>

          {/* manage actions */}
          {!cancelled && (
            <Section title="Manage">
              <a
                href={`/b/${code}/calendar`}
                className="btn-quiet flex items-center gap-2 border-b border-line-soft py-3 text-[13.5px]"
              >
                📅 Add to calendar
              </a>
              <AppLink
                href={detail.offeringId ? `/book?offering=${encodeURIComponent(detail.offeringId)}` : "/book"}
                className="btn-quiet flex items-center gap-2 border-b border-line-soft py-3 text-[13.5px]"
              >
                ⟲ Book again
              </AppLink>

              {/* A date/time change is always a request, emailed to the operator. */}
              <details className="border-b border-line-soft py-3">
                <summary className="btn-quiet list-none text-[13.5px]">
                  ↻ Request a date/time change
                </summary>
                <RequestForm code={code} kind="change" placeholder="Any preferred dates or times?" />
              </details>
              {/* Cancel: the customer's own action when the terms refund something (16.9), else the
                  request form — the "call us" path. The terms it enforces are `refund-terms.ts`. */}
              {cancelQuote ? (
                <CancelRow
                  code={code}
                  quote={cancelQuote}
                  confirming={sp.cancel === "1"}
                  date={booking.event.date}
                  time={booking.event.time}
                />
              ) : (
                <details className="py-3">
                  <summary className="btn-quiet list-none text-[13.5px] text-bad">
                    ✕ Request cancellation
                  </summary>
                  <RequestForm code={code} kind="cancel" placeholder="Anything we should know? (optional)" />
                </details>
              )}
              <p className="pt-2 text-[11.5px] text-muted" data-testid="cancellation-terms">
                {cancellationTerms(insured)}
              </p>
              <p className="pt-2 text-[11.5px] text-muted">
                {cancelQuote ? "Changes" : "Cancellations and changes"} are handled by our team — we’ll confirm by text
                or email.
              </p>
            </Section>
          )}

          {/* past trips */}
          {booking.pastTrips.length > 0 && (
            <Section title="Your other trips">
              {/* Plain rows, never links: a link would carry that booking's own code, so one booking's
                  code would open the contact's others (DEC-198, issue #1213). */}
              {booking.pastTrips.map((p) => (
                <div
                  key={p.reservationId}
                  className="flex items-center justify-between border-b border-line-soft py-2.5 text-[13px] last:border-0"
                >
                  <span>
                    {formatShortDay(p.date)} · {formatClock(p.time)}
                  </span>
                  <span className="text-[12px] font-semibold text-muted">
                    {p.status === "cancelled" ? "Cancelled" : "Trip"}
                  </span>
                </div>
              ))}
            </Section>
          )}
        </div>
      </Card>
    </main>
  );
}

/**
 * The Waivers section's links (18.10, issue #1124), or null for no section: none while no waiver is
 * in effect, since nobody could sign. The sign link is the departure's trip link, made the first
 * time it is needed (the party page's rule) and dropped once the trip's day is over. Best-effort:
 * a failure costs the sign link or the section, never the booking page.
 */
async function waiverLinks(eventId: EventId, eventDate: string): Promise<{ signHref: string | null } | null> {
  const now = new Date().toISOString();
  try {
    const repo = getRepo();
    if (!(await repo.getCurrentWaiverTemplate(now))) return null;
    if (tripDayOver(eventDate, now)) return { signHref: null };
    try {
      return { signHref: `/w/${await ensureTripLink(repo, eventId, () => new Date().toISOString())}` };
    } catch (e) {
      logSwallowed("b/[code]:waivers", e, "the manage page had no trip link to sign with");
      return { signHref: null };
    }
  } catch (e) {
    logSwallowed("b/[code]:waivers", e, "the manage page could not tell whether a waiver is in effect");
    return null;
  }
}

function Section({ title, named, children }: { title: string; named?: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0" {...(named ? { "aria-label": title } : {})}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={`text-right ${mono ? "font-mono " : ""}${strong ? "font-semibold text-ink" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

/** Row 4 of the Manage section when Cancel is offered: the link, or — at `?cancel=1` — the confirm. */
function CancelRow({
  code,
  quote,
  confirming,
  date,
  time,
}: {
  code: string;
  quote: CustomerCancelQuote;
  confirming: boolean;
  date: string;
  time: string;
}) {
  if (confirming) return <CancelConfirm code={code} quote={quote} date={date} time={time} />;
  return (
    <AppLink href={manageHref(code, { cancel: "1" })} className="btn-quiet flex items-center gap-2 py-3 text-[13.5px] text-bad">
      ✕ Cancel booking
    </AppLink>
  );
}

/** What the refund is net of: the $50, the insurance, or — a comped insurance — nothing. */
function keptLine(quote: CustomerCancelQuote): string {
  if (quote.basis === "fee") return `That’s what you paid, less the ${dollars(quote.keptCents)} cancellation fee.`;
  if (quote.keptCents > 0) return `That’s what you paid, less the ${dollars(quote.keptCents)} cancellation insurance.`;
  return "That’s everything you paid.";
}

/**
 * "✕ Cancel booking" → this confirm → a form post (16.9, issue #1074). The payment link's two-step
 * (`app/(public)/p/[token]/page.tsx`): no client JS, `?cancel=1` opens it in place. It posts the
 * figure it shows and the refunded-so-far token, so `cancelFromManagePage` can refuse by name if
 * either has moved since this rendered.
 */
function CancelConfirm({
  code,
  quote,
  date,
  time,
}: {
  code: string;
  quote: CustomerCancelQuote;
  date: string;
  time: string;
}) {
  return (
    <form action={cancelFromManagePage} className="flex flex-col gap-2 py-3" data-testid="manage-cancel-confirm">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="quotedCents" value={quote.refundCents} />
      <input type="hidden" name="expectedRefunded" value={quote.expectedRefundedCents} />
      <p className="text-sm font-medium text-ink">
        Cancel your {formatClock(time)} trip on {formatShortDay(date)}?
      </p>
      <p className="text-[13px] text-muted">
        <b className="text-ink">You’ll get {formatCents(quote.refundCents)} back to your card.</b>{" "}
        {keptLine(quote)}
      </p>
      <p className="text-[13px] text-muted">This can’t be undone.</p>
      <div className="flex gap-2">
        <SubmitButton className="btn-danger min-h-[44px] flex-1">Cancel booking</SubmitButton>
        <AppLink href={manageHref(code)} className="btn-secondary min-h-[44px] flex-1">
          Keep it
        </AppLink>
      </div>
    </form>
  );
}

function RequestForm({ code, kind, placeholder }: { code: string; kind: "cancel" | "change"; placeholder: string }) {
  return (
    <form action={requestBookingChange} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="kind" value={kind} />
      <Textarea
        name="note"
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        className="w-full"
      />
      <SubmitButton
        className={kind === "cancel" ? "self-start btn-danger" : "self-start btn-primary"}
      >
        Send request
      </SubmitButton>
    </form>
  );
}
