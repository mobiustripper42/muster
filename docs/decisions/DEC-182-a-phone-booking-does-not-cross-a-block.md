---
schema: 1
id: DEC-182
title: "A phone booking does not cross a block — unblock it, then book"
topic: "Reservations & payments"
status: "active"
date: "2026-09-23"
ruling: "The operator's booking refuses a blocked slot, a departed trip and an offering that is not live. It still passes the schedule grid and the season."
claims:
  - kind: "file"
    target: "src/reservations/claim.ts"
    note: "OPERATOR_RULES; `blocked` is a named refusal"
  - kind: "spec"
    target: "2.10.6"
revisit_if: "The operator unblocks-then-books often enough that the second step is friction rather than a deliberate choice"
amends_spec:
  - section: "2.10"
    scope: "2.10.6's operator table: a block refuses instead of passing with a warning, and a departed trip and a non-live offering refuse"
---

## DEC-182: A phone booking does not cross a block — unblock it, then book

§2.10.6 said a block "passes, but is told": the operator could book through it and see a warning.
Operator, 2026-09-23: *"Unblock then book. If it's blocked, someone needs to make a real choice to
book."* A block is somebody's deliberate act, and a warning on a form is one click away from being
ignored. Lifting the block on the calendar is the real choice, and it is one more click.

*Rejected: a "Book anyway" button on the blocked card.* It makes crossing a block as easy as
booking an open slot, which is the thing a block exists to prevent.

The same review added two refusals the table never named. A departed trip refuses: it is a real
need for some operators, not this one (parked in `docs/FUTURE_IDEAS.md`). An offering that is not
live refuses: a draft has no schedule to book from, and hidden means retired.
