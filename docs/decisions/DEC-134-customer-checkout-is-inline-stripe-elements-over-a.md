---
id: DEC-134
title: "Customer checkout is inline Stripe Elements over a deferred PaymentIntent; hosted Checkout remains for balance + post-gratuity (12.5, #458; revisits DEC-107/108 as DEC-108 anticipated)"
topic: "Reservations & payments"
---

## DEC-134: Customer checkout is inline Stripe Elements over a deferred PaymentIntent; hosted Checkout remains for balance + post-gratuity (12.5, #458; revisits DEC-107/108 as DEC-108 anticipated)

**Decision:** the customer booking charge moves off hosted Stripe Checkout onto an **inline Payment Element** at `/book/checkout` — the card widget lives in our page, styled with our tokens, no redirect. The Element mounts in **deferred mode** (amount + currency only; NO PaymentIntent exists at page load), so tip-tile changes just update the amount client-side (`elements.update`). "Book & pay" runs `createDeparturePaymentIntent`: waiver gate → gratuity gate → the 15-min hold (DEC-109) → price the held slot → freeze every money field into `stripe.paymentIntents.create` metadata → the client confirms against the returned `clientSecret`.

**The webhook handles BOTH event types** (the port's `parseEvent` union): `payment_intent.succeeded` books through the same `writeSlotBooking` spine with **idempotency key = the PaymentIntent id** (Payment `pay_${pi}`, pre-gratuity `grat_pre_${pi}`, residual-race refund `refund_${pi}`); `checkout.session.completed` keeps driving the still-hosted balance + post-gratuity flows unchanged. **Double-write guard:** every hosted session's underlying PI *also* emits `payment_intent.succeeded` — so the handler processes ONLY intents whose metadata carries `purpose`, and `createCheckoutSession` never sets `payment_intent_data.metadata`. A hosted charge's bare PI is acked-and-ignored: one charge, one booking, structurally. *Ops:* the Stripe dashboard webhook endpoint must subscribe to `payment_intent.succeeded` alongside `checkout.session.completed`.

**Post-trip gratuity is retired by `SPEC.md` §2.8.4b/§2.8.11** — the hosted post-gratuity flow this decision describes still ships and is to be removed; the title and the webhook paragraph above describe what runs today, not what is wanted. The balance flow is unaffected.

**The service fee, the tax rate and the tip tiers are `SPEC.md` §2.8.4a.** Read them there. What this decision settled and the spec does not carry: the fee is charged **in full once with the first charge**, the same posture as tax, so the later balance charge carries no fee — and both the fee and the gratuity are **netted out of the balance owed**, leaving the balance pure remaining principal plus its tax.

**New deps:** `@stripe/stripe-js` + `@stripe/react-stripe-js`, loaded lazily inside the one checkout client island (the DEC-133 posture holds — everything else on the screen server-renders). `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is **build-inlined** (the `<VersionTag/>` v0.0.0 trap): a missing key renders a loud configuration-error state, never a silently-broken Element. The 11.6 throwaway booking harness (`startBooking`) retires — `/book/checkout` is the real front door.
