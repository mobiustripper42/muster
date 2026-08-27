---
schema: 1
id: DEC-126
title: "The flip from Xola is a cutover, not a natural drain"
topic: "Reservations & payments"
status: "active"
date: "2026-07-17"
ruling: "If Muster's reservations go live, the switch from Xola is a cutover — Muster becomes the single source of truth for bookings, rather than the two systems coexisting until Xola's forward book empties on its own."
claims:
  - kind: "file"
    target: "app/api/cron/xola-pull/route.ts"
  - kind: "unverifiable"
    target: "nothing that a cutover needs is built — no import, no rollback export, and the pull still runs"
revisit_if: "reservations get close enough to live that the cutover has to be designed rather than named"
amends_spec:
  - section: "0.3"
    scope: "the arc ends in a cutover with a one-time full Xola import — it had been written to \"no cutover\""
  - section: "4"
    scope: "the historical-data park is settled for the current season's forward book, which the cutover import brings across; pre-2026 reservations are never imported and the read-only archive posture stands for them"
---

## DEC-126: The flip from Xola is a cutover, not a natural drain

Two systems cannot both be the answer to "is this boat free". Coexistence was the pilot model,
where Muster sold a subset alongside Xola; the flip is the point where Muster takes over fully,
and the clean way to do that without double-selling is to bring Xola's forward book across in
one move rather than waiting for it to empty.

That sentence is the whole of what is decided. This record used to carry eight more rulings —
what the import covers, where the money lives afterwards, when the pull stops, how a cancel
routes, what makes the cutover reversible. Every one of them describes machinery that does not
exist, and writing them down early made them read as settled when they were guesses. They are
gone rather than amended.
