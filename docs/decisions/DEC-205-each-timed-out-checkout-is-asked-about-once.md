---
schema: 1
id: DEC-205
title: "Each timed-out checkout is asked about once, and a person catches the rest"
topic: "Reservations & payments"
status: "active"
date: "2026-11-27"
ruling: "The reconciler asks Stripe once about each timed-out public checkout, books it if paid, and texts every admin when it cannot tell 2 hours past the window. What it misses is a person's to catch."
claims:
  - kind: "spec"
    target: "2.8.9"
  - kind: "file"
    target: "src/reservations/reconciler.ts"
revisit_if: "the webhook-health text fires once in production, or a paid checkout is found that the job filed as never paid"
---

## DEC-205: Each timed-out checkout is asked about once, and a person catches the rest

Issue #1236, build 2 of pattern 1 (`docs/audit/README.md`). The job's rules live in
`docs/SPEC.md §2.8.9`; this records the forks that stay live.

- **Asked once.** A checkout is checked when Stripe said nothing was paid, the booking or the sold-out
  refund went through, or the 2-hour text went out. No answer is not "nothing paid": the row stays
  unchecked and is asked about again.
- **One way to book.** The job calls the confirm the success page and the webhook use. DEC-179's
  revisit condition fires and the answer is no change; see also DEC-179.
- **A person catches the rest.** Other messages lost in the outage are caught by the admin who gets the
  webhook-health text and resends from Stripe; a phone booking paid by link, by the operator who made it.
- *Rejected: asking on every tick.* Seven more Stripe reads per abandoned checkout.
- *Rejected: replaying undelivered messages.* A new table, a Stripe call and an hourly pass.
- *Rejected: a second list for phone bookings paid by link.*

Honors DEC-169 (the list reads the checkout's row, never a payment row), DEC-182 and DEC-204.
