---
schema: 1
id: DEC-165
title: "Occupancy never reads a payment row"
topic: "Reservations & payments"
status: "active"
date: "2026-09-03"
ruling: "A reservation holds a boat because it exists, not because it is paid — so §2.8's last-but-one criterion is about money, not about Xola."
claims:
  - kind: "spec"
    target: "2.8"
  - kind: "file"
    target: "src/reservations/availability.ts"
    note: "hull occupancy walks every scheduled event and consults no payment"
revisit_if: "an unpaid reservation should stop holding its boat before its window expires, which would make payment an occupancy input"
amends_spec:
  - section: "2.8"
    scope: "the acceptance criterion 'an imported Xola reservation … still occupies its hull' is restated as a payment-independence rule that outlives the importer"
---

## DEC-165: Occupancy never reads a payment row

See also DEC-161, which fixes the *unit* of occupancy; this fixes what triggers it.

### Context

The criterion read *"an imported Xola reservation, which has no payment recorded, still occupies its
hull."* Xola is removed at the cutover (DEC-126), so as written it expires with the importer.

Xola was never the subject — it was the only unpaid reservation that existed when the line was
written. A `pending` row is the next one; a live checkout hold is a third.

### Decision

Restate it as the rule: **no occupancy decision consults a payment.** An imported booking occupies
through its `Event`, a hold through its expiry, and a `pending` reservation through its own row with
no `Event` at all (§2.8's `eventId`-null criterion). All three hold a hull with nothing paid.

*Rejected: deleting it.* It is the only criterion that fails if someone makes occupancy conditional
on a `Payment` — a plausible thing to write while chasing a stale hold.

*Rejected: keeping Xola as the example.* A criterion naming a subsystem on its way out reads as
retired long before it is, and the code path has nothing Xola-specific in it.
