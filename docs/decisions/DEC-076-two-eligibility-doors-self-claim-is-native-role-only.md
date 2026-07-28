---
id: DEC-076
title: "Two eligibility doors — self-claim is native-role-only; operator-assign is ratings-inclusive (the dual-rating escape hatch)"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-076: Two eligibility doors — self-claim is native-role-only; operator-assign is ratings-inclusive (the dual-rating escape hatch)

**Status:** Accepted (Phase 7).

**Decision:**
- **Self-claim door = native role only.** The browse list shows a viewer only the Open seats whose role
  is their **native role**, layered on top of the existing eligible-pool filter (§1.1: credentials valid
  on the trip date + holds the rating; §1.3 not-suppressed). A captain never sees mate seats.
- **`nativeRole(crew)` is derived, no migration for MVP.** With the captain+mate fleet (DEC-043), native
  role = the most senior role the member holds, precedence **captain > mate** (concretely: `captain` if
  `"captain" ∈ ratings`, else the sole role). The precedence is hardcoded *for the two-role world* and
  is the one acknowledged wart.
- **Operator-assign door = ratings-inclusive.** Operator manual assignment (the existing assign path)
  uses full `ratings`, so the operator can drop a captain-rated member into an Open **mate** seat
  last-minute to fill a shift. This door is admin-only and bypasses the browse surface entirely.
- Same seat, same state machine; **two different gatekeepers**. The dual-rating stopgap stays in the
  operator's hands and never enters the crew mental model.

**Why:** "No captain will ever self-assign to a mate shift" (operator). Dual-rating is purely a
last-minute operator fill hack, not a crew-facing concept; modelling it as two eligibility predicates
keeps the crew UX single-role-simple while preserving the hack.

**Tradeoff:** Hardcoded captain>mate precedence in `nativeRole` violates DEC-ROLE-1's "manning is data
the deriver loops" purity — accepted as scoped debt for a two-role fleet, with the graduation path
named. **Rejected:** adding a `primary_role` column now (premature for two roles; the derived rule
suffices); showing dual-rated crew both seat types with a role-picker (the confusion the operator
explicitly wants to avoid); a `role_types.rank` column now (the principled fix, but scope creep for
MVP). **Revisit if / graduation:** when **genuine multi-role work** lands (a person who actually *works*
more than one role, not pinch-hits) — promote native role to stored data (`crew_members.primary_role`
or `role_types.rank`) and design role-selection as a real crew-facing feature. *Until then, multi-role
is an explicit NON-GOAL (see SPEC §2.7 / §4).*
**Forward-planning — reliability floor on self-claim (post-MVP, additive, no re-architecture):** gate the
self-claim door on a tunable `reliability_score >= floor` — one more predicate on `claimableSeatsFor`, not
a new layer (the score is already on the crew row, §1.4 / DEC-008). It gates the *privilege*, not the
work: below-floor crew lose **self-serve only** and are still crewed normally via the cascade (operator
has eyes on it). It's the trust-tier cousin of the DEC-075 confirm-required seam — likely **one or the
other, not both**. Build-time decisions: a `null`-score **cold-start rule** (DEC-008 "no history yet" —
provisional pass / N training claims / neutral start; the real call, since a naive floor locks out exactly
the newcomers who need reps); a tunable threshold (`app_settings`/env like the horizon lead-days; `floor =
0` disables); `manual_floor`/`manual_boost`/`protocol_override` as the per-person exception hatch. **No
"not trusted enough" wall** — the surface just quietly appears once earned (§1.4 non-comparative ethos).
**Phase:** 7.
