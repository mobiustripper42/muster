/**
 * Booking confirmation landing (12.6, #459; supersedes the 11.6 harness stub) — where Stripe
 * redirects after a successful charge, from both the Elements PaymentIntent flow (12.5) and any
 * hosted Checkout. Says "you're booked" but leans on the **booking link arriving by text/email**,
 * NOT on showing the reservation inline: the redirect is not proof of the write — the webhook
 * (which may land a beat later) is what creates the reservation + sends the manage link (DEC-107/
 * DEC-122). So this page never tries to load a reservation that might not exist yet; it points the
 * customer at their incoming link.
 */
import { AppLink } from "../../../../components/ui/app-link";

export default function BookingSuccessPage() {
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
