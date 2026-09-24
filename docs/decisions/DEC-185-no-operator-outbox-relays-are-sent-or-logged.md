---
schema: 1
id: DEC-185
title: "No operator outbox — every relay is sent by SMS or written to the log"
topic: "Outbound notifications & operator relay"
status: "active"
date: "2026-09-24"
ruling: "Asks, doorbell rings and assignment notices go out through makeSmsChannel: real SMS when Twilio is configured, a log line when it is not. No relay is queued for a human to send, and the three outbox tables are dropped."
claims:
  - kind: "file"
    target: "app/lib/sms.ts"
    note: "makeSmsChannel — Twilio, or the log channel; never a queue"
supersedes:
  - DEC-030
  - DEC-073
revisit_if: "A deploy needs messages to reach crew with no SMS provider at all"
---

## DEC-185: No operator outbox — every relay is sent by SMS or written to the log

DEC-030 made the pilot channel a queue: each ask became a row the operator texted by hand from
`/admin/outbox`. DEC-073 gave doorbell rings their own table on the same page, and DEC-084 added a
third for assignment notices. Twilio (DEC-MSG-1) made the queue a fallback, and issue #934 replaced
the fallback with a channel that writes the message to the log and deleted the screen.

Issue #935 finishes it: the three tables, twelve port methods and the integrity scans go. Production
held 0, 4 and 17 rows — relay cards from before #934 that nothing had read since.

Two of DEC-030's rules outlive the outbox and stand: adapter state is persisted through the port
but never read by the domain (DEC-056 leans on it), and channel wiring and actors live at the edge,
never in the core (DEC-118). An ask is answered in the app with no inbound SMS (SPEC §2.6.1).
DEC-084's notice rules stand; only its outbox delivery path is gone.
