---
schema: 1
id: DEC-172
title: "An unformed shift alerts every tick, with no dedup"
topic: "Outbound notifications & operator relay"
status: "active"
date: "2026-09-13"
ruling: "A vessel-day that fails to form texts every active admin on every tick, naming the boat and the day. No dedup and no state, unlike the At-Risk alert on the same lane."
claims:
  - kind: "file"
    target: "src/adapters/forward-formation-alert.ts"
    note: "the sender; one message per failed vessel-day, best-effort per recipient"
  - kind: "file"
    target: "app/api/cron/tick/route.ts"
    note: "the call site, beside the console.error it replaces as the control"
revisit_if: "Formation failures become common enough that the volume is what gets noticed instead of the failure — which would itself be the bug to fix"
---

## DEC-172: An unformed shift alerts every tick, with no dedup

A boat sold with no crew shift means nobody was asked to work it and it is on no board. Since #957
that no longer aborts the run — it lands in `FormResult.failures` and the tick logs it. A log line
is not a control: nobody reads one that repeats every fifteen minutes, you read it after somebody
has already told you a trip had no crew.

DEC-095's At-Risk alert rides the tick's per-(shift, reason) dedup, so a steady board fires nothing.
This deliberately does not, and that is the whole decision. One text about an unformed shift is a
drop-everything, so the repeats are self-limiting. The operator's ruling: if this is ever sending
too many messages, the flood is itself the bug to fix.

A stateful alert is also one that can go quiet at the wrong moment, which is the failure this was
filed against: the report getting quieter as the breakage got worse.

Rejected: a counter on `/admin/shifts`. A permanent display for a state that must never occur is a
confession with a number beside it, and it still needs somebody to look.

Not a new outbound lane, on DEC-095's own reasoning: no port, no entity, no table.
