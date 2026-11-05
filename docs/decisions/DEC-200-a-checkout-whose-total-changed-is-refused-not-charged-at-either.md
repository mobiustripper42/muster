---
schema: 1
id: DEC-200
title: "A checkout whose total changed is refused, not charged at either price"
topic: "Reservations & payments"
status: "active"
date: "2026-11-05"
ruling: "The checkout sends the due-now total the page showed, and the server refuses any attempt whose frozen due-now total differs, in either direction. Nothing is written or charged."
claims:
  - kind: "spec"
    target: "2.8.4"
  - kind: "file"
    target: "src/reservations/create-departure-payment-intent.ts"
revisit_if: "Checkout can show a changed total and accept it in place, without a reload"
amends_spec:
  - section: "2.8"
    scope: "2.8.4: the checkout compares the total the page showed with the one it would freeze, and refuses a difference"
---

## DEC-200: refused, not charged at either price

Issue #1217. See also DEC-197, the same choice for insurance. DEC-164 is unchanged.

- **Both alternatives were wrong.** The new total bills a figure the guest never saw. The old one
  bills a price the operator withdrew. Refusing leaves both at a number they agreed to.
- **No tolerance.** A cent is a different total, so the rule is equality and nothing to defend.
- **A refusal ends the claim.** The next boat would be a second price the guest never saw.
- **A paid row says so.** `already_paid`, because "you have not been charged" would be false.
- **Not the payment link.** It charges the frozen invoice it shows, so the two cannot differ.
- **Left alone.** On a departure whose boats are priced differently, a reload can keep showing
  a total the claim will not give. Pricing the page on the boat the claim would take is a
  separate change.

The mechanics are in the spec.
