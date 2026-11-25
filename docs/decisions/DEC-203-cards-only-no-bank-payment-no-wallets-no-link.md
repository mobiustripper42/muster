---
schema: 1
id: DEC-203
title: "Cards only: no bank payment, no wallets, no Link"
topic: "Reservations & payments"
status: "draft"
date: "2026-11-25"
ruling: "Every payment Muster takes (pay in full, deposit, balance) is a card typed into the form, set in code rather than in the Stripe Dashboard. Bank payment, Apple Pay, Google Pay and Link are off."
claims:
  - kind: "spec"
    target: "2.8.14"
revisit_if: "The operator wants a wallet, or wants bank payment's lower fee badly enough to build a settling state"
amends_spec:
  - section: "2.8"
    scope: "2.8.14: bank payment and Link join wallets as methods this surface does not take"
---

## DEC-203: Cards only: no bank payment, no wallets, no Link

Issue #1268; built by issue #1288. Ruled by the operator 2026-11-25, for now; wallets may come later.

- **A bank debit does not fit a checkout that holds a boat for minutes.** Stripe settles it over days
  and it can fail after that (docs.stripe.com/payments/ach-direct-debit), so the boat is either resold
  meanwhile or held for money that may not come. No screen, row or job here has a state between
  unpaid and paid.
- **The balance is the one charge a debit could suit**, but it needs that state, a pause on the
  retries, and a rule for a debit that fails near the release.
- **Link is off although it confirms at once.** It can pay from a bank account and report a card
  (docs.stripe.com/payments/link/link-payment-integrations), so the balance charge would debit a bank
  account under a "this card" consent line.
- **Allowing only `card` is not enough.** Stripe shows wallets with it unless the form turns each off
  (docs.stripe.com/js/elements_object/create_payment_element).
- **Wallets are off by the same ruling**, not because they fail. Not tested: whether a wallet's card
  can be charged later for the balance. Test that first.
- *Rejected: bank payment for the balance only, on the manage page.* Fee savings against the above.
