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
    note: "no supportsCancellation, so a disconnect does not kill the work"
revisit_if: "§2.8.9's reconciler ships — a lost ack stops being the only safety net once something else finds paid-but-unbooked rows"
---

## DEC-178: The Stripe webhook stays synchronous — the 500 is the durability

Recorded because it will be proposed again, and the reasoning is not visible in the code that
resulted from it. See also DEC-179 on the second refusal about this endpoint.

Answering 2xx first and deferring the work into `after()` reads as the resilient shape and is the
opposite. Stripe retries a non-2xx for three days and never returns for a 2xx, so acking first
converts a recoverable delay into a silent loss: charged, unbooked, and Stripe's own record saying
we handled it. It buys no wall-clock either — `after()` runs inside the route's own max duration.

What makes a timed-out delivery harmless is a setting we do not set. Vercel request cancellation is
opt-in through `supportsCancellation`, absent from `vercel.json`, so a client disconnect does not
kill the invocation: the work completes, only the ack is lost, and the redelivery resolves
`already`. That stops being true the day somebody adds that key.
