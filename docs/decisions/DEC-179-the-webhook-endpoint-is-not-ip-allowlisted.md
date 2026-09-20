---
schema: 1
id: DEC-179
title: "The webhook endpoint is not IP-allowlisted — the signature is the door"
topic: "Reservations & payments"
status: "active"
date: "2026-09-19"
ruling: "No IP allowlist in front of `/api/webhooks/stripe`. Verification stays in the code, where a reader can find it and a test can exercise it."
claims:
  - kind: "file"
    target: "src/adapters/stripe-payment.ts"
    note: "constructEvent verifies before any field is read; PaymentSignatureError drives the 400"
  - kind: "file"
    target: "src/adapters/stripe-payment.test.ts"
    note: "a bad signature and a tampered payload are both refused, against real signed bodies"
revisit_if: "The allowlist can live in this repository and be versioned with it, or Stripe commits to addresses that do not rotate"
---

## DEC-179: The webhook endpoint is not IP-allowlisted — the signature is the door

Recorded because it will be proposed again, and it sounds like defence in depth. See also DEC-178
on the other refusal about this endpoint.

An allowlist is a dashboard rule invisible to this repository — the class of thing
`src/reservations/booking-webhook.ts` already names, where behaviour "rests on a Stripe dashboard
nobody can read from the repo". Stripe changes its addresses on seven days' notice, so a stale list 403s every
delivery for three days. That is the failure the signature check exists to prevent, reintroduced by
the mitigation, and arriving on a day nobody edited anything.

The signature is stronger than the source address anyway: it proves the payload was not altered,
which an IP cannot.

Not claimed here, because it is false: a `tolerance` of `0` does not disable the recency check.
`constructEvent` evaluates `tolerance || DEFAULT_TOLERANCE`, which is 300, so `0` means five
minutes. An earlier draft of this reasoning said otherwise, and a decision record is exactly where
a wrong claim becomes citable.
