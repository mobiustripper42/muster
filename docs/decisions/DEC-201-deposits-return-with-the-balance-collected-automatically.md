---
schema: 1
id: DEC-201
title: "Deposits return, with the balance collected automatically"
topic: "Reservations & payments"
status: "draft"
date: "2026-11-08"
ruling: "A booking pays a deposit, and the card saved on it is charged for the balance before the trip. Full payment at booking is the exception, not the posture."
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

Issue #1235. Operator, 2026-11-07 and 2026-11-08. The mechanics are in `docs/SPEC.md §2.8.4d`.

- **Why DEC-155 fell.** It took deposits out because nothing collected the balance (issue #712), so
  most of the revenue waited on the operator texting a link. That was a missing build, not a reason
  against deposits. A balance charged to a saved card, with retries and a release, removes it.
- **Rejected: full payment at booking.** It stays only as the exception, inside the balance window.
- **Rejected: a card on file for the customer.** Customers are matched by phone; a match error
  would charge a stranger's card. The card is saved for one booking's balance.
- **Rejected: the tax rate read at finalization.** A balance would change after it was quoted, on a
  card saved for the quoted figure. The rate is frozen at booking, as 2.8.4 already rules.
- **Rejected: the release as a customer cancel.** Under the published terms it would return the
  deposit less the fee. The terms gain a sentence instead, so the forfeit is agreed to.
