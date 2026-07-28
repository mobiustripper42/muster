---
id: DEC-006
title: "Escalation Tiers 1–3 are degrees of automation, not states"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-006: Escalation Tiers 1–3 are degrees of automation, not states

**Decision:** The carrot/stick lives in *how the system works a seat*, not in state names. Tier 1
(autonomous fill), Tier 2 (semi-autonomous escalation — widen pool, nudge) both happen **within
`Filling`**. Only Tier 3 (human) corresponds to a state: the shift goes `At-Risk` and surfaces to
the operator.
**Why:** Keeps the state machine small and the autonomous last-minute booking emergent rather than
a special feature (SPEC §1.2).
**Tradeoff:** Tier activity is tracked alongside `Filling`, not encoded as distinct shift states.
**Revisit if:** Never for v1.
