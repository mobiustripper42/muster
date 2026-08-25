/**
 * Booking confirmation landing (12.6, #459) — where Stripe redirects after a successful charge,
 * from the Elements PaymentIntent flow (12.5) and from any hosted Checkout.
 *
 * **This page CONFIRMS the booking (issue #827, SPEC §2.8 criterion 13).** It used to be static
 * copy that pointed at an incoming link, on the reasoning that the redirect is not proof of the
 * write and the webhook is what creates the reservation. That reasoning is right about the
 * redirect and wrong about the conclusion: it left `payment_intent.succeeded` as the ONLY path
 * that ever books, so a delayed or misconfigured endpoint meant the customer had paid and nothing
 * had happened, with no bound on when anyone would notice.
 *
 * Stripe's own fulfillment guidance is to do both — webhooks can be delayed, so fulfil from the
 * landing page as well, where the customer is standing in front of you. The webhook remains the
 * guarantee for the customer who closed the tab.
 *
 * **The redirect is still not proof.** Stripe appends `payment_intent` and `redirect_status` to
 * the return URL and both are text in an address bar, so the id is resolved against Stripe before
 * anything is written (`confirmBookingByPaymentIntent`). A forged or unpaid id books nothing.
 *
 * **Confirming in the render is safe because the confirm is idempotent**, keyed on the
 * PaymentIntent id — a prefetch, a reload or the webhook arriving mid-render all resolve to
 * `already`, never a second booking. That property is asserted in `confirm-booking.test.ts`; it
 * is what makes this a page rather than a client island firing an action.
 *
 * The copy below is unchanged and still points at the booking link, because the link is sent by
 * the confirm path either way and it is what the customer needs to keep.
 */
import { AppLink } from "../../../../components/ui/app-link";
import { bookingDeps } from "../../../lib/booking-deps";
import { confirmBookingByPaymentIntent } from "@core/reservations/confirm-booking.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Confirm from the id Stripe put in the URL. Never throws and never blocks the page: this is the
 * FAST path, not the guarantee. If Stripe is unconfigured, the id is absent, or anything fails,
 * the webhook still books the customer and the copy below is still true.
 */
async function confirmFromRedirect(paymentIntentId: string | undefined): Promise<void> {
  if (!paymentIntentId) return;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return;
  try {
    await confirmBookingByPaymentIntent(bookingDeps(secretKey), paymentIntentId);
  } catch (e) {
    // Deliberately swallowed. A customer who paid should never see a stack trace because our
    // fast path failed, and the webhook is still coming for exactly this case.
    console.error("[book/success] confirm from redirect failed", e);
  }
}

export default async function BookingSuccessPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const pi = sp.payment_intent;
  await confirmFromRedirect(typeof pi === "string" ? pi : undefined);

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="overflow-hidden rounded-[18px] border border-line bg-card shadow-sm">
        <div className="border-b border-line bg-gradient-to-br from-ok-bg to-transparent px-6 py-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok">
            ✓
          </div>
          <h1 className="text-[22px] font-semibold">You’re booked!</h1>
          <p className="mt-1.5 text-[13px] text-muted">Payment received. Your crew will see you on the water.</p>
        </div>
        <div className="px-6 py-6 text-[13.5px] text-muted">
          <p>
            <b className="text-ink">Check your texts and email.</b> We’re just finalizing your reservation and sending
            your <b className="text-ink">booking link</b> — that’s where you’ll see your trip details, add a tip for
            your crew, or make a change. Save it.
          </p>
          <p className="mt-4 text-[12px] text-faint">
            It usually arrives within a minute. Didn’t get it? You’ll be able to recover it from the link we sent — or
            reach out and we’ll resend.
          </p>
          <div className="mt-5">
            <AppLink href="/book" className="text-[13px] font-semibold text-accent">
              Book another trip →
            </AppLink>
          </div>
        </div>
      </div>
    </main>
  );
}
