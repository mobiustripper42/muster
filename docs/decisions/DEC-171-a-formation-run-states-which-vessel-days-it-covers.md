---
schema: 1
id: DEC-171
title: "A formation run states which vessel-days it covers"
topic: "Seats, shifts & state machine"
status: "active"
date: "2026-09-13"
ruling: "formShifts takes a required list of vessel-days. Every caller passes the narrowest set it knows, and the tick becomes a repair pass, not a sweep over history."
claims:
  - kind: "file"
    target: "src/builder/form-shifts.ts"
    note: "the required scope, and reformWindow — the repair pass, its own function"
  - kind: "file"
    target: "src/ports/repository.ts"
    note: "listEventsForVesselDays and listActiveVesselDays, the keyed reads"
  - kind: "spec"
    target: "2.3"
revisit_if: "Formation gains an input that changes without a write — anything clock-driven, or a derived fact read from outside the Event set"
---

## DEC-171: A formation run states which vessel-days it covers

Formation consumes one kind of fact, an `Event` row, and those change only on a write path. Time
creates no trips. So a vessel-day nobody wrote to cannot need re-forming, and the writer knows
which days it touched.

An empty scope forms nothing. Reading it as "everything" puts the old behaviour back on the path
nobody tests.

A caller passes every vessel-day it touched, not every one it wrote. Moving a booking between boats
empties the old day; pass both, or that hull keeps a shift for a trip that left.

`reformWindow` is the backstop and has its own name, so "repairing whatever drifted" and "forming
the day I just changed" stay different acts. Its set unions events in a bounded window with every
vessel-day holding a non-terminal shift, the latter with no lower date bound — bound by date alone
and a day that goes bad then ages out is never repaired. That half drains itself: a visit either
re-derives a live day or makes the row terminal.

No source-keyed scope, ever. One vessel-day holds both a Xola trip and a Muster booking (DEC-106),
and a split partitions by time (DEC-083) — which a source scope cannot express.
