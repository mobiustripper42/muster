---
schema: 1
id: DEC-164
title: "The frozen money is one value on our own row"
topic: "Reservations & payments"
status: "active"
date: "2026-08-30"
ruling: "What the customer was quoted is frozen as one `booking_invoice` on the reservation — not a column per component, and not in Stripe metadata."
claims:
  - kind: "file"
    target: "src/reservations/booking-webhook.ts"
    note: "rebuilds the booking from metadata, defaulting missing keys to 0"
revisit_if: "a component has to be queried directly, which makes that one a column like the timestamps already are"
amends_spec:
  - section: "2.8"
    scope: "2.8.4 names `booking_invoice` as the frozen money and keeps anything with a time in it a column"
---

## DEC-164: The frozen money is one value on our own row

### Context

The frozen money lives in Stripe metadata today — eighteen keys carrying the slot, the money and
the customer — and the webhook rebuilds the booking from them. No decision established that; §2.8.5
and §2.8.14 already forbid it, and issue #812 asks for the retool.

The read is the sharp part: `Number(charge.metadata.taxCents ?? 0)`. A dropped key produces a
booking recorded with zero tax, and nothing raises.

### Decision

One JSON value on the reservation, holding every §2.8.4a component in integer cents and the rate
behind each. *Rejected: a column per component.* The set is not fixed — add-ons are a list and a
discount is coming — so that shape wants a migration every time §2.8.4a gains a row.

*Rejected: leaving it at Stripe.* A payment processor is not a store of record, and a booking
assembled from what it hands back can arrive with a component silently missing.

Times stay columns, because those get queried and JSON does not. The freeze instant is §2.8.1's
reserved time, not a new field.

### What this costs

No component can be summed in SQL without reaching into JSON. Reporting that needs one promotes it
to a column; the invoice keeps the rest.
