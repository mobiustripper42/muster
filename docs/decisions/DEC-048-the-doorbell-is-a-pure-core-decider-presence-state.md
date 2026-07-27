---
id: DEC-048
title: "The doorbell is a pure core decider; presence-state and delivery-I/O live at the edge"
topic: "Messaging, presence & doorbell"
---

## DEC-048: The doorbell is a pure core decider; presence-state and delivery-I/O live at the edge

**Decision:** The doorbell decision logic — presence-suppression, batch / cancel window,
first-only-until-read, priority, short-notice-as-text, in-app-toast-vs-SMS — is a **pure function in
the framework-free core** (`src/`): over injected (pending messages, presence, read-state, rules,
`now`) → notification decisions. Same shape as the oracle / refund engine (DEC-001/002). The doorbell
**never opens a connection and never sends**: presence capture (stateful / I/O) and delivery (I/O)
stay at the **Next edge**, behind ports. Doorbell logic **never** lives in RLS policies, DB triggers,
`NOTIFY`, or a realtime subscription.
**Why:** DEC-DATA-1 — procedural / stateful decisioning belongs in the service/domain layer, not
smeared across the database. A pure decider is the only way the timing/attention logic is
unit-testable with injected `now`, the way every Muster engine is.
**Tradeoff:** One indirection (the decider emits decisions; a separate edge adapter delivers them).
**Rejected:** trigger / `NOTIFY`-driven notification or RLS-gated presence — the stored-procedure
trap DEC-DATA-1 exists to prevent. **Phase:** Phase 6 (6.4).
