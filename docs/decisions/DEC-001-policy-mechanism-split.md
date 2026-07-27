---
id: DEC-001
title: "Policy/mechanism split"
topic: "Core architecture & engine mechanics"
---

## DEC-001: Policy/mechanism split

**Decision:** The rules (USCG manning, credentials, turnaround, seasons) are **tenant-owned data**;
the engine that evaluates them is **generic**. Muster is built perfect for one niche (BrewBoat) on
top of a tenant-agnostic mechanism.
**Why:** It is what lets Muster be hard-tuned for the first tenant and still be sellable later
without a fork. The spine of the whole product (SPEC §0.1, §1.3).
**Tradeoff:** Every rule must be expressed as data + a generic evaluator, never as a hardcoded
`if`. More upfront discipline than a bespoke BrewBoat app.
**Revisit if:** Never for v1 — this is the foundational bet.
