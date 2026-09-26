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
 *
 * **Built from `components/checkout/` since 16.1d** (issue #1092): the contact fields, tip tiles,
 * money summary and pay bar are shared with the operator's phone booking, so the two surfaces
 * cannot drift into quoting a trip differently. What stays HERE is everything only a paying
 * customer has — the card, the waiver, the promo row, the in-flight lock — and the one submit
 * path into Stripe. The operator's form lives under `app/(admin)/` and nothing here can reach it.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckoutSummary } from "../../../../components/checkout/checkout-summary";
import { ContactFields, type ContactValues } from "../../../../components/checkout/contact-fields";
import { totalsWithTip, type CheckoutMoney, type TipTier } from "../../../../components/checkout/money";
import { PayBar } from "../../../../components/checkout/pay-bar";
import { TipTiles } from "../../../../components/checkout/tip-tiles";
import { startElementsCheckout } from "./actions";

/**
 * The gift-card / discount row, rendered inert until that feature exists. Hoisted so the
 * disable has a line of its own: `className` sits inside a JSX opening tag under
 * `aria-disabled`, where a comment cannot go.
 *
 * `text-faint` is correct here (#951) — WCAG 1.4.3 exempts text that is part of an
 * inactive user interface component, and the dimming plus the dashed border is what tells
 * a customer this is not something they can use yet.
 */
const INERT_PROMO_ROW =
  // eslint-disable-next-line no-restricted-syntax -- inactive control, WCAG 1.4.3; see above
  "flex cursor-not-allowed items-center justify-between rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-faint";

export interface CheckoutFormProps {
  publishableKey: string;
  returnUrl: string;
  slot: { offeringId: string; date: string; time: string; guests: number };
  money: CheckoutMoney;
  tiers: TipTier[];
  defaultBps: number;
  waiverUrl: string;
  /** The published cancellation terms (#619) — passed as plain data, waiverUrl idiom. */
  cancellationTerms: string;
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
  const { dueNowCents } = totalsWithTip(props.money, tip.tipCents);

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
    //
    // `void … .catch()` rather than floating (issue #773). Stripe types this `Promise<void>` and
    // documents it as resolving *"when the update has been applied to all rendered Elements"*, so
    // an unhandled rejection was reaching the console with nothing to read it. There is no
    // recovery to attempt — the authoritative amount is the server's `clientSecret`, not the
    // Element's — so this logs and moves on rather than pretending to handle it.
    void elements?.update({ amount: amountCents }).catch((e: unknown) => {
      console.error("[checkout] elements.update failed", e);
    });
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
  const [contact, setContact] = useState<ContactValues>({ name: "", phone: "", email: "" });
  const [waiver, setWaiver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { name, email, phone } = contact;
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
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const conf = await p.stripe.confirmPayment({
        elements: p.elements,
        clientSecret: res.clientSecret,
        confirmParams: {
          return_url: p.returnUrl,
          // #679. Without this Stripe builds the payment's contact from whatever the Element
          // happened to collect on its own — which is why the phone came through blank and the
          // name could differ from the one on Muster's form. These are the values the guest
          // actually typed here, so they are the ones the charge should carry.
          payment_method_data: {
            billing_details: {
              name: name.trim(),
              ...(email.trim() ? { email: email.trim() } : {}),
              ...(phone.trim() ? { phone: phone.trim() } : {}),
            },
          },
        },
      });
      // Only reached on failure (success redirects to return_url).
      if (conf.error) {
        setError(conf.error.message ?? "Payment didn't go through. You have not been charged.");
      }
    } catch (e) {
      // **`try … finally` with no `catch` was the defect** (issue #773). On a throw the `finally`
      // re-enabled the button, `setError` never ran, and the rejection went unhandled — so the
      // customer's only signal was the button coming back, and the rational response to that is
      // to tap it again. On the last screen before money moves.
      //
      // Belt and braces with the server action's own wrap: `startElementsCheckout` cannot reject
      // any more, but the NETWORK between this browser and that server can fail on its own, and
      // `stripe.confirmPayment` is a second dependency that can reject rather than resolve
      // `{ error }`. Neither is something the action can catch for us.
      console.error("[checkout] submit failed", e);
      setError("Something went wrong — you have not been charged. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="relative flex flex-col">
      {/*
        **The whole form body goes inert while a payment is in flight** (issue #997).

        Before this, the Pay button was the only thing that changed — the name, phone and email
        stayed editable, and so did the tip buttons, which have no `disabled` of their own and
        whose `onClick` reaches `elements.update({ amount })`. So a customer could change the tip
        AFTER the PaymentIntent had been minted at the old amount, leaving the card element
        believing one number and the intent holding another. What Stripe does with that
        disagreement was an open question nobody had answered.

        **This removes the question rather than answering it.** With the tip buttons unreachable
        for the in-flight window the mismatch cannot be produced, which is a better outcome than
        a sandbox result Stripe could change under us.

        `inert` rather than a `disabled` on each control, for two reasons. It covers Stripe's
        Payment Element, which is an iframe we do not own and cannot disable. And a
        `pointer-events` overlay alone would stop the mouse and nothing else — you could still
        tab into the name field behind it and type, which is worse than today because the screen
        would then be lying about being locked. `inert` takes the whole subtree out of the tab
        order and out of hit-testing. React 19 passes it through as a real attribute.

        The pay bar and the error card sit OUTSIDE this wrapper on purpose: the button keeps its
        own "Booking…" state, and a failure has to be readable the instant it arrives.
      */}
      <div inert={submitting}>
      <div className="px-[18px]">
        <ContactFields
          voice="self"
          values={contact}
          onChange={(field, value) => setContact((c) => ({ ...c, [field]: value }))}
        />

        <TipTiles tiers={p.tiers} selectedBps={p.tipBps} onSelect={p.setTipBps} />

        {/* CARD */}
        <div className="pt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">Payment</div>
          {p.inElements ? (
            /* #679. Mounted bare, the Element collected its own name and phone — and Stripe's
               rule is that "details collected by Elements will override values passed here", so
               simply passing `billing_details` at confirm would have changed nothing. The fields
               have to be turned OFF for our values to survive.
               `defaultValues` can't do this job: it's read at mount, and the contact inputs sit
               above this one, so they're empty at that moment.
               Name and phone only — both are `required` above, and a field disabled here becomes
               REQUIRED at confirm. Email is optional at `/book`, so suppressing it would reject
               the payment of every guest who left it blank. Stripe keeps collecting email when it
               wants to (Link), and wins on it; the email we pass applies when it doesn't ask. */
            <PaymentElement
              options={{ fields: { billingDetails: { name: "never", phone: "never" } } }}
            />
          // eslint-disable-next-line sonarjs/no-nested-conditional -- baselined, lift to a named function (#928)
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
          <div aria-disabled="true" className={INERT_PROMO_ROW}>
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

        <CheckoutSummary m={p.money} tipBps={p.tipBps} tipCents={p.tipCents} />

        {/* cancellation terms + manage note (#619). The terms are the operator's published
            policy, quoted from the constants in `refund-terms.ts` — never retyped here.
            Flex insurance is deliberately absent: it is a published term nothing can sell
            yet (#683). Copy only. */}
        <div className="pb-4 pt-3 text-xs">
          {/* text-muted, not text-faint: this is the term the customer is agreeing to by
              paying, and it should not be the quietest thing on the screen. */}
          <p className="text-muted" data-testid="cancellation-terms">{p.cancellationTerms}</p>
          <p className="pt-2 text-muted">
            After you book, your confirmation includes a private booking link to view or manage
            your reservation. Questions? Message us from that link any time.
          </p>
        </div>
      </div>

      </div>

      {submitting && (
        /* The visible half. `inert` above is what actually locks the form; this is what says so —
           an overlay with no explanation reads as a frozen page. `pointer-events-none` because it
           must not become the thing intercepting clicks: if this ever renders while `inert` is
           false, a customer must still be able to use the form underneath. */
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-card/70 pt-24"
          data-testid="checkout-busy"
        >
          <div className="flex items-center gap-2.5 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
            {/* Same shape as `submit-button.tsx` and `nav-spinner.tsx` — one idiom for "working",
                not a third. Decorative; the sentence beside it carries the meaning. */}
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-[3px] border-accent border-r-transparent"
            />
            <span className="text-sm font-medium text-ink">Taking payment — don&rsquo;t close this page.</span>
          </div>
        </div>
      )}

      {error && (
        <div className="px-[18px] pb-2">
          {/* `role="alert"` (issue #773): the card was already in the right place — directly above
              the sticky pay bar, so it is in view at any scroll position — but nothing announced
              it. On the last screen before money moves, a customer using a screen reader got the
              same silence this issue is about. */}
          <div role="alert" className="rounded-card border border-bad-line bg-bad-bg px-4 py-3 text-sm text-bad" data-testid="checkout-error">
            {error}
          </div>
        </div>
      )}

      <PayBar m={p.money} tipCents={p.tipCents}>
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
      </PayBar>
    </form>
  );
}
