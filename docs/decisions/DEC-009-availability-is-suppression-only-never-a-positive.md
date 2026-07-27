---
id: DEC-009
title: "Availability is suppression-only — never a positive-availability calendar"
topic: "Availability & commitment rules"
---

## DEC-009: Availability is suppression-only — never a positive-availability calendar

**Decision:** Crew availability is modeled as **PTO / blackout suppressions only**. Absence of a
suppression means available. There is **no** "set your recurring availability" calendar the crew
maintain.
**Why:** The positive-availability calendar is the exact Xola trap the product exists to kill —
crew won't maintain it, so it goes stale and lies. This guardrail also binds the future soft-hold
feature (SPEC §2.1, §4 guardrail).
**Tradeoff:** The system can't pre-know a crew member is generally free; it asks and learns.
**Revisit if:** Never. If a crew-tended "set your availability" screen ever appears, the feature
has failed.
