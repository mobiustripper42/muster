/**
 * The payment link, `/p/<link>` (issue #1082 part B, SPEC §2.10.6) — where a customer pays for a
 * trip the operator booked by phone.
 *
 * **Built from the checkout's own pieces** (`/book/checkout`): the same card shell and header, the
 * same hero and "Your trip" card, and `CheckoutForm` in pay mode — the card, the summary, the
 * cancellation-terms box and the pay bar. What differs is only what a phone booking already has:
 * no ‹ (there's no picker to go back to), no Change (the operator set the trip), who it's for is
 * shown rather than asked, and the money is the invoice frozen at booking with its tip fixed.
 *
 * **Every state but "payable" is a sentence and a way on**, never the form: an expired or tampered
 * link, a paid trip, a cancelled one. None of them creates a payment intent — only the pay action
 * does, and it re-verifies the link itself.
 *
 * **A paid trip does NOT redirect to `/b/<code>`** (operator, 2026-09-29). The payment link is a
 * 72-hour address that may have been forwarded; the booking link is the durable credential. So a
 * paid trip names where the booking link went and offers `/b/find` for a lost one.
 *
 * The cancel is a no-JS two-step like the operator's pane: `?cancel=1` opens the confirm, and a form
 * post ends the booking. The cancelled card is the same right after and on any later visit.
 */
import type { Location, Offering, Reservation } from "@core/domain/entities.js";
import { formatPhoneForDisplay, type CanonicalPhone } from "@core/customers/identity.js";
import { formatClock, formatDuration, formatShortDay } from "@core/reservations/availability-screen.js";
import { maskedPhone, payLinkMoney, payLinkState } from "@core/reservations/pay-by-link.js";
import { CANCELLATION_TERMS } from "@core/reservations/refund-terms.js";
import { stripTrailingSlashes } from "@core/config/base-url.js";
import { LockedWhilePaying, PaymentLockProvider } from "../../../../components/checkout/payment-lock";
import { AppLink } from "../../../../components/ui/app-link";
import { Notice } from "../../../../components/ui/notice";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { checkPaymentLink } from "../../../lib/payment-link";
import { getRepo } from "../../../lib/repo";
import { TENANT_NAME } from "../../../lib/tenant";
import { logSwallowed } from "../../../lib/swallowed";
import { CheckoutForm } from "../../book/checkout/checkout-form";
import { cancelFromPaymentLink } from "./actions";
import { Card } from "../../../../components/ui/card";
import { Recap } from "../../../../components/checkout/recap";

export const dynamic = "force-dynamic";

type Search = { cancel?: string; cancelErr?: string };

/** Decode the path segment, tolerating a malformed `%` — it is a URL a person can type. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
    // NOT a fault (#854): a stray `%` is bad input with a defined answer — the expired page.
    // eslint-disable-next-line muster/bare-catch -- malformed URL input, not a fault
  } catch {
    return segment;
  }
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Search>;
}) {
  const token = safeDecode((await params).token);
  const sp = await searchParams;

  const link = checkPaymentLink(token);
  if (!link.ok) return <Expired />;

  let reservation: Reservation | null;
  let offering: Offering | null = null;
  let location: Location | null = null;
  try {
    const repo = getRepo();
    reservation = await repo.getReservation(link.reservationId);
    offering = reservation?.offeringId ? await repo.getOffering(reservation.offeringId) : null;
    location = offering?.locationId ? await repo.getLocation(offering.locationId) : null;
  } catch (e) {
    // The last screen before money moves, for a customer the operator is waiting on.
    logSwallowed("pay", e, "the payment page did not load — the customer could not pay");
    return (
      <Shell>
        <Notice tone="bad">Couldn&rsquo;t load this payment page. Please try again in a moment.</Notice>
      </Shell>
    );
  }

  const state = payLinkState(reservation);
  if (state.kind === "missing") return <Expired />;
  if (state.kind === "cancelled") return <Cancelled reservation={state.reservation} />;
  if (state.kind === "paid") return <Paid reservation={state.reservation} />;

  const r = state.reservation;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey || !r.invoice || !r.date || !r.time) {
    // A payable row always carries its invoice and slot (DEC-164); a missing key is a deploy
    // problem. Either way the customer can't pay here, and must not be shown a form that says
    // they can.
    if (!publishableKey) logSwallowed("pay", new Error("no publishable key"), "the payment form can't load");
    return (
      <Shell>
        <Notice tone="bad">
          Payment isn&rsquo;t available on this page right now. Nothing has been charged — please let{" "}
          {TENANT_NAME} know.
        </Notice>
      </Shell>
    );
  }

  const { money, tip } = payLinkMoney(r.invoice);
  const guests = r.partySize ?? 0;
  const durationLabel = formatDuration(r.tripMinutes ?? offering?.tripLengthMinutes);
  const phone = r.phone ?? "";
  const base = stripTrailingSlashes(process.env.APP_BASE_URL || "http://localhost:3000");

  return (
    <main className="min-h-screen bg-bg px-3 py-6 sm:px-4 sm:py-8">
      <PaymentLockProvider>
        <Card pad="none" className="mx-auto flex w-full max-w-[560px] flex-col overflow-hidden">
          {/* header — the checkout's, with no ‹: there is no picker behind this page */}
          <div className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <b className="truncate text-[13.5px] font-semibold">Pay for your trip</b>
              <span className="text-[11.5px] text-muted">Private charter</span>
            </div>
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold text-ok">🔒 Secure</span>
          </div>

          <div className="flex flex-col overflow-y-auto">
            {/* hero */}
            <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-[18px] py-4">
              <h1 className="text-[19px] font-semibold tracking-[-0.01em]">{offering?.name ?? "Your charter"}</h1>
              <div className="mt-1 text-[12.5px] text-muted">
                {[location?.name, durationLabel && `${durationLabel} on the water`].filter(Boolean).join(" · ")}
              </div>
            </div>

            {/* your trip — set by the operator, so no Change */}
            <div className="px-[18px] pt-4">
              <Recap label="Your trip" data-testid="pay-trip">
                <b className="font-semibold">
                  {formatShortDay(r.date)} · {formatClock(r.time)}
                </b>
                <span className="text-muted">
                  {" "}
                  · {guests} {guests === 1 ? "guest" : "guests"}
                </span>
              </Recap>
            </div>

            <CheckoutForm
              publishableKey={publishableKey}
              returnUrl={`${base}/book/success`}
              money={money}
              tiers={[tip]}
              defaultBps={tip.bps}
              cancellationTerms={CANCELLATION_TERMS}
              pay={{
                token,
                bookedFor: {
                  name: r.customerName,
                  phone,
                  phoneLabel: phone ? formatPhoneForDisplay(phone as CanonicalPhone) : "",
                  email: r.email,
                },
              }}
            />

            {/* Locked with the form while a payment is in flight: nobody cancels mid-charge. */}
            <LockedWhilePaying className="border-t border-line px-[18px] py-4">
              <CancelBooking token={token} r={r} confirming={sp.cancel === "1"} failed={sp.cancelErr !== undefined} />
            </LockedWhilePaying>
          </div>
        </Card>
      </PaymentLockProvider>
    </main>
  );
}

/** "Can't make it? Cancel this booking" → the confirm → a form post. Nothing has been charged. */
function CancelBooking({
  token,
  r,
  confirming,
  failed,
}: {
  token: string;
  r: Reservation;
  confirming: boolean;
  failed: boolean;
}) {
  const here = `/p/${encodeURIComponent(token)}`;
  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        {failed ? <Notice tone="bad">Couldn&rsquo;t cancel just now. Nothing changed — try again in a moment.</Notice> : null}
        <AppLink href={`${here}?cancel=1`} className="btn-quiet self-start text-[13px]">
          Can&rsquo;t make it? Cancel this booking
        </AppLink>
      </div>
    );
  }
  return (
    <form action={cancelFromPaymentLink} className="flex flex-col gap-2" data-testid="pay-cancel-confirm">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm font-medium text-ink">
        Cancel your {formatClock(r.time!)} trip on {formatShortDay(r.date!)}? Nothing has been charged.
      </p>
      <div className="flex gap-2">
        <SubmitButton className="btn-danger min-h-[44px] flex-1">Cancel booking</SubmitButton>
        <AppLink href={here} className="btn-secondary min-h-[44px] flex-1">
          Keep it
        </AppLink>
      </div>
    </form>
  );
}

/**
 * Cancelled, by the customer here or by the operator: the "You're booked!" card from `/book/success`,
 * same shape and sizes, in a plain band with ✕ — ending a trip isn't a celebration and isn't an
 * error either (operator, 2026-09-29). The same card whenever the link is opened after.
 */
function Cancelled({ reservation: r }: { reservation: Reservation }) {
  const when = r.date && r.time ? `Your ${formatClock(r.time)} trip on ${formatShortDay(r.date)}` : "Your trip";
  return (
    <Shell>
      <Card data-testid="pay-state" pad="none" className="overflow-hidden">
        <div className="border-b border-line px-6 py-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg text-2xl text-muted">
            ✕
          </div>
          <h1 className="text-[22px] font-semibold">Booking cancelled</h1>
          <p className="mt-1.5 text-[13px] text-muted">{when} has been cancelled.</p>
        </div>
        <div className="px-6 py-6 text-[13.5px] text-muted">
          <p>
            <b className="text-ink">Nothing was charged.</b>{" "}
            Your card was never charged for this trip, so there&rsquo;s nothing to refund and nothing
            you need to do.
          </p>
          <p className="mt-4 text-[12px] text-muted">Changed your mind? You&rsquo;re welcome to book again any time.</p>
          <div className="mt-5">
            <AppLink href="/book" className="btn-quiet text-[13px]">
              Book a trip →
            </AppLink>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

function Expired() {
  return (
    <Shell>
      <div data-testid="pay-state">
        <Notice>This payment link has expired. Ask {TENANT_NAME} for a new one.</Notice>
      </div>
    </Shell>
  );
}

/** Paid: where the booking link went, and the recovery page — never the booking link itself. */
function Paid({ reservation: r }: { reservation: Reservation }) {
  const media = r.email ? "text and email" : "text";
  return (
    <Shell>
      <div data-testid="pay-state" className="flex flex-col gap-3">
        <Notice tone="ok">
          This trip is already paid. Your booking link is in the {media} we sent to{" "}
          {r.phone ? maskedPhone(r.phone) : "you"}.
        </Notice>
        <AppLink href="/b/find" className="btn-quiet self-start text-[13px]">
          Lost it? Find your booking
        </AppLink>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-lg px-4 py-16">{children}</main>;
}
