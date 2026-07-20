---
session: 61
dev: eric
slug: bug-483-inline-asks
branch: main
started: 2026-07-20T14:08:56Z
ended:
points:
pr_numbers: [488]
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

**Next Steps:**

**Context:**
Concurrent session. Session 60 (open, reservations work in /home/eric/muster-reservations) runs alongside. This session works in the main checkout to fix bug #483 (bail()/vacateSeat() inline pre-horizon ask blast). Crew-engine fix → own task branch → main.
