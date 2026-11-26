---
schema: 1
id: DEC-204
title: "A refund is owed by its record, and the job may send it"
topic: "Reservations & payments"
status: "active"
date: "2026-11-26"
ruling: "Every refund Muster sends is written down before Stripe is asked, sent under a key from that record, and finished when its result is written. The job finishes any a press could not."
claims:
  - kind: "spec"
    target: "2.8.4c"
  - kind: "spec"
    target: "2.8.7"
  - kind: "file"
    target: "src/reservations/refund-payment.ts"
supersedes:
  - DEC-198
revisit_if: "Stripe stops holding an idempotency key for 24 hours, or a dashboard refund needs a record of its own"
amends_spec:
  - section: "2.8"
    scope: "2.8.4c: the cancel and its refund are one write, finished by the job; 2.8.7: the sold-out refund is a record"
---

## DEC-204: A refund is owed by its record, and the job may send it

Issue #1278. Supersedes DEC-198's "only the press that cancelled refunds"; its other holdings live in
`docs/SPEC.md §2.8.4c` and `§2.8.12`.

- **The record is the lock.** One unfinished record per booking, the sold-out reason excepted, replaces
  the refund lease. The cancel's own write inserts it, so a cancel never commits with its refund lost.
- **Any run may send it.** The key comes from the record; a press and the job send through one function,
  and the job asks Stripe for a refund carrying the record's id first.
- **No answer is not a refusal:** the record stays unfinished and reads `unknown`.
- **Given up at 24 hours, with no call.** Stripe keeps a key that long, so a later send could move the
  money twice. The record finishes short and every active admin is told which booking and how much.
- **A bank failure is recorded without waiting for Stripe**, whose docs do not say whether the
  charge's refunded amount drops.
- *Rejected: a new key after 24 hours.* A refund has no once-only intent, so a second key is a second
  refund. DEC-202's argument for re-sending does not carry over; see also DEC-202.
