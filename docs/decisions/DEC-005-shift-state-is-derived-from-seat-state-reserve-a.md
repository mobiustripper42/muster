---
id: DEC-005
title: "Shift state is derived from seat state; reserve a `Held` tier"
topic: "Seats, shifts & state machine"
---

## DEC-005: Shift state is derived from seat state; reserve a `Held` tier

**Decision:** Two nested machines. Model the **seat** machine (`Open → Asked → Claimed → Confirmed`,
plus `Bailed`) and **derive** the shift state (`Pending / Filling / Crewed / At-Risk / Completed /
Cancelled`) from its seats. Required seats gate `Crewed`; supernumerary seats do not.
**Reserve room for a `Held` seat tier between `Claimed` and `Confirmed`** — modeled so it can be
inserted without restructuring, **not implemented in v1**.
**Why:** Seat sub-states already distinguish "no progress" from "some" (Open+Filling merged); a
derived shift state can't drift out of sync with its seats (SPEC §1.1).
**Tradeoff:** Shift state is computed, never set directly.
**Revisit if:** Pass D adds the `Held` tier for progressive commitment.
