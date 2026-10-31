---
schema: 1
id: DEC-198
title: "Customers cancel online only when the terms refund something"
topic: "Reservations & payments"
status: "active"
date: "2026-10-31"
ruling: "A customer may cancel from the booking page only when the published terms would refund them something; the cancel and the refund happen in one press. Otherwise it stays a request to the operator."
claims:
  - kind: "spec"
    target: "2.8.12"
  - kind: "spec"
    target: "2.8.4c"
  - kind: "file"
    target: "src/reservations/customer-cancel.ts"
  - kind: "file"
    target: "app/b/[code]/actions.ts"
supersedes:
  - DEC-135
revisit_if: "The operator wants cancels inside the window handled online, or Xola or unpaid phone bookings get a self-service cancel"
amends_spec:
  - section: "2.8"
    scope: "2.8.12: cancelling is the customer's own action when the terms refund something; changing stays a request"
---

## DEC-198: Customers cancel online only when the terms refund something

Supersedes DEC-135, whose condition (insurance being sellable) fired. Issue #1074.

- **Offered only when it pays.** Operator, 2026-10-23: customers do not cancel without a refund;
  they call. Inside the window, or when the terms produce nothing, the request form stays and a
  person decides. Goodwill refunds are the operator's call.
- **Cancel first, then refund,** as the operator's own cancel does. The cancel frees the boat and
  tells the crew. A refund that fails leaves the booking cancelled, a `refund_failed` row and an
  email to the operator. Refund-first leaves a refunded customer holding a boat.
- **Refused by name, never re-quoted silently** (DEC-197's posture). The press posts the figure the
  confirm showed; if it moved, nothing is cancelled. A page left open across the window line
  cancels nothing and sends the customer to the team.
- **One press moves money once.** Only the press that did the cancelling refunds.
- **Tax is the operator's.** The refund is everything paid less the one published deduction.
