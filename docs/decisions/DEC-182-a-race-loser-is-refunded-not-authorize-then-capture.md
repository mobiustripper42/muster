---
schema: 1
id: DEC-182
title: "A residual-race loser is charged and refunded — no authorize-then-capture"
topic: "Reservations & payments"
status: "active"
date: "2026-09-23"
ruling: "The booking charge captures at confirm. A buyer who loses the last slot to a concurrent buyer is refunded in full and told; the charge is not split into an authorization captured only after the hull claim is won."
claims:
  - kind: "file"
    target: "src/reservations/booking-webhook.ts"
    note: "compensateResidualRaceLoss refunds the loser"
  - kind: "spec"
    target: "2.8.7"
revisit_if: "The 'SOLD OUT WHILE PAYING' office text, or an 'Auto-refunded after losing the boat' row on /admin/booking-audit, shows up more than rarely"
---

## DEC-182: A residual-race loser is charged and refunded — no authorize-then-capture

Issue #1012 proposed manual capture (`capture_method: "manual"`): authorize at checkout, capture
only once the hull claim is won, and *cancel* a loser's authorization — no charge, no refund.
Stripe supports it, cancelling an uncaptured authorization is free, and the hold window is days
against a decision that takes seconds.

Declined on proportion. The race needs two buyers in checkout for the last slot on one boat at the
same moment. The cost was an 8: the confirm path moves off `payment_intent.succeeded`, a new
orphan class (authorized, never captured) needs its own sweeper, and bank debits could never be
added without splitting the webhook by payment method.

The loser is not harmed, only delayed: the refund is automatic and the sold-out notice says so
(SPEC §2.8.7). The Stripe research, with its sources, stays on issue #1012 for whoever revisits.

See also DEC-168 (the booking charge is a raw PaymentIntent).
