---
id: DEC-075
title: "Self-claim is auto-lock (`Open → Confirmed`), bypassing `Asked`; operator-confirm-required is a built-in seam, not built"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-075: Self-claim is auto-lock (`Open → Confirmed`), bypassing `Asked`; operator-confirm-required is a built-in seam, not built

**Status:** Accepted (Phase 7).

**Decision:**
- A self-claim transitions the seat **`Open → Confirmed`** directly (auto-lock), skipping `Asked`. This
  reuses the existing **assign-then-confirm** path (§1.1: `Claimed` already means "accepted *or a named
  person was assigned*") — a self-claim is the crew member assigning themselves — collapsed straight to
  `Confirmed`. No invariant requires a preceding `Ask`.
- **The operator retains full confirm/override capability** post-hoc: a self-Confirmed seat is visible
  in the cockpit and can be reassigned/released by the operator like any other Confirmed seat.
- **Seam for operator-confirm-required (not built):** the claim service reads an `app_settings` flag
  `self_claim_requires_confirmation` (absent ⇒ false ⇒ auto-lock, mirroring DEC-054's `engine_paused`
  absent-⇒-running). When true (future), a self-claim lands in **the reserved `Held`/`Claimed` tier**
  (§1.1 "⏳ RESERVED … a tentative `Held`") pending operator confirm — i.e. the parked **Progressive
  crew commitment** primitive (§4). Write the service to branch on the flag now; do **not** build the
  Held tier or the confirm queue in Phase 7.

**Why:** Mates loved the *finality* of grabbing a shift — an operator-confirm gate kills that snap.
Auto-lock is the right MVP. But the operator explicitly wants the confirm capability to exist; the
cheapest honest version is a flag-guarded branch toward the tier the design already reserved, so flipping
it later is config + a queue, not a re-architecture.

**Tradeoff:** A self-Confirmed seat with no operator gate means a flaky self-claimer can lock a real
seat — mitigated by reliability tracking (DEC-078) and the operator override. **Rejected:**
`Open → Claimed` (tentative) as the MVP default (kills the finality crew asked for); building the full
Held tier now (premature — it's parked §4); a bespoke "self-claim pending" state outside the reserved
tier (forks the state machine the §1.1 reserve already anticipated). **Revisit if:** auto-lock produces
material no-shows from low-reliability self-claimers → flip the flag. **Phase:** 7.
