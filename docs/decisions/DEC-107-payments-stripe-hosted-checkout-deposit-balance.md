---
schema: 1
id: DEC-107
title: "Sales tax is read live, not frozen onto the booking"
topic: "Reservations & payments"
status: "superseded"
date: "2026-08-19"
ruling: "The sales tax rate is read fresh whenever a balance is worked out, rather than frozen onto the booking. Safe only because no operator surface can change it — altering it takes someone at a database prompt on purpose."
claims:
  - kind: "file"
    target: "src/reservations/payment-config.ts"
  - kind: "unverifiable"
    target: "no surface under app/ calls setPaymentConfig, so the rate is not browser-editable"
    note: "a grep, not a check — nothing fails if a surface adds one"
revisit_if: "a rate change actually happens, which forces the question of which date governs"
---

## DEC-107: Sales tax is read live, not frozen onto the booking

Freezing a copy of the rate on every reservation was rejected as the wrong shape rather than
as overkill. Sales tax is not a per-customer term; it is a jurisdiction's rate on a date, and
storing the same number a hundred thousand times answers a question the jurisdiction already
answers.

The exposure that would make freezing necessary — an operator correcting a typo mid-season and
silently repricing every open balance — needs a browser path to the rate, and there is none.
That is what makes the live read safe, so it is the thing to check before adding one.
