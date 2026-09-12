---
schema: 1
id: DEC-169
title: "The ledger write is last and idempotent, not in the booking transaction"
topic: "Reservations & payments"
status: "active"
date: "2026-09-12"
ruling: "The payment row is bookkeeping, not the claim: outside the flip's transaction, written last, still throwing."
claims:
  - kind: "file"
    target: "src/reservations/booking-webhook.ts"
    note: "the payment write runs on `already` too, so a redelivery heals it"
  - kind: "spec"
    target: "2.8"
revisit_if: "a payment row becomes an input to confirm, occupancy, or the reconciler's work list"
amends_spec:
  - section: "2.8"
    scope: "2.8.6's steps after the flip are ordered — formation and the confirmation precede the payment record — and are idempotent, not transactional"
---

## DEC-169: The ledger write is last and idempotent, not in the booking transaction

### Context

Issue #971: the payment write threw after the flip committed, the redelivery resolved `already`,
and the outcome-gated confirmation never sent. The proposal: move that write inside the transaction
so a failure rolled the booking back.

### Decision

The transaction covers the **claim** — the hull mutex and the `Event`, what only the database can
arbitrate (DEC-131). A payment row arbitrates nothing: no reservation resolves through it (2.8.5
uses the ids on our own row), no occupancy reads it (DEC-165), 2.8.9's work list is `pending` rows.
So it sits outside, last, still throwing — the provider's redelivery is the retry, and the write
runs on `already` too, so it heals.

*Rejected: widening the port.* It covers the `won` branch only — on `already` there is no flip to
roll back — so the guarantee would depend on which branch you landed in. It also needs a provider call hoisted out
to be legal, and its mechanism is provable only in the Postgres suite, which skips with no database
up and is not in the gate.

Accepted cost, in 2.8.10: until the retry lands a paid booking reads unpaid.
