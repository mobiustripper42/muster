---
id: DEC-025
title: "At-Risk urgency encodes \"captain > mate\" as pool-thinness, not a role-name check"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-025: At-Risk urgency encodes "captain > mate" as pool-thinness, not a role-name check

**Decision:** The At-Risk board's gap-severity term (SPEC §2.5 urgency model: "missing a **captain** —
small, fickle pool — outranks a **mate**") is expressed as **fillability/pool-thinness**: an unfilled
required seat's urgency scales with how few eligible candidates remain for it (the oracle's
distinct-pool solve, DEC-003), never with the seat's role name. The urgency blend is flat-additive —
time-to-trip + pool-thinness + a large regression constant — with weights as tune-later constants;
tests assert ordinal behavior (the §2.5 acceptance criteria), not exact scores.

**Why:** The spec's own rationale for captain-outranks-mate *is* the small pool — thinness is the
cause, the role name only its BrewBoat-shaped shadow. A role-name check is DEC-ROLE-1's explicit
anti-pattern (`if (role === 'captain')`) and breaks the moment a tenant defines a third role; thinness
ranks N roles generically and stays correct when a mate pool happens to be the thin one.

**Tradeoff:** If a tenant ever wants a role to outrank *despite* a deep pool (pure prestige, not
scarcity), thinness won't express it — that would need a per-RoleType weight (tenant config, DEC-001),
not a hardcode. Accepted: no such case exists in the spec.

**Revisit if:** A real tenant needs role-rank decoupled from pool size (add a RoleType weight then).

**Phase:** Phase 3 / task 3.3 (#41). (@architect pass, 2026-06-10.)
