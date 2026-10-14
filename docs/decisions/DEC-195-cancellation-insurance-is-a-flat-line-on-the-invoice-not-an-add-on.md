---
schema: 1
id: DEC-195
title: "Cancellation insurance is a flat line on the invoice, not an add-on"
topic: "Reservations & payments"
status: "active"
date: "2026-10-08"
ruling: "Insurance is bought with the booking and frozen on the invoice as its own line, kept on an insured cancellation in place of the fee. The refund policy reads only what was charged for it. A discount reaches it last, so it can be comped."
claims:
  - kind: "spec"
    target: "2.8.4a"
  - kind: "spec"
    target: "2.8.4c"
  - kind: "file"
    target: "src/reservations/refund-terms.ts"
  - kind: "file"
    target: "src/reservations/discount.ts"
supersedes:
  - DEC-113
revisit_if: "An add-on is ever sold, or the operator wants insurance bought after booking"
amends_spec:
  - section: "2.8"
    scope: "2.8.4a gains a cancellation-insurance component and the discount reaches it last; 2.8.4c sells it and replaces the fee with it; 2.8.14 settles the reversal"
---

## DEC-195: insurance is a line, not an add-on

Operator, 2026-10-07 and 2026-10-09 (16.8, issue #683).

- **Not an add-on row.** The operator chose one on 2026-08-06. It is taxed and fee'd like one
  (DEC-196), but it is what an insured cancellation keeps in place of the fee, and a picker row would
  carry no such rule. Settled here.
- **A number to the policy.** `refund-terms.ts` takes what was charged for it and never reads the
  invoice, so how the line is priced cannot reach the refund math.
- **Fare first, then insurance.** A partial discount never touches it; typing past the fare does. The
  operator asked for insurance to be compable. A comp keeps it — the window is what was bought,
  not what was paid.
- **Its own payment carve-out, with its tax**, beside tip and fee, so a deposit balance never counts
  either as fare.

The amounts and the window are §2.8.4c's.
