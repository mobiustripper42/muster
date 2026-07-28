---
id: DEC-130
title: "Same-day decline cooldown — a \"no\" quiets that date's cross-shift auto-asks (soft, valved) (#341→#342)"
topic: "Seats, shifts & state machine"
---

## DEC-130: Same-day decline cooldown — a "no" quiets that date's cross-shift auto-asks (soft, valved) (#341→#342)

**Decision:** After crew C declines an ask for a shift on vessel-day D, the tick's drip and Tier-2's nudge skip C for **other** shifts on D. Keyed by the **declined shift's `shift.date`** (expires with the date; the next day is clean). The signal is derived at send time from declined `Ask` rows (`response === "declined"`, seat → `shift.date`) in `buildAskSuppression` — the rows the tick already loads for #393; declined asks are never deleted (`expireAsks` only stamps). `ask_declined` reliability events (DEC-008) remain an equivalent re-derivable record. **No new data, no migration; a decline stays reliability-neutral** (DEC-124 — the signal changes *who the engine re-asks*, not the score). `escalate`'s existing **same-shift** decliner exclusion (DEC-024) is unaffected — they said no to *this* shift, a hard exclusion.

**Soft — last-resort valve.** Composition with DEC-129 is **hard-first**: remove `working` crew, then, if the un-asked remainder is entirely same-day decliners, re-ask the top decliner rather than let a fillable seat exhaust. Never valve *to* a worker; a worker-only remainder defers (DEC-129). The **urgent blast (past `fillsBy`, DEC-031/063) runs with the valve open** — the seat is board-imminent by definition, so cooldown yields to urgency; the hard `working` filter never yields. Manual lean, `overrideSeat`, and self-claim never read the cooldown. **Defer ≠ exhausted:** same layering as DEC-129 — a cooled-down candidate is still eligible to `poolExhaustedFor`, so the shift stays `Filling`, not `AtRisk`. Revisit dials per #342: loosen if board landings rise, tighten (adjacent-day carry) if spam persists. Shares `src/asks/suppression.ts` + the `tick.ts`/`escalate.ts` seam with DEC-129 — shipped as one task.
