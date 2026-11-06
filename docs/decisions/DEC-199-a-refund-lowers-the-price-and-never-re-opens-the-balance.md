---
schema: 1
id: DEC-199
title: "A refund lowers the price and never re-opens the balance"
topic: "Reservations & payments"
status: "active"
date: "2026-11-04"
ruling: "On a booking still going ahead, a refund lowers the trip's price by the same amount, so it never creates or raises a balance. The balance counts every payment that took money at its gross amount."
claims:
  - kind: "spec"
    target: "2.8.10"
  - kind: "file"
    target: "src/reservations/payment-config.ts"
  - kind: "file"
    target: "src/reservations/create-balance-checkout.ts"
revisit_if: "A refund comes off the balance, not the card (issue #1222), a refund must re-open what is owed, or a refunded duplicate stops counting as paid (audit F2)"
amends_spec:
  - section: "2.8"
    scope: "2.8.10: a refund on a booking still going ahead lowers the price and the amount paid together, and never re-opens the balance"
---

## DEC-199: A refund lowers the price and never re-opens the balance

Issue #841. Operator, 2026-11-04: a refund means the price went down.

- **The rule.** `balanceOwedCents` sums every payment that took money (`tookMoney`) at its gross
  amount less tip, fee and insurance. `refundedCents` is not read. A booking paid in full and then
  refunded still owes nothing; a refund of an overcharge leaves the balance below zero, shown as settled.
- **Rejected: tip-first netting (issue #522).** A refund came off tip and fee first, then reduced
  what counted as paid. A goodwill refund past them showed the customer a balance that
  `createBalanceCheckout` would charge unattended.
- **Rejected: a gate on the live `depositMode` setting** (the first proposal). It says what
  the operator sells today, not how this booking was paid.
- **Unchanged.** A disputed or lost row contributes nothing and the balance link still refuses it.
  The overpay alert still fires on a negative balance.
- **Out of scope.** A refund that comes off the balance, and tax, fee and tip following a refund: issue #1222.
