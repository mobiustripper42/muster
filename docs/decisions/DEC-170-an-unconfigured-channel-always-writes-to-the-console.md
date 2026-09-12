---
schema: 1
id: DEC-170
title: "An unconfigured channel always writes to the console — for every audience"
topic: "Outbound notifications & operator relay"
status: "active"
date: "2026-09-12"
ruling: "Twilio unset routes every message to the console — crew, customer and admin alike. Only the report to a human distinguishes a log line from a send."
claims:
  - kind: "file"
    target: "app/lib/sms.ts"
    note: "makeSmsChannel is the one construction; the nullable one is no longer exported"
  - kind: "file"
    target: "app/lib/alert.ts"
    note: "the At-Risk alert no longer returns 0 when Twilio is dark"
revisit_if: "Log volume from a Twilio-dark production deploy starts hiding real failures, or an audience appears whose message must not be written down"
---

## DEC-170: An unconfigured channel always writes to the console — for every audience

Supersedes only DEC-095's no-relay-fallback clause ("Twilio unset ⇒ no send; the board is the
standing fallback"). The rest of DEC-095 still governs.

A board is a fallback for somebody looking at it, and the reason that alert exists is that nobody
is — DEC-095 says so itself. "No one to relay to" was the right observation and the wrong
conclusion. The console is not a relay, it is the record, and an alert with no record did not
happen.

Nine send sites each answered "what if there is no channel" and produced nine answers, four of
which dropped the message. That was possible because a nullable constructor was exported and every
caller had to decide what null meant. It is no longer exported, so a tenth site cannot invent a
tenth answer.

`live` is not "should I send" — the send is unconditional. It is "may I tell a human this was
sent." `resendReservationLink` still returns `skipped` when nothing live was behind it, so an
operator is never shown "Sent" for a message that reached a terminal.
