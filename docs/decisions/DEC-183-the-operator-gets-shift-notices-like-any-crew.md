---
schema: 1
id: DEC-183
title: "The operator gets shift notices like any crew member"
topic: "Outbound notifications & operator relay"
status: "active"
date: "2026-09-23"
ruling: "An assignment notice goes to everyone put on, taken off, or whose shift changed — the operator included, whoever drove the change. Only the doorbell still skips admins — every active one, not a configured id (DEC-072)."
claims:
  - kind: "file"
    target: "src/builder/form-notices.ts"
    note: "formNoticeChanges takes no operator id"
revisit_if: "The operator is routinely texted about a change they just made on screen and asks for that to stop"
---

## DEC-183: The operator gets shift notices like any crew member

DEC-084 opens with the operator's principle: someone put on or taken off a shift always gets a
message, whatever the phase. It then carved the operator out, for a narrow case — a merge dropping
them from side B would tell them about their own action. That narrow case became an identity filter
on every notice, including the four that no operator drives: the cron tick, the Xola pull, a
booking, a cancel. A customer booking onto the operator's boat told every other crew member and
not the operator.

Operator, 2026-09-12: the exclusion goes entirely, not conditioned on who drove the change. The
operator is staff, holds seats, and works; a text about your own action is the cost of one rule
that is always true.

Retires DEC-084's operator-exclusion clause only (issue #1009); the rest of DEC-084 stands.

With it went the last reason for one configured operator id (issue #293). Every admin is crew
(DEC-092), so the office posts under whichever admin is signed in, and the doorbell's DEC-072
exclusion now skips every active admin rather than one hardcoded id.
