---
id: DEC-052
title: "Crew-to-crew DMs are operator-visible for v1"
topic: "Messaging, presence & doorbell"
---

## DEC-052: Crew-to-crew DMs are operator-visible for v1

**Status:** Proposed (Phase 6) — operator-confirmed 2026-06-21.
**Decision:** Resolves the artifact's §14 open question (DM private-to-two vs operator-visible) to
**operator-visible** for v1. A DM thread is readable by the operator (matches the "office-overseen"
framing of the absorbed FUTURE_IDEAS multi-party item, defensible for a 20–25-person ops crew). A
**private-DM** model is a documented later path, not v1.
**Why:** DM visibility is a **DEC-DATA-1 authorization decision** (who reads which rows) — a
"decide-before-building" gate, not a tune-later knob. Operator-visible is the simplest correct model
and fits the ops context. **Tradeoff:** No truly private crew channel in v1. **Revisit if:** a genuine
need for private crew DMs appears (then a per-thread visibility model). **Phase:** Phase 6 (6.1).
