---
id: DEC-115
title: "`FILL_DEADLINE_HOURS` is env-tunable (plumbing only — value stays 48h)"
topic: "Timing — horizons, deadlines & vessel clock"
---

## DEC-115: `FILL_DEADLINE_HOURS` is env-tunable (plumbing only — value stays 48h)

**Status:** Decided 2026-07-11 (Phase 10.5). Fixes #322. (Renumbered 113→115 at merge — the concurrent reservations work took DEC-112/113; the #365 island is DEC-114.)

**Decision.** `FILL_DEADLINE_HOURS` (`src/builder/derive.ts`) becomes `envPositiveNumber("FILL_DEADLINE_HOURS",
48)`, mirroring DEC-062's `STAFFING_HORIZON_LEAD_DAYS`: a positive number (fractional hours allowed, garbage
falls back), **code default unchanged at 48h (2 days)**. The operator can move the At-Risk window per deploy
via a Vercel env (`FILL_DEADLINE_HOURS=72` for 3 days) with no code change. **This ships the knob, NOT a value
change** — the 2-vs-3-day product call (#322) stays the operator's, made later by setting the env.

**Double-duty (DEC-031), unchanged.** The same instant is both the shown "fills by" deadline AND the route-(b)
At-Risk boarding instant (`at-risk-board` re-exports it as `EXHAUSTED_THRESHOLD_HOURS`). Bumping the env moves
both together, by design — the displayed deadline IS the escalation instant, so they can't drift.

**Relationship:** sibling to DEC-062 (same `envPositiveNumber` knob shape) and DEC-031 (the coupling it
preserves). Adds no schema, no domain state; pure config surface.
