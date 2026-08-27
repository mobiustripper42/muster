---
schema: 1
id: DEC-135
title: "Cancelling is a request to the operator, not self-service"
topic: "Reservations & payments"
status: "active"
date: "2026-07-17"
ruling: "A customer asking to cancel or change sends the operator a request rather than doing it themselves, because self-service needs a refund policy in code and a flex-insurance flag on the booking, and neither exists."
claims:
  - kind: "spec"
    target: "§2.10.2"
  - kind: "file"
    target: "src/reservations/booking-change-request.ts"
  - kind: "unverifiable"
    target: "no customer-facing cancel action exists under app/b/"
revisit_if: "issue #472 settles the refund schedule and issue #683 makes flex insurance sellable"
---

## DEC-135: Cancelling is a request to the operator, not self-service

Real self-service cancel needs two things the system does not have: the refund schedule as
code, and flex insurance attached to a booking. Faking it — self-service for flex holders only
— would mean shipping a promise that depends on a flag nothing can set.

So the customer writes and the operator acts. That is needed regardless of whether the
self-service version ever ships, which is what makes it the right first cut rather than a
placeholder.

One consequence is a deliberate loosening worth naming: the page lists the contact's *other*
trips, so holding any one link surfaces all of them. Accepted, because it is the same person —
but it is a widening of what a link reaches, and it was not free.

What the page shows and what is deferred are `SPEC.md` §2.10.2.
