# Muster — Retrospectives

Phase-end retrospectives. Written by `/retro` at each phase boundary — velocity, scope changes,
process notes, forecast update. One entry per phase, newest at the top.

## Phase 0 — 2026-06-04

**Sessions:** 3
**Points:** 9 tracked (PRs #3/#4/#5) / 15 planned (0.1 + 0.2 = 8 pts completed as pre-ritual setup, untracked)
**Wall clock:** 6.29h
**Dev time:** 0.80h
**Review time:** 0.75h
**Velocities:**
- Wall: 0.70 h/pt
- Dev: 0.09 h/pt  ← headline forecast — but a **method artifact** this phase (see below); not a usable baseline
- Review: 0.08 h/pt
**Issues:** 2 created (#1, #2), 2 closed, 0 moved to Phase 1

> ⚠ **Dev/pt is not trustworthy for Phase 0.** The break heuristic (>15min gap = idle) counted a ~4h
> overnight wait while PR #3 sat unmerged *and* two early planning/reading gaps (31m, 20m) as breaks,
> stripping nearly all of S1's active dev time. Real active time ≈ `wall − breaks` = **1.54h**.
> Forecast against active time, skeptically, until a clean build phase mints an honest number.

### Per-session breakdown
| Session | Date | Wall | Dev | Review | Breaks | Points | PRs |
|---------|------|------|-----|--------|--------|--------|-----|
| S1 | 2026-06-03 | 5.00h | 0.25h | 0.00h | 4.75h | 2 | #3 |
| S2 | 2026-06-04 | 0.58h | 0.17h | 0.42h | 0.00h | 2 | #4 *(transcript-unavailable — Windows path; breaks=0 by inference)* |
| S3 | 2026-06-04 | 0.71h | 0.38h | 0.33h | 0.00h | 5 | #5 |

### What worked
- "i was able to get new design decision in place smoothly" (DEC-ROLE-1 went from mid-session handoff to merged-in-PR without friction).

### What didn't
- "i'm not sure i had enough displine with the workflow, and i need read the pr closer."

### Changes for next phase
- "continue to look for design gaps. follow workflow"

### Scope changes
- **PR #4 (Messaging REV 2 + design-reference staging, 2 pts)** — unplanned mid-phase docs work, no issue. Added to PROJECT_PLAN as a P0-retro drift row.
- **DEC-ROLE-1 (roles/manning as tenant data)** — mid-session handoff folded into PR #5 *after* its Task 1 block was logged. Caught the 0.4 skeleton shipping the `'captain'|'mate'` enum anti-pattern (forbidden by DEC-001) before merge. Recorded only in the Session 3 Context note — not in any per-task block.
- Carried forward (review forward-notes, not blockers): graduate the N-role manning iteration from `brewboat.test.ts` into a real `deriveSeats()` with a 3-role fixture (M2/1.3); M4 multi-tenant adapter should enforce RoleType referential integrity.

### PM read
**Phase 0 — Setup & domain foundation**

Three sessions, six and a quarter hours wall, and nine tracked points to stand up a test harness, two doc revisions, and the domain spine. On paper that's a 0.09 h/pt dev velocity, which would be the most productive engineering anyone has ever done and is also entirely fictional. The break heuristic ate a four-hour overnight wait while PR #3 sat unmerged and called it "idle," then ate two early reading-and-planning gaps for good measure. Strip the artifact and real active time across the phase is roughly 1.54h — fast, genuinely, but this phase gives us no velocity baseline worth forecasting against. Phase 1 is where the first honest number gets minted. Anyone who quotes 0.09 h/pt in a planning meeting should be asked to leave.

On scope: nine tracked points against seven on the phase:0 labels. The extra two are PR #4 — the messaging REV 2 doc work — which walked in mid-phase with no issue behind it. It was good work (port-mediated ask, DEC-MSG-3, the SPEC locked-text edits all DEC-backed), and it's exactly the kind of work that doesn't show up in a plan because it wasn't in the plan. The points-drift is small here; the habit is the thing to watch. Two of three points-bearing PRs in a setup phase being mostly documentation is fine for a setup phase and would be a smell in a build phase.

The pattern worth naming is DEC-ROLE-1. The 0.4 domain skeleton shipped with the literal `'captain' | 'mate'` enum that the project's own policy/mechanism split (DEC-001) exists to forbid — and it got caught in a mid-session handoff and rewritten as tenant data *before* merge. Good catch, real save. But it's recorded nowhere in any per-task block; it survives only as a note in the Session 3 context. The same session also folded a second descope-and-correct into a branch that had already logged its Task 1. The work is sound. The bookkeeping is exactly the discipline gap you flagged yourself.

Which is the honest part. You said you weren't sure you had enough discipline with the workflow and needed to read the PR closer — and the record agrees with you, specifically and in two places: the unrecorded DEC-ROLE-1 folded in after-the-log, and an enum anti-pattern that made it to a PR at all. That's not a confidence problem, it's a process one, and process problems have process fixes: one task, one block, log it before you fold the next thing in. On "got the new design decision in place smoothly" — sure, the *deciding* was smooth; the catch happened at review, not at design, which is the system working but working late. "Continue to look for design gaps" is the right instinct precisely because this phase proved the gaps are real and reach the branch.

Forward into Phase 1: this is the 43-point vertical slice, and it is a different animal. M0–M5 takes the spine you just merged and runs real BrewBoat weekends through it — import, auto-form, lock, ask, tap-in, shift card — which means the "scary assumption," autonomous grouping-and-asking on live bookings, finally gets exercised instead of described. Task 1.5a (M4) is where DEC-013 comes due and the deferred stack stops being deferred; budget for that decision to cost real hours, not the rounding-error this phase logged. Two notes to carry: the N-role manning iteration in `brewboat.test.ts` wants to graduate into a real `deriveSeats()` with a 3-role fixture, and the per-task logging discipline is now a stated Phase 1 goal — so treat the first dropped block as a bug, not a footnote.
