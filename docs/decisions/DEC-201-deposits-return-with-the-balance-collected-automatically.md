---
schema: 1
id: DEC-201
title: "Deposits return, with the balance collected automatically"
topic: "Reservations & payments"
status: "active"
date: "2026-11-08"
ruling: "A booking may pay a fixed deposit, and the card saved on it is charged for the balance before the trip. Paying in full is the customer's choice."
claims:
  - kind: "spec"
    target: "2.8.4d"
  - kind: "file"
    target: "src/reservations/payment-config.ts"
supersedes:
  - DEC-155
revisit_if: "Automatic collection cannot be ready before the first balance falls due, or failed balances become routine enough that the operator chases them by hand"
amends_spec:
  - section: "2.8"
    scope: "2.8.4d: a deposit at booking and an automatic balance; 2.8.4a, 2.8.10 and the open questions point at it"
  - section: "2.10"
    scope: "2.10.6: the payment link takes the deposit and saves the card"
---

## DEC-201: Deposits return, with the balance collected automatically

Issue #1235. Operator, 2026-11-07 to 2026-11-09. See `docs/SPEC.md §2.8.4d`.

- **Why DEC-155 fell.** It took deposits out because nothing collected the balance (issue #712).
  That was a missing build, not a reason against deposits: a saved-card charge, with retries and a
  release, removes it.
- **A fixed deposit, and optional.** A percent can fall below the insurance it must cover. The
  customer may pay in full instead (operator, from Xola's checkout), and then no card is saved.
- **Rejected: a card on file for the customer.** Customers are matched by phone; a match error
  would charge a stranger's card. The card is saved for one booking.
- **Rejected: updating an open intent to save the card.** Stripe's documentation does not show it,
  so a retry that changes the answer retires the intent and mints a fresh one.
- **Rejected: the tax rate read at finalization.** The balance would change after it was quoted.
- **Rejected: the release as a customer cancel.** It would return the deposit less the fee. The
  terms gain a sentence instead.
