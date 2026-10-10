---
schema: 1
id: DEC-196
title: "The service fee is on everything but tax, and is not taxed"
topic: "Reservations & payments"
status: "active"
date: "2026-10-09"
ruling: "Tax is on what reaches the operator's bank — fare, extras, add-ons, insurance. The service fee is the provider's, is charged on everything except tax, tip included, and is not taxed."
claims:
  - kind: "spec"
    target: "2.8.4a"
  - kind: "file"
    target: "src/reservations/discount.ts"
supersedes:
  - DEC-134
revisit_if: "Research shows Ohio taxes the provider's service fee, or the fee stops going to a separate entity"
amends_spec:
  - section: "2.8"
    scope: "2.8.4a: the fee base gains insurance and the tip; tax gains insurance; the fee is the provider's and untaxed"
---

## DEC-196: the fee is on everything but tax

Operator, 2026-10-09 (16.8).

- **Tax follows the money into the operator's bank.** Fare, extras, add-ons and insurance are
  taxed. The tip goes to crew and the fee to the provider, so neither is.
- **The fee is on everything except tax** — the tip included, which reverses the fare-only base
  DEC-134 set. A customer who tips more pays a larger fee.
- **Not taxed is the operator's reading, not researched.** Whether Ohio taxes a provider's fee is
  open; if it does, the fee joins the taxable base in `chargeTotals` and nowhere else.

One function, `chargeTotals`, sums both, for the frozen invoice and every screen.
