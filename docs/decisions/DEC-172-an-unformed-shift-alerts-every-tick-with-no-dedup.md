---
schema: 1
id: DEC-172
title: "An unformed shift alerts every tick, with no dedup"
topic: "Outbound notifications & operator relay"
status: "active"
date: "2026-09-13"
ruling: "A vessel-day that fails to form texts every active admin every tick, naming the boat and the day. No dedup and no state, unlike the At-Risk alert on the same lane."
claims:
  - kind: "file"
    target: "src/adapters/forward-formation-alert.ts"
    note: "the sender; grouped by cause, best-effort per recipient"
  - kind: "file"
    target: "app/api/cron/tick/route.ts"
    note: "the call site, beside the console.error it replaces as the control"
revisit_if: "Formation failures become common enough that the volume is noticed instead of the failure — which would itself be the bug"
---

## DEC-172: An unformed shift alerts every tick, with no dedup

A boat with no crew shift means nobody was asked to work it. Since #957 that no longer aborts the
run — it lands in `FormResult.failures` and the tick logs it. A log line is not a control: nobody
reads one that repeats every fifteen minutes. You read it after being told a trip had no crew.

DEC-095's At-Risk alert rides the tick's per-(shift, reason) dedup, so a steady board fires nothing.
This deliberately does not. One text about an unformed shift is a drop-everything, so the repeats
are self-limiting; if it ever floods, the flood is itself the bug. A stateful alert is also one that
can go quiet at the wrong moment, which is the failure this was filed against.

One grouping, which is a different case rather than dedup: many vessel-days failing with one shared
error in a single tick is one outage, and sends one message naming the scale and the cause. Isolation
turns a dead pool into an entry per boat rather than one abort, so fanning out would bury the fact
that matters. Distinct causes still fan out.

Rejected: a counter on `/admin/shifts`. A permanent display for a state that must never occur is a
confession with a number beside it.
