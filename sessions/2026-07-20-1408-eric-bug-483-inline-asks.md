---
session: 61
dev: eric
slug: bug-483-inline-asks
branch: main
started: 2026-07-20T14:08:56Z
ended:
points:
pr_numbers: [488, 490]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/4859b349-a5b4-4de2-854f-50694af67381.jsonl
---

# Session 61 — bug-483-inline-asks

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Fix #483 — bail()/vacateSeat() fire no asks, defer re-crewing to the tick

**Completed:**
- Rewrote `bail()`/`vacateSeat()` (`src/asks/ask-loop.ts`) to mint zero asks: validate → (bail) logShiftBailed → drop occupant + clear provenance → rest seat Open → horizon-aware refresh → return. Tick is sole ask-writer again.
- Added `refreshShiftStateHorizon` (persists composed `resolveShiftState`, scoped to bail+vacate); relocated `poolExhaustedFor` `tick.ts`→`oracle.ts` (cycle-free).
- Retired `Bailed` as a resting state (legacy readers kept); removed dead `reAsks`/`forwardToOutbox(reAsks)` in 3 action files, DEC-088 civil branch, stale docstrings + `seat-card.tsx` operator copy.
- DEC-128 (renumbered from issue's 127 — taken on main); struck DEC-063's "re-asks stay blast-all" clause.
- Two @architect passes (2nd on Fable); all 5 GO-WITH-CHANGES corrections folded in.
- Tests: new bail/vacate horizon matrix + churn re-greened across board/assignment-view/lean/assign-from-pool/cascade/claim/tick; flipped e2e `bail-reask` + `bail-regression` (latter now guards the fix). `npm run verify` green (1065 vitest + build).

**Code review:** Clean bill of health. 2 advisories — stale test comment (fixed), latent options-asymmetry on refreshShiftStateHorizon (left; no live caller).
**PR:** [#488](https://github.com/mobiustripper42/muster/pull/488)
**Points:** 8 (coherent single subsystem; big-ish diff but one migration-free engine change)
**Branch:** task/12.9-bail-vacate-defer-tick
**Opened at:** 2026-07-20T15:06:08Z

**Not run:** e2e (`npm run test:e2e`) — dev lock held + concurrent reservations session. Specs updated; run at merge for the visual confirm.

## Task 2: On-shift + same-day-decline ask suppression (#341, #342)

**Completed:**
- New `src/asks/suppression.ts` — `buildAskSuppression` → `{ working, declinedOnDay }`, send-time filter built once per tick, deliberately outside `oracle/` (defer ≠ exhaustion).
- DEC-129 (#341 HARD): never auto-ask crew inside `[call, end)` of a shift they hold; defer, no valve, no penalty. DEC-130 (#342 SOFT): decline quiets that vessel-date's cross-shift asks, last-resort valve for a sole decliner.
- `tick.ts` (drip precedence + valve + defer branch; blast excludes workers; passes suppression to escalate), `escalate.ts` (suppress param + hard working union + soft valve pick). Bail/vacate need no filter (post-DEC-128).
- 12 new tests incl. the critical all-suppressed-pool-stays-Filling / no-Tier-2 cases. Reconciled the issue bodies' stale bail/vacate seam via Fable @architect pass first.
- Also filed the phantom-importer root-cause bug (#489) and promoted v1.0.17 to production earlier this session (bail/vacate fix live).

**Code review:** Clean — correctness traced through rankedEligible/widenAsk. 2 comment/style nits, both fixed.
**PR:** [#490](https://github.com/mobiustripper42/muster/pull/490)
**Points:** 5 (one shared seam, two composing filters)
**Branch:** task/341-342-ask-suppression
**Opened at:** 2026-07-21T02:37:56Z

**Next Steps:**
- Phantom-importer fix (#489) — @architect-gated, scoped to covered pull dates. Next task.

**Context:**
Concurrent session. Session 60 (open, reservations work in /home/eric/muster-reservations) runs alongside. This session works in the main checkout to fix bug #483 (bail()/vacateSeat() inline pre-horizon ask blast). Crew-engine fix → own task branch → main.
