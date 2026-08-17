---
id: DEC-120
title: "Reliability retune — reward responsiveness; bail floor lowered, ramp rescaled (#425)"
topic: "Reliability scoring"
---

## DEC-120: Reliability retune — reward responsiveness; bail floor lowered, ramp rescaled (#425)

**See also** — decisions this one changed part of:
- Amends DEC-008 — decline-neutral — weights only
- Amends DEC-028 — the bail lateness floor — weights only

**Status:** Decided 2026-07-14 (Eric + @architect).

**Decision.** Shift the reliability score from commitment-only toward responsiveness.
- `ask_accepted` +1 → **+2**, `ask_declined` 0 → **+1**. Reverses the decline-neutral principle
  (DEC-008/DEC-025): answering either way is a positive; only silence (`ask_ignored`, unchanged at
  −3) is penalized at the ask level. New ask gradient: **In(+2) > Out(+1) > silence(−3)**.
  `shift_completed (+5)` still dominates — actually working a shift is worth far more than any single
  answer.
- `shift_bailed` flat −5 → **−3**; `bailLatenessPerHour` −0.5 → **−0.05**. A full-notice bail now
  costs −3 (= `ask_ignored`, never *softer* — so "confirm-then-cancel-early" never scores better than
  a ghost, and `ask_declined (+1)` beats both); lateness ramps to ≈ **−11.4** at zero notice under
  the **default 7-day (168h)** horizon — reserving the pain for late bails while keeping
  `no_show (−15)` as the true floor. Math (max lateness = `leadMs` = 168h): `−3 + 168·(−0.05) = −11.4`.
  The prior weights (flat −5, ramp −0.5) put a zero-notice bail at `−5 + 168·(−0.5) = −89` — absurdly
  below `no_show`, contradicting DEC-028's "no_show is the worst case." (The @architect draft
  mis-assumed a 48h horizon; the real default is 7 days, so the coefficient was recalibrated to
  −0.05 to hold the floor invariant at the **shipped** config. Note the ramp is horizon-coupled: the
  margin shrinks if `STAFFING_HORIZON_LEAD_DAYS` is raised past ~10 days — the horizon-independent
  shape is parked in FUTURE_IDEAS.)

**Why.** Reward crew who are always reachable even when they say no ("always reachable, always says
no — god bless them"); a well-noticed bail is a communicative act (SPEC §1.4 "a cancel a week out is
cheap") and shouldn't carry the same hit as a same-day bail. The score remains **ranking-only**
(DEC-008) — never a gate; this changes *who the engine asks first*, not who is eligible.

**Amends** DEC-008 (decline-neutral) and DEC-028 (bail lateness floor). **Weights only** — scorer
mechanics, the count-based window, and the state machines are untouched. **Parked** (FUTURE_IDEAS):
the ramp coefficient is per-hour and coupled to the env-tunable `STAFFING_HORIZON_LEAD_DAYS`, so a
raised horizon deepens the worst case proportionally; a horizon-independent (fraction-of-`leadMs`)
shape is a scorer refactor, not a weights change. **Note:** `no_show (−15)` has no emitter yet
(#428) — the floor is theoretical until a no-show can be recorded.
