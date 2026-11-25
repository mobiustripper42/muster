---
schema: 1
id: DEC-203
title: "Cards only: no bank payment, no wallets, no Link"
topic: "Reservations & payments"
status: "draft"
date: "2026-11-25"
ruling: "Every payment Muster takes (pay in full, deposit, balance) is a card typed into the form, and code says so, not the Stripe Dashboard. Bank payment, Apple Pay, Google Pay and Link are off."
claims:
  - kind: "spec"
    target: "2.8.14"
revisit_if: "The operator wants a wallet, or wants bank payment's lower fee badly enough to build a settling state"
amends_spec:
  - section: "2.8"
    scope: "2.8.14: bank payment and Link join wallets as methods this surface does not take"
---

## DEC-203: Cards only: no bank payment, no wallets, no Link

Issue #1268. Ruled by the operator 2026-11-25, for now; wallets may come later.

- **A bank debit does not fit a checkout that holds a boat for minutes.** Stripe settles it over days
  (docs.stripe.com/payments/ach-direct-debit) and can fail it after that, so the boat is either resold
  meanwhile or held for money that may not come. A settling debit must not count as paid, and no
  screen, row or job here has a state between unpaid and paid.
- **The balance is the only fit**, and would need that state, a pause on the retries, and a rule for a
  debit that fails near the release. A personal account can also dispute a debit for 60 days, finally.
- **Link is off although it confirms at once.** It can pay from a bank account and report a card, so
  the saved-card balance charge would debit a bank account under a "this card" consent line.
- **Code decides, because `card` alone is not enough.** Stripe shows wallets and Link with `card`
  allowed unless the form turns each off.
- **Wallets are off because the spec says so**, not because they fail. Not tested: whether a wallet's
  card can be charged later for the balance. Test that first.
- *Rejected: bank payment for the balance only, on the manage page.* Fee savings against the above.
