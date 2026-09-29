---
schema: 1
id: DEC-188
title: "The checkout box is the cancellation terms: it gates payment, records nothing"
topic: "Reservations & payments"
status: "active"
date: "2026-09-28"
ruling: "The one box at checkout, and on the payment link, is the published cancellation terms as its own label. Book & pay stays off until it is ticked and the server refuses without it. Nothing is stored: no timestamp, no version."
claims:
  - kind: "file"
    target: "app/(public)/book/checkout/actions.ts"
    note: "agreedToTerms is the server-side gate; nothing is written"
  - kind: "file"
    target: "app/(public)/book/checkout/checkout-form.tsx"
    note: "the terms box; CANCELLATION_TERMS is its label"
  - kind: "file"
    target: "db/migrations/20260929031317_drop_reservation_terms_consent.sql"
  - kind: "spec"
    target: "2.8.4"
revisit_if: "A dispute needs proof of which terms a customer accepted, or the terms start to differ by offering"
amends_spec:
  - section: "2.8"
    scope: "2.8.4's checkout step: the box is the cancellation terms, not waiver consent, and it is not recorded"
---

## DEC-188: The checkout box is the cancellation terms: it gates payment, records nothing

The box was named a liability waiver and stamped `waiver_consent_at` / `waiver_version` on the
booking. It was never the waiver, which is its own module signed per guest (DEC-187). Issue #1112.

Operator, 2026-09-28: *"I'm happy with the checkbox and the wording. I see no point in saving the
'click' or v1."* Stripe's evidence for a cancellation dispute is the policy text as shown and proof
of agreement. The `v1` label proved neither the words nor that they had not changed, and nobody
has had a dispute to spend it on.

*Rejected: storing the rendered terms on each booking.* That is Stripe's evidence, kept for a
dispute that has not happened. The terms come from two constants in `refund-terms.ts`, and the
confirmation already carries them.

The payment link (issue #1082) shows the same box.
