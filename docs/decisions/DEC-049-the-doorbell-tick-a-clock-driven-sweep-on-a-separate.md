---
id: DEC-049
title: "The doorbell tick — a clock-driven sweep on a separate cron"
topic: "Messaging, presence & doorbell"
---

## DEC-049: The doorbell tick — a clock-driven sweep on a separate cron

**Decision:** The batch / cancel window is realized by a **`tick`-style sweep**: a clock-driven job
reads the pending-notification / cancel-window queue, runs the pure decider against current presence
+ read-state, and emits "ring now" decisions to the delivery adapter. It reuses the **explicit-tick
pattern** (DEC-023) and runs as a **separate cron** from the engine `tick` and the Xola pull — so a
doorbell failure can't disturb the ask loop (the DEC-040 precedent: `/api/cron/xola-pull` is separate
from `/api/cron/tick`).
**Why:** The decider is pure, but something must fire it on a clock; a separate cron isolates fault
domains (a messaging bug must not stall crewing). **Tradeoff:** A third cron to operate.
**Phase:** Phase 6 (6.6).
