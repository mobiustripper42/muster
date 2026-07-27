---
id: DEC-002
title: "The availability oracle is a synchronous rule engine"
topic: "Core architecture & engine mechanics"
---

## DEC-002: The availability oracle is a synchronous rule engine

**Decision:** One authoritative function answers "can this trip run — yes/no, and if no, why?" It
is a **rule engine** (synchronous "may I?" evaluator), explicitly **not** an event engine. Every
rule reads a slice of state and returns `{ passed, severity, reason, ruleId }`. `severity` is
`hard` (blocks) or `soft` (warns). `reason` is a **structured payload, not a sentence**. Two
evaluation modes share one code path: `first-fail` (booking flow) and `collect-all` (admin
reschedule). Verdict vocabulary is **pass / fail / deferred** — never pass/fail/maybe.
**Why:** Admin views need structured failure detail (per-candidate reasons); a single evaluator
with a mode flag avoids two divergent code paths (SPEC §1.3).
**Tradeoff:** Callers must supply the mode and interpret structured reasons rather than reading a
prose string.
**Revisit if:** A rule genuinely needs async/external I/O mid-evaluation (none in v1).
