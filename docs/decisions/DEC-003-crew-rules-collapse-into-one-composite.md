---
id: DEC-003
title: "Crew rules collapse into one composite satisfiability rule"
topic: "Core architecture & engine mechanics"
---

## DEC-003: Crew rules collapse into one composite satisfiability rule

**Decision:** Crew rules are **not** independent booleans. Evaluated separately they lie (Captain A
is free but lapsed; Captain B is current but booked — every rule passes about a *different* person).
The crew cluster is **one composite rule** solving a satisfiability problem over a shared human
pool: *is there an assignment of real people to every required seat such that each is simultaneously
available, not double-booked, and credential-valid on the trip date?* Returns a valid assignment or
per-candidate failure reasons. Property rules stay clean independent booleans.
**Why:** The single most important architectural point in the spec (SPEC §1.3). The naive
independent-boolean shape returns false yeses.
**Tradeoff:** A small constraint solve (greedy-by-score to start) instead of a boolean AND.
**Revisit if:** Never — getting this wrong is the core failure mode.
