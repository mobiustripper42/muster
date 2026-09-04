---
schema: 1
id: DEC-109
title: "Atomic capacity claim on public booking (the customer-side REQ-CLAIM-1)"
topic: "Reservations & payments"
status: "withdrawn"
date: "2026-08-26"
ruling: "Retired. The spec replaced the checkout hold with the pending reservation — read §2.8.1, not this."
claims:
  - kind: "spec"
    target: "2.8.1"
revisit_if: "nothing — this is a signpost; §2.8.1 is the live answer and is where a change belongs"
---

## DEC-109: Atomic capacity claim on public booking (the customer-side REQ-CLAIM-1)

Superseded by the spec, not by another decision. §2.8.1 writes the `Reservation` itself, in state
`pending`, before the customer pays, and that row is what occupies the boat. There is no separate
hold table and no second record to keep in step with the first.

Read §2.8.1. What stood here — a `checkout_holds` row taken under the hull-day lock and released
by a sweep — was adjudicated dead on 2026-08-26 during the reservations decision decomposition
(issue #816), and is in `git log -p docs/decisions/DEC-109-*.md` if it is ever wanted again.

Converted to a v1 signpost on 2026-09-04 (task 14.1) because the v0 stub was frozen in the
baseline and carried no `status`, so it still read as live to the gate. Code that cites this
record (`src/reservations/claim.test.ts`, `create-departure-payment-intent.ts`) is citing the
retired hold; Phase 14 removes it.
