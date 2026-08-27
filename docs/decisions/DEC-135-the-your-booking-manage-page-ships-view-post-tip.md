---
schema: 1
id: DEC-135
title: "Cancelling is a request to the operator, not self-service"
topic: "Reservations & payments"
status: "active"
date: "2026-07-17"
ruling: "A customer asking to cancel or change sends the operator a request rather than doing it themselves. The refund policy exists in code, but flex insurance is not attached to a booking, so nothing can tell which terms a customer bought."
claims:
  - kind: "spec"
    target: "§2.8.12"
  - kind: "file"
    target: "src/reservations/booking-change-request.ts"
  - kind: "file"
    target: "src/reservations/refund-terms.ts"
  - kind: "unverifiable"
    target: "no customer-facing cancel action exists under app/b/, and no reservation carries a flex flag"
revisit_if: "issue #683 makes flex insurance sellable, which is the last thing self-service cancel is missing"
---

## DEC-135: Cancelling is a request to the operator, not self-service

Real self-service cancel needs the refund policy as code and flex insurance attached to the
booking. The policy landed at issue #619 and is tested. The flag did not: nothing writes flex
onto a reservation, so `refundOwedCents` takes it as a parameter that every caller leaves
false.

That gap is the whole reason this is still a request. Self-service without it would quote the
standard window to a customer who paid for the shorter one — a wrong number, given to the
person who bought the thing that makes it wrong.

So the customer writes, the terms are shown beside the form, and the operator acts. That is
needed whether or not self-service ever ships, which is what makes it a first cut rather than
a placeholder.

One deliberate loosening, worth naming: the page lists the contact's *other* trips, so holding
any one link surfaces all of them. Accepted — same person — but it widens what a link reaches.

What the page shows is `SPEC.md` §2.8.12.
