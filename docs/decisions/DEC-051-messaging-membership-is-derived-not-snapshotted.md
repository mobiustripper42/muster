---
id: DEC-051
title: "Messaging membership is derived, not snapshotted"
topic: "Messaging, presence & doorbell"
---

## DEC-051: Messaging membership is derived, not snapshotted

**Decision:** Thread membership is **computed from existing aggregates at read time**, not copied into
participant rows: **cohort** = everyone crewing a **day**, gathered across *every* shift that day (the
assigned crew on that day's seats, all vessels — artifact §2, corrected at 6.1 build); **shift** = the
assigned crew on one shift's seats; **all-staff** = the roster (`listCrewMembers`). Only the **DM**
participant set — the one truly ad-hoc membership — is **persisted**. Thread `kind` is **data, not a
hardcoded enum branch** (the DEC-ROLE-1 discipline applied to threads — membership dispatch is a
registry keyed by kind).
**Correction (6.1, 2026-06-24):** the original wording "cohort = the same vessel+day grouping" was
wrong — that's a *shift*, collapsing two of the three standing kinds into one. The artifact §2 is
authoritative: a cohort is **day-wide across vessels** ("Saturday's cohort = all six"). Issue #111 AC
copied the wrong wording and is corrected with it.
**Why:** A snapshotted cohort/shift membership goes stale exactly when the schedule changes — the same
anti-pattern as the Xola-trap calendar (DEC-009 spirit). Derive what's derivable; persist only the
irreducible. **Tradeoff:** Membership is recomputed per read (cheap; the inputs are already in hand).
**Phase:** Phase 6 (6.1).
