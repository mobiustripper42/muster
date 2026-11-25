"use client";

/**
 * The manage page's `Pay balance` button and card form (issue #1254, `docs/SPEC.md §2.8.4d`).
 *
 * Under the balance row: a primary button; pressed, it asks the server to start the balance on the
 * booking's one balance PaymentIntent (`payBalanceFromManagePage`), and in its place comes the Stripe
 * Payment Element — cards only, nothing saved, matching the intent (`elementsOptions(…, "balance")`) —
 * with `Pay $552.94` and a `Cancel` link that folds it back to the button. A refused press (a balance
 * already collected, a booking that cannot take a payment) says why under the button; a declined card
 * shows Stripe's own message under the form, as the checkout does. A paid form redirects to the
 * manage page, whose return records the payment.
 *
 * **Not `CheckoutForm`'s pay mode**, which is hard-wired to the payment link's token, the terms box and
 * the tip/insurance choices, none of which a balance has. The Stripe.js load and the `PaymentElement`
 * mount are copied from it (`app/(public)/book/checkout/checkout-form.tsx`) rather than extracted:
 * extracting them would change the checkout, which this task does not touch.
 */

import { useEffect, useState, type FormEvent } from "react";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { elementsOptions, paymentElementOptions } from "../../../components/checkout/money";
import { Notice } from "../../../components/ui/notice";
import { payBalanceFromManagePage } from "./actions";

interface Props {
  code: string;
  publishableKey: string;
  /** Where Stripe sends the customer after the card (and any 3-D Secure step): this page. */
  returnUrl: string;
  /** `Pay balance · $552.94` — the view's own label. */
  label: string;
  amountCents: number;
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** The button, then — once the server has started the payment — the card form in its place. */
export function BalancePayForm(p: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [stripeFailed, setStripeFailed] = useState(false);
  // Set once the press is accepted: the form's intent and the amount the server set on it.
  const [started, setStarted] = useState<{ clientSecret: string; amountCents: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Lazy-load Stripe.js on mount (copied from the checkout): out of the initial bundle, and a load
  // failure surfaces as a visible error rather than a hung form.
  useEffect(() => {
    let alive = true;
    import("@stripe/stripe-js")
      .then((m) => {
        if (alive) setStripePromise(m.loadStripe(p.publishableKey));
      })
      .catch(() => {
        if (alive) setStripeFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [p.publishableKey]);

  async function press() {
    setPressing(true);
    setRefusal(null);
    try {
      const res = await payBalanceFromManagePage(p.code);
      if ("error" in res) setRefusal(res.error);
      else setStarted(res);
    } catch (e) {
      console.error("[balance] start failed", e);
      setRefusal("Something went wrong — you have not been charged. Please try again.");
    } finally {
      setPressing(false);
    }
  }

  if (started === null) {
    return (
      <div className="mt-3">
        <button
          type="button"
          data-testid="pay-balance"
          className="btn-primary min-h-[44px] w-full"
          disabled={pressing}
          onClick={() => void press()}
        >
          {pressing ? "One moment…" : p.label}
        </button>
        {refusal ? (
          <p role="alert" data-testid="pay-balance-refusal" className="mt-2 text-[12.5px] text-bad">
            {refusal}
          </p>
        ) : null}
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="mt-3" data-testid="balance-form">
        {stripeFailed ? (
          <Notice tone="bad" data-testid="stripe-error">
            The payment form couldn&rsquo;t load. Check your connection and reload — you have not been
            charged.
          </Notice>
        ) : (
          <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted" data-testid="stripe-loading">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            Loading secure payment…
          </div>
        )}
        <CancelLink onCancel={() => setStarted(null)} />
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      // Deferred mode, as the checkout mounts it: cards only and nothing saved, to match the intent.
      options={elementsOptions(started.amountCents, "balance")}
    >
      <CardForm
        clientSecret={started.clientSecret}
        amountCents={started.amountCents}
        returnUrl={p.returnUrl}
        onCancel={() => setStarted(null)}
      />
    </Elements>
  );
}

function CancelLink({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-2 text-center">
      <button type="button" data-testid="pay-balance-cancel" className="btn-quiet text-[13px]" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function CardForm({
  clientSecret,
  amountCents,
  returnUrl,
  onCancel,
}: {
  clientSecret: string;
  amountCents: number;
  returnUrl: string;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) {
      setError("The payment form hasn't finished loading — give it a second and try again.");
      return;
    }
    setPaying(true);
    setError(null);
    try {
      // Deferred mode: validate the Element first, then confirm against the intent the press started.
      const sub = await elements.submit();
      if (sub.error) {
        setError(sub.error.message ?? "Please check your card details.");
        return;
      }
      const conf = await stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url: returnUrl } });
      // Only reached on failure (success redirects to the return URL).
      if (conf.error) setError(conf.error.message ?? "Payment didn't go through. You have not been charged.");
    } catch (err) {
      console.error("[balance] confirm failed", err);
      setError("Something went wrong — you have not been charged. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-col gap-3" data-testid="balance-form">
      <PaymentElement options={paymentElementOptions("balance")} />
      {error ? (
        <Notice tone="bad" data-testid="balance-error">
          {error}
        </Notice>
      ) : null}
      {/* A raw submit, deliberately: this is a client form that confirms with Stripe.js (like the
          checkout's pay bar), not a server-action form, so `SubmitButton`'s form-status spinner has
          nothing to read; `paying` is its in-flight state. */}
      {/* eslint-disable-next-line muster/raw-submit -- client-side Stripe confirm, no server action */}
      <button type="submit" className="btn-primary min-h-[44px] w-full" disabled={paying || !stripe || !elements}>
        {paying ? "Paying…" : `Pay ${dollars(amountCents)}`}
      </button>
      <CancelLink onCancel={onCancel} />
    </form>
  );
}
