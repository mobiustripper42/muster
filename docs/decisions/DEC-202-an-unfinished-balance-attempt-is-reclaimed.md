---
schema: 1
id: DEC-202
title: "An unfinished balance attempt is reclaimed, under the same key"
topic: "Reservations & payments"
status: "active"
date: "2026-11-19"
ruling: "A balance attempt claimed and never finished is taken over by a later run once it is older than the tick's longest possible run, and re-sent under its own idempotency key. Message claims stay at-most-once."
claims:
  - kind: "file"
    target: "src/reservations/balance-charge.ts"
  - kind: "spec"
    target: "2.8.4d"
revisit_if: "The tick route's maxDuration is raised to within the reclaim age, or the balance job leaves the tick"
---

## DEC-202: An unfinished balance attempt is reclaimed, under the same key

Issue #1254. See DEC-201 and `docs/SPEC.md §2.8.4d`.

- **Why the reminders' pattern is not enough here.** A claim that outlives its process blocks its
  attempt for good. A lost reminder costs a nudge; a lost last attempt leaves the balance uncollected
  with no failed charge to tell anyone, and the release then keeps the deposit.
- **Why a re-send is safe.** One balance intent per booking, which Stripe lets succeed once, and an
  intent that already succeeded is read and recorded before anything is sent. The worst re-send is
  one more decline on the same attempt.
- **The age sits above the tick route's pinned `maxDuration`**, so a reclaim never races a live run.
- *Rejected: the past-due list as the backstop.* DEC-201's revisit_if names hand-chasing as the failure.
- *Rejected: fencing finish and release on `attempted_at`.* The pinned duration already rules out a
  live owner.
