---
id: DEC-046
title: "Presence is observed-only, never crew-curated (the DEC-009 guard for messaging)"
topic: "Messaging, presence & doorbell"
---

## DEC-046: Presence is observed-only, never crew-curated (the DEC-009 guard for messaging)

**Decision:** The doorbell's presence signal is **observed** (the app reports activity / focus),
never **maintained** by crew. There is no "set your notification preferences / quiet hours /
availability" surface for crew. The doorbell's windows and priorities are **operator** tenant-config,
never crew-set.
**Why:** DEC-009 forbids a crew-maintained positive-availability calendar (the Xola trap — it goes
stale and lies). Observing live activity is the right side of that line; a crew-tended
notification-settings screen would re-introduce the exact failure. Naming the guard now stops scope
drift toward it.
**Tradeoff:** Crew can't tune their own notification behavior in v1 (operator config only).
**Revisit if:** never for observed-only; any future per-crew notification preference must not become a
stale self-maintained calendar. **Phase:** Phase 6.
