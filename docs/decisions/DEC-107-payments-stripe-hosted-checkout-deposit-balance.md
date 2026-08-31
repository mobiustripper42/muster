---
schema: 1
id: DEC-107
title: "Sales tax is read live, not frozen onto the booking"
topic: "Reservations & payments"
status: "withdrawn"
date: "2026-08-19"
ruling: "Retired. The spec froze the tax instead — read §2.8.4a, not this."
claims:
  - kind: "spec"
    target: "2.8.4a"
revisit_if: "nothing — this is a signpost; §2.8.4a is the live answer and is where a change belongs"
---

## DEC-107: Sales tax is read live, not frozen onto the booking

Superseded by the spec, not by another decision. §2.8.4a freezes **every** money component onto the
reservation at checkout, tax included, and gives the reason: nothing recomputes from live settings,
because a rate can change between the quote and the payment and the customer must get what they
were shown.

Read §2.8.4a. The argument that stood here — that a jurisdiction's rate is not a per-customer term,
and that storing the same number a hundred thousand times answers a question the jurisdiction
already answers — lost to that, and is in `git log -p docs/decisions/DEC-107-*.md` if it is ever
wanted again.

Cut to a signpost on 2026-08-30, during the §2.8 conformance audit, because the full text was still
being read as live: an agent quoted the title as a contradiction of the spec, and
`src/reservations/create-departure-payment-intent.ts:11` cites *"the DEC-107 freeze rule"* — naming
this record for the opposite of what it ruled.

The filename is older than the record. It says hosted checkout and deposit-balance; the record was
rewritten to be about sales tax and the name never followed.
