/**
 * Customer "Your booking" manage page (Phase 12.6, #459) — the capability-URL landing (DEC-122).
 * One page, two states driven by trip time (`buildManageView`): **upcoming** (trip · balance ·
 * manage actions) and **completed** (post-trip tip · receipt). Bearer token, no login — the
 * shared `loadVerifiedBooking` guards page + actions + calendar identically.
 *
 * Re-expresses the "Your booking" mockup in Muster tokens (DEC-021). Customer-facing rules the
 * mockup settled (2026-07-17): the BOAT is never named (crew are, once assigned); "Message us"
 * reaches the operator, never crew. Cancel/change are option (b) — a request emailed to the
 * operator; self-service cancel/refund is deferred (#472 + Flex wiring). Deferred here and
 * flagged: crew NAMES (view model gives counts), the guest waiver roster (no per-attendee
 * roster, DEC-110), leave-a-review, email-receipt.
 */
import { TENANT_TIMEZONE, vesselClockOf, vesselDateOf } from "@core/config/tenant.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { formatClock, formatShortDay } from "@core/reservations/availability-screen.js";
import { buildManageView } from "@core/reservations/manage-view.js";
import { CANCELLATION_TERMS } from "@core/reservations/refund-terms.js";
import { AppLink } from "../../../components/ui/app-link";
import { Notice } from "../../../components/ui/notice";
import { SubmitButton } from "../../../components/ui/submit-button";
import { addPostTip, requestBookingChange } from "./actions";
import { loadBookingByCode } from "./load";
import { reservationsEnabled } from "../../lib/flags";

export const dynamic = "force-dynamic";

type Search = { requested?: string; tipped?: string; error?: string };

const ERROR_COPY: Record<string, string> = {
  link: "That didn’t work — please reopen your booking link.",
  tip: "Couldn’t start the tip just now. Please try again.",
  pay: "Tips are temporarily unavailable. Please try again later.",
};

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  if (!reservationsEnabled()) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">Reservations are off</h1>
      </main>
    );
  }

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
          Your booking is still there — this particular link just doesn’t open it any more. Reply to
          your confirmation text or email and we’ll send you a new one.
        </p>
      </main>
    );
  }

  if (load.kind === "unknown") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-2 text-xl font-semibold">This booking link isn’t valid</h1>
        <p className="text-muted">
          The link may be incomplete or mistyped. Check the text or email we sent you, or{" "}
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
  const taxAndFees = m.taxCents + serviceFeeCents;
  const cancelled = detail.status === "cancelled";
  const statusLabel = cancelled ? "Cancelled" : phase === "completed" ? "Completed" : "Confirmed";

  return (
    <main className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-8">
      <div className="overflow-hidden rounded-[18px] border border-line bg-card shadow-sm">
        {/* header */}
        <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Your booking
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                cancelled
                  ? "bg-bad-bg text-bad"
                  : phase === "completed"
                    ? "bg-ok-bg text-ok"
                    : "bg-accent/10 text-accent"
              }`}
            >
              {statusLabel}
            </span>
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
          {sp.tipped === "1" && (
            <div className="mb-4">
              <Notice tone="ok">Thank you — your crew tip is on its way to the crew.</Notice>
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

          <p className="mb-5 rounded-[9px] border border-line bg-bg px-3 py-2 text-[12.5px] text-muted">
            <b className="text-ink">Save this link</b> — it’s how you manage your booking. We texted and emailed it to
            you too.
          </p>

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

          {/* money */}
          <Section title={phase === "completed" ? "Receipt" : "Payment"}>
            {m.priceKnown ? (
              <>
                <Row label={`Fare — ${detail.offeringName ?? "your cruise"}`} value={formatCents(m.fareCents)} mono />
                {m.gratuityCents > 0 && <Row label="Tip · 100% to crew" value={formatCents(m.gratuityCents)} mono />}
                <Row label="Tax + service fee" value={formatCents(taxAndFees)} mono />
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
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Your receipt will appear here once payment settles.</p>
            )}
          </Section>

          {/* post-trip tip — offered both states (DEC-124 post kind); prominent after the trip */}
          {!cancelled && view.postTipTiers.length > 0 && (
            <Section title={phase === "completed" ? "Add a little more for your crew?" : "Add a tip for your crew"}>
              <p className="mb-3 text-[12.5px] text-muted">100% goes to the crew running your boat.</p>
              <form action={addPostTip} className="flex flex-wrap gap-2">
                <input type="hidden" name="code" value={code} />
                {view.postTipTiers.map((tier) => (
                  <SubmitButton
                    key={tier.bps}
                    name="bps"
                    value={String(tier.bps)}
                    className="flex-1 rounded-[11px] border border-line bg-card px-3 py-2.5 text-center hover:border-accent"
                    aria-label={`Add a ${tier.pct}% tip (${formatCents(tier.amountCents)})`}
                  >
                    <div className="text-[15px] font-bold">+{tier.pct}%</div>
                    <div className="font-mono text-[12px] text-muted">{formatCents(tier.amountCents)}</div>
                  </SubmitButton>
                ))}
              </form>
            </Section>
          )}

          {/* manage actions */}
          {!cancelled && (
            <Section title="Manage">
              <a
                href={`/b/${code}/calendar`}
                className="flex items-center gap-2 border-b border-line-soft py-3 text-[13.5px] font-semibold text-accent"
              >
                📅 Add to calendar
              </a>
              <AppLink
                href={detail.offeringId ? `/book?offering=${encodeURIComponent(detail.offeringId)}` : "/book"}
                className="flex items-center gap-2 border-b border-line-soft py-3 text-[13.5px] font-semibold text-accent"
              >
                ⟲ Book again
              </AppLink>

              {/* Option (b): request cancel/change — emailed to the operator (self-service is #616;
                  the terms it will enforce are `refund-terms.ts`, rendered below since #619). */}
              <details className="border-b border-line-soft py-3">
                <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-accent">
                  ↻ Request a date/time change
                </summary>
                <RequestForm code={code} kind="change" placeholder="Any preferred dates or times?" />
              </details>
              <details className="py-3">
                <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-bad">
                  ✕ Request cancellation
                </summary>
                <RequestForm code={code} kind="cancel" placeholder="Anything we should know? (optional)" />
              </details>
              <p className="pt-2 text-[11.5px] text-faint" data-testid="cancellation-terms">
                {CANCELLATION_TERMS}
              </p>
              <p className="pt-2 text-[11.5px] text-faint">
                Cancellations and changes are handled by our team — we’ll confirm by text or email.
              </p>
            </Section>
          )}

          {/* past trips */}
          {booking.pastTrips.length > 0 && (
            <Section title="Your other trips">
              {booking.pastTrips.map((p) => {
                const label = (
                  <>
                    <span>
                      {formatShortDay(p.date)} · {formatClock(p.time)}
                    </span>
                    <span className={`text-[12px] font-semibold ${p.status === "cancelled" ? "text-faint" : "text-muted"}`}>
                      {p.status === "cancelled" ? "Cancelled" : "Trip"}
                      {p.href ? " ›" : ""}
                    </span>
                  </>
                );
                const row = "flex items-center justify-between border-b border-line-soft py-2.5 text-[13px] last:border-0";
                // No live code for that booking (imported, or pre-#741) ⇒ it still LISTS, it just
                // isn't a link. Rendering a link that lands on "isn't valid" is worse than none.
                return p.href ? (
                  <AppLink key={p.reservationId} href={p.href} spinner="none" className={row}>
                    {label}
                  </AppLink>
                ) : (
                  <div key={p.reservationId} className={row}>
                    {label}
                  </div>
                );
              })}
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">{title}</h2>
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

function RequestForm({ code, kind, placeholder }: { code: string; kind: "cancel" | "change"; placeholder: string }) {
  return (
    <form action={requestBookingChange} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="kind" value={kind} />
      <textarea
        name="note"
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        className="w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-[13px] text-ink placeholder:text-faint"
      />
      <SubmitButton
        className={`self-start rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white ${kind === "cancel" ? "bg-bad" : "bg-accent"}`}
      >
        Send request
      </SubmitButton>
    </form>
  );
}
