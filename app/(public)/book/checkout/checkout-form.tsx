"use client";

/**
 * The one client island on the checkout screen (12.5, #458, DEC-133/134). The form is
 * intrinsically interactive — tip tiles re-total live, and the Stripe Payment Element is
 * client-only — so contact, tip, waiver, card, and the sticky pay bar all live here. The
 * server page computes every money number with the pure functions and passes PLAIN DATA
 * (no functions cross the RSC boundary).
 *
 * Stripe.js loads LAZILY (dynamic import on mount, spinner while loading) and `<Elements>`
 * mounts in DEFERRED mode ({ mode: "payment", amount, currency } — NO PaymentIntent exists
 * yet). Tip changes call `elements.update({ amount })`. "Book & pay" →
 * `startElementsCheckout` (server action: gates + hold + `paymentIntents.create`) →
 * `stripe.confirmPayment` against the returned clientSecret. A missing/unloadable Stripe.js
 * degrades to a visible error state — the rest of the form (totals, gates) works without it,
 * which is also what keeps the e2e deterministic offline.
 *
 * Inputs use the tinted `bg-bg` fill (the #484 settings-form treatment) — a white input in a
 * white card is invisible; the app-wide #484 decision stays open.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { settingsInputClass } from "../../../../components/admin/settings-field";
import { startElementsCheckout } from "./actions";

/** Local mirror of `formatCents` — inlined so the client bundle stays tiny (book-controls idiom). */
function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export interface CheckoutMoney {
  fareCents: number;
  baseCents: number;
  extraGuests: number;
  extrasCents: number;
  extraGuestPriceCents: number;
  includedGuests: number;
  taxCents: number;
  taxRateBps: number;
  serviceFeeCents: number;
  serviceFeeBps: number;
  /** Charge-now excluding the tip (deposit share + full tax + full fee, or full total). */
  dueNowBeforeTipCents: number;
  depositMode: boolean;
  /** Remaining fare charged later (deposit mode only; 0 in full mode). */
  balanceLaterCents: number;
}

export interface CheckoutFormProps {
  publishableKey: string;
  returnUrl: string;
  slot: { offeringId: string; date: string; time: string; guests: number };
  money: CheckoutMoney;
  tiers: { bps: number; tipCents: number }[];
  defaultBps: number;
  waiverUrl: string;
}

export function CheckoutForm(props: CheckoutFormProps) {
  const [tipBps, setTipBps] = useState(props.defaultBps);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [stripeFailed, setStripeFailed] = useState(false);

  // Lazy-load Stripe.js on mount (DEC-134): the library + js.stripe.com script stay out of
  // the initial bundle; a load failure surfaces as a visible error, never a hung form.
  useEffect(() => {
    let alive = true;
    import("@stripe/stripe-js")
      .then((m) => {
        if (alive) setStripePromise(m.loadStripe(props.publishableKey));
      })
      .catch(() => {
        if (alive) setStripeFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [props.publishableKey]);

  const tip = props.tiers.find((t) => t.bps === tipBps) ?? props.tiers[0]!;
  const dueNowCents = props.money.dueNowBeforeTipCents + tip.tipCents;

  const inner = (bridge: { stripe: Stripe | null; elements: StripeElements | null; inElements: boolean }) => (
    <InnerForm
      {...props}
      tipBps={tip.bps}
      setTipBps={setTipBps}
      tipCents={tip.tipCents}
      dueNowCents={dueNowCents}
      stripeFailed={stripeFailed}
      {...bridge}
    />
  );

  if (!stripePromise) {
    // Stripe.js not loaded (yet, or failed) — the form still renders and totals still move;
    // only the card box shows the loading/error state and submit stays blocked.
    return inner({ stripe: null, elements: null, inElements: false });
  }
  return (
    <Elements
      stripe={stripePromise}
      // DEFERRED mode: amount-only, no PaymentIntent at mount. The initial amount is fine to
      // freeze here — tip changes go through elements.update({ amount }) in the bridge.
      options={{ mode: "payment", amount: dueNowCents, currency: "usd" }}
    >
      <StripeBridge amountCents={dueNowCents}>{inner}</StripeBridge>
    </Elements>
  );
}

/** Reads the Stripe hooks (must be inside `<Elements>`) and keeps the deferred amount live. */
function StripeBridge({
  amountCents,
  children,
}: {
  amountCents: number;
  children: (b: { stripe: Stripe | null; elements: StripeElements | null; inElements: boolean }) => ReactNode;
}) {
  const stripe = useStripe();
  const elements = useElements();
  useEffect(() => {
    // Tip changed → the confirm amount changes → keep the deferred Elements in sync.
    elements?.update({ amount: amountCents });
  }, [elements, amountCents]);
  return <>{children({ stripe, elements, inElements: true })}</>;
}

type InnerProps = CheckoutFormProps & {
  tipBps: number;
  setTipBps: (bps: number) => void;
  tipCents: number;
  dueNowCents: number;
  stripe: Stripe | null;
  elements: StripeElements | null;
  inElements: boolean;
  stripeFailed: boolean;
};

function InnerForm(p: InnerProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCents = p.money.fareCents + p.money.taxCents + p.money.serviceFeeCents + p.tipCents;
  const canSubmit = waiver && !submitting;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!waiver) return; // button is disabled; belt for a raw submit
    if (!p.inElements || !p.stripe || !p.elements) {
      setError("The payment form hasn't finished loading — give it a second and try again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Deferred-intent flow: validate the Element FIRST (card details), THEN create the
      // PaymentIntent server-side (waiver gate → hold → freeze money), THEN confirm.
      const sub = await p.elements.submit();
      if (sub.error) {
        setError(sub.error.message ?? "Please check your card details.");
        return;
      }
      const res = await startElementsCheckout({
        offeringId: p.slot.offeringId,
        date: p.slot.date,
        time: p.slot.time,
        guests: p.slot.guests,
        gratuityBps: p.tipBps,
        customerName: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        waiverConsent: waiver,
        marketingOptIn,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const conf = await p.stripe.confirmPayment({
        elements: p.elements,
        clientSecret: res.clientSecret,
        confirmParams: { return_url: p.returnUrl },
      });
      // Only reached on failure (success redirects to return_url).
      if (conf.error) {
        setError(conf.error.message ?? "Payment didn't go through. You have not been charged.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = `${settingsInputClass} w-full text-[15px]`;

  return (
    <form onSubmit={onSubmit} className="flex flex-col">
      <div className="px-[18px]">
        {/* CONTACT */}
        <div className="pt-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
            Who&rsquo;s booking?
          </div>
          <div className="flex flex-col gap-2">
            <input
              className={inputClass}
              placeholder="Full name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={inputClass}
              type="tel"
              placeholder="Mobile — with country code if outside the US"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className={inputClass}
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mt-1.5 text-xs text-faint">
            Your mobile gets your booking link + trip updates.
          </div>
          <label className="mt-2 flex items-start gap-2 text-[12.5px] text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
            />
            <span>Send me occasional news and offers (optional).</span>
          </label>
        </div>

        {/* TIP — required, no decline (DEC-124) */}
        <div className="pt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
            Tip your crew <span className="font-normal normal-case text-muted">· required</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {p.tiers.map((t) => (
              <button
                key={t.bps}
                type="button"
                data-testid={`tip-${t.bps}`}
                aria-pressed={t.bps === p.tipBps}
                onClick={() => p.setTipBps(t.bps)}
                className={`rounded-xl border px-1 py-2.5 text-center ${
                  t.bps === p.tipBps
                    ? "border-accent bg-accent/5 ring-1 ring-accent"
                    : "border-line bg-card"
                }`}
              >
                <span className="block text-[17px] font-bold">{t.bps / 100}%</span>
                <span className="block font-mono text-xs text-faint">{money(t.tipCents)}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted">
            <b className="text-mate">100% goes to the crew</b> — never taxed, never fee&rsquo;d.
          </div>
        </div>

        {/* CARD */}
        <div className="pt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">Payment</div>
          {p.inElements ? (
            <PaymentElement />
          ) : p.stripeFailed ? (
            <div className="rounded-card border border-bad-line bg-bad-bg px-4 py-3 text-sm text-bad" data-testid="stripe-error">
              The payment form couldn&rsquo;t load. Check your connection and reload — you have
              not been charged.
            </div>
          ) : (
            <div
              className="flex items-center gap-2 rounded-card border border-line bg-bg px-4 py-6 text-sm text-muted"
              data-testid="stripe-loading"
            >
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
              Loading secure payment…
            </div>
          )}
        </div>

        {/* gift card / discount — future, rendered inert */}
        <div className="pt-4">
          <div
            aria-disabled="true"
            className="flex cursor-not-allowed items-center justify-between rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-faint"
          >
            <span>Apply gift card or discount code</span>
            <span className="text-[11px] uppercase tracking-wide">Coming soon</span>
          </div>
        </div>

        {/* WAIVER */}
        <div className="pt-4">
          <label className="flex items-start gap-2.5 text-[13px] text-muted">
            <input
              type="checkbox"
              data-testid="waiver"
              className="mt-0.5 h-[18px] w-[18px] flex-none"
              checked={waiver}
              onChange={(e) => setWaiver(e.target.checked)}
            />
            <span>
              I&rsquo;ve read and agree to the{" "}
              <a href={p.waiverUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
                liability waiver
              </a>{" "}
              and terms. Your other guests sign their own before the trip — you&rsquo;ll get a
              link to share.
            </span>
          </label>
        </div>

        {/* SUMMARY */}
        <div className="pt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">Summary</div>
          <div className="border-t border-line pt-2 text-[13.5px]">
            <SummaryRow
              label={`Fare — up to ${p.money.includedGuests} guests`}
              value={money(p.money.baseCents)}
            />
            {p.money.extraGuests > 0 && (
              <SummaryRow
                label={`${p.money.extraGuests} extra ${p.money.extraGuests === 1 ? "guest" : "guests"} · ${money(p.money.extraGuestPriceCents)}`}
                value={money(p.money.extrasCents)}
              />
            )}
            <SummaryRow
              label={`Tip your crew · ${p.tipBps / 100}% → crew`}
              value={money(p.tipCents)}
              tone="crew"
              testId="summary-tip"
            />
            <SummaryRow
              label={`Tax · ${(p.money.taxRateBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
              value={money(p.money.taxCents)}
            />
            <SummaryRow
              label={`Service fee · ${(p.money.serviceFeeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
              value={money(p.money.serviceFeeCents)}
              testId="summary-fee"
            />
            <div
              className="mt-1 flex justify-between border-t border-line pt-2 text-[15px] font-bold"
              data-testid="summary-total"
            >
              <span>Total</span>
              <span className="font-mono">{money(totalCents)}</span>
            </div>
            {p.money.depositMode && (
              <>
                <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold" data-testid="summary-due-now">
                  <span>Due now</span>
                  <span className="font-mono">{money(p.dueNowCents)}</span>
                </div>
                <div className="flex justify-between py-1 text-faint">
                  <span>Balance · charged before your trip</span>
                  <span className="font-mono">{money(p.money.balanceLaterCents)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* cancellation / manage note — the refund policy itself is unpinned (DEC-107 amend
            pending), so this states only what IS true: the manage link. Copy only. */}
        <div className="pb-4 pt-3 text-xs text-faint">
          After you book, your confirmation includes a private booking link to view or manage
          your reservation. Questions? Message us from that link any time.
        </div>
      </div>

      {error && (
        <div className="px-[18px] pb-2">
          <div className="rounded-card border border-bad-line bg-bad-bg px-4 py-3 text-sm text-bad" data-testid="checkout-error">
            {error}
          </div>
        </div>
      )}

      {/* sticky pay bar — pinned inside the card's scroll region (book-controls idiom) */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3.5 border-t border-line bg-card px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[10.5px] text-faint">{p.money.depositMode ? "Due now" : "Total"}</span>
          <b className="text-[18px] font-bold tabular-nums" data-testid="due-now">
            {money(p.dueNowCents)}
          </b>
          {p.money.depositMode && (
            <span className="text-[10.5px] text-faint">{money(totalCents)} total</span>
          )}
        </div>
        {/* Genuine DEC-090 exception: this form submits via a client onSubmit
            (elements.submit → server action → confirmPayment), not a form action, so
            useFormStatus/<SubmitButton> never sees pending; the local `submitting` state
            drives the in-flight label + disable instead. */}
        {/* eslint-disable-next-line no-restricted-syntax -- client onSubmit flow, see above */}
        <button type="submit"
          data-testid="book-pay"
          disabled={!canSubmit}
          className="ml-auto flex items-center gap-2 rounded-[11px] bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Booking…" : "🔒 Book & pay"}
        </button>
      </div>
    </form>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "crew";
  testId?: string;
}) {
  return (
    <div
      className={`flex justify-between py-1 ${tone === "crew" ? "text-mate" : ""}`}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <span className={tone === "crew" ? "" : "text-muted"}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
