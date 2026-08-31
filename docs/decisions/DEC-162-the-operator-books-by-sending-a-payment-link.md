---
schema: 1
id: DEC-162
title: "The operator books by sending a payment link"
topic: "Reservations & payments"
status: "active"
date: "2026-08-29"
ruling: "An operator taking a booking by phone never types the card. They write the booking and send the customer a link to pay."
claims:
  - kind: "spec"
    target: "2.10.6"
revisit_if: "a card-present terminal or a Stripe-hosted operator flow makes taking payment on the call possible without card data reaching us"
amends_spec:
  - section: "2.10"
    scope: "2.10.6 adds the operator booking surface, taking payment by link rather than by card entry"
---

## DEC-162: The operator books by sending a payment link

### Context

Nothing in `app/(admin)/` created a reservation, so no booking could be taken by phone at any
notice or price. `docs/design/reservations-admin.md:31` explains the gap: the admin surfaces were
enumerated from Xola screenshots, and the book-for-a-customer screen was not one of them.

### Decision

The operator never types a card. *Rejected: a card field on the admin form.* It is the obvious
build, and it moves the product out of the lightest card-compliance tier, which applies only
because card numbers never reach our servers. That cost lands on the whole product and stays
invisible until an audit asks.

So the booking is written, holds the boat at once, and a link goes to the customer. It confirms
through the same path as any other sale — one payment, the whole amount, unrelated to §2.8.10's
balance charge, which may never create or confirm a reservation.

### What this costs

The customer leaves the call not yet booked. Nothing is confirmed until they open the link and pay,
so the operator hangs up holding a boat for someone who may never come back. See DEC-163 for what
happens to that boat.
