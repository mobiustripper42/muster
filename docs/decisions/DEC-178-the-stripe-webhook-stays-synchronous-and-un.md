---
schema: 1
id: DEC-178
title: "The Stripe webhook stays synchronous — the 500 is the durability"
topic: "Reservations & payments"
status: "active"
date: "2026-09-19"
ruling: "The handler finishes its work before it answers, and any post-signature failure returns 500 so Stripe redelivers. No 2xx-first, no deferral into `after()`."
claims:
  - kind: "file"
    target: "app/api/webhooks/stripe/route.ts"
    note: "500 on any post-signature failure; 400 only for PaymentSignatureError"
  - kind: "file"
    target: "vercel.json"
    note: "sets no `functions` block, so cancellation stays off and no maxDuration is stated"
revisit_if: "§2.8.9's reconciler ships — a lost ack stops being the only safety net once something else finds paid-but-unbooked rows"
---

## DEC-178: The Stripe webhook stays synchronous — the 500 is the durability

Recorded because it will be proposed again. See also DEC-179, the other refusal about this endpoint.

Answering 2xx first and deferring into `after()` reads as the resilient shape and is the opposite.
Stripe retries a non-2xx for three days and never returns for a 2xx, so acking first turns a
recoverable delay into a silent loss: charged, unbooked, Stripe's record saying we handled it.

Two ways an invocation can end early, and neither argues for the swap. A client disconnect does not
kill it: cancellation is opt-in through `supportsCancellation` in `vercel.json`'s `functions` block
(Vercel, *Functions API Reference* — "an opt-in feature that must be enabled"), which this project
does not set. A platform timeout is the other, and it is the one an async proposal is really worried
about — but it is answered by the same mechanism. No 2xx was sent, so Stripe redelivers, the flip is
one transaction that either committed or did not, and the second delivery resolves `already`.
Acking first is what would break that.

This repo cannot state that timeout: no `maxDuration` is set, so it is the host plan's default.
