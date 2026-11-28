---
schema: 1
id: DEC-206
title: "Money that lands on a booking that cannot take it is refunded by hand"
topic: "Reservations & payments"
status: "active"
date: "2026-11-27"
ruling: "A payment on a cancelled booking, or a second payment on a paid one, is not refunded automatically: every admin is texted the customer, the amount and a link, and a person refunds it."
claims:
  - kind: "spec"
    target: "2.8.7"
  - kind: "spec"
    target: "2.10.6"
  - kind: "file"
    target: "src/reservations/booking-webhook.ts"
  - kind: "file"
    target: "src/reservations/pay-by-link.ts"
revisit_if: "two payments land on a booking that cannot take them in one season"
amends_spec:
  - section: "2.8"
    scope: "2.8.7: a payment on a cancelled booking, and a second payment on a paid one, are texted and refunded by hand"
  - section: "2.10"
    scope: "2.10.6: the payment link refuses a trip that has left or a blocked slot; a block over an unpaid phone booking says so"
---

## DEC-206: Money that lands on a booking that cannot take it is refunded by hand

Issue #1279, pattern 2 (`docs/audit/README.md`). The rules are in `docs/SPEC.md §2.8.7` and `§2.10.6`.

Operator, 2026-11-27: *"we text and hand refund."* It replaces the 2026-11-22 ruling of an automatic
refund.

- **A check cannot catch everyone.** A customer on their bank's approval screen when the cancel lands can
  still pay; what lands anyway is a person's.
- **On a cancelled booking the text is the only trace.** No payment row, no history row. A second payment on
  a paid booking is recorded so the Refund box can send it back; only its tip is skipped.
- **A hold over an unpaid phone booking is refused** with the existing `slot_taken`. A boat out or closure
  is saved and says how many are under it.
- *Rejected: an automatic refund.* Under once a year by guess, and it goes through pattern 1's four steps.

Honors DEC-184 (its other half) and DEC-204 (no refund is sent here). See also DEC-162.
