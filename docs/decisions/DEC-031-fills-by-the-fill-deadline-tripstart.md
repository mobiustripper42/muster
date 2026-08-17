---
id: DEC-031
title: "\"Fills by\" = the fill deadline — `tripStart − FILL_DEADLINE_HOURS`, derived, bound to the escalation threshold"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-031: "Fills by" = the fill deadline — `tripStart − FILL_DEADLINE_HOURS`, derived, bound to the escalation threshold

**See also** — later decisions that changed part of this one:
- Amended by DEC-038 — fills-by display and label only — the concept, the code symbols (`fillsBy`, `FILL_DEADLINE_HOURS`) and the mechanic are unchanged; the board no longer renders the line and the cockpit relabels it "deadline"

**Decision:** The "fills by" deadline (SPEC §2.4/§2.5; the AtRiskRow's right column + the cockpit
header — both deferred to here by DEC-027 §4) is **`earliestScheduledStart − FILL_DEADLINE_HOURS`**,
computed on read beside `staffingHorizonFor` in `src/builder/derive.ts` (DEC-022's rule verbatim:
**derived, never stored** — a stored deadline goes stale exactly when events reschedule; no new
column, no migration). The binding mechanics:

1. **One constant, not two.** `FILL_DEADLINE_HOURS` (in `derive.ts`) **is** the board's
   willingness-exhaustion threshold — `at-risk-board.ts` re-exports it as `EXHAUSTED_THRESHOLD_HOURS`
   (the identifier kept for the existing suite; the binding is the decision, the name is detail). So
   the rendered "fills by" is **definitionally** the instant a still-short shift escalates to Spink:
   the display and the escalation rule cannot drift. The board threads its `deadlineHours` opt into
   the `fillsBy` it computes, so a test/tuning override moves both together.
2. **NOT the staffing horizon.** The horizon (DEC-022, 3.1a) is `tripStart − 7d` — the window's
   *opening* (`Pending→Filling`), already in the past on every actively-worked shift. "Fills by" is
   the window's *closing* checkpoint. SPEC's "staffing-horizon deadline" reads as the closing item
   of DEC-004's checkpoint **list** (deliberately a list-of-one, room for staged checkpoints); Pass
   D's progressive commitment slots in later as `list.last()`, without generalizing the list now.
3. **Null = absence, past = overdue.** `null` when no scheduled event anchors the shift — rendered
   as absence, never faked (the P3 "don't fake a domain concept in the UI" line, held). A willingness-
   exhausted shift boards only *after* its fills-by passes, so those rows read **overdue** by
   construction — the UI renders that honestly (`· overdue`), never clamped at zero.
4. **Multi-trip times** (the #59 board follow-up): `AtRiskRow.tripStarts` carries **every** scheduled
   departure (earliest first; `tripStart` is `[0]`) so a two-trip day shows both times — P3 rendered
   only the earliest. The fill deadline still anchors to the earliest departure (the first trip is
   the one that must be crewed first). The cockpit already rendered all trips via `view.trips`.
5. **Code constant now, tenant config later** — same posture as `STAFFING_HORIZON_LEAD_DAYS`
   (DEC-001: policy is tenant-owned data eventually). Tenant-level, **not per-vessel, not per-shift**
   — no evidence yet that the lead varies. Default ships at **48h** (inherited from DEC-025's
   tune-later willingness threshold; this DEC fixes the *definition*, not the number).

**Rejected:** *call-time-minus-prep* (needs per-trip call-time/prep data that doesn't exist — the
45-min same-day manifest lead is a different lead for a different purpose; per-vessel prep buffers →
FUTURE_IDEAS). *A standalone tune-later constant* (the operator's first instinct) — correct in shape
but it would mint a twin of the escalation threshold and let the UI and the escalation rule drift;
binding to the existing constant is the same instinct done coherently.

**Revisit if:** Pass D's staged checkpoints land (fills-by becomes the list's last checkpoint); a
tenant needs per-vessel prep buffers or call-time-based deadlines (FUTURE_IDEAS); or the 48h value
needs tuning (the number, not the definition).

**Phase:** Phase 4 / 4.7 (#59). (@architect pass — Fable — 2026-06-12.)
