---
session: 28
dev: eric
slug: reset-pilot-absent-tables
branch: task/reset-pilot-absent-tables
started: 2026-06-26T11:51:52Z
ended:
points:
pr_numbers: [155]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/948be534-0713-4f32-aa75-82dd87d6f9e4.jsonl
---

# Session 28 — reset-pilot-absent-tables

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: At-Risk board shows every uncrewed shift within 48h (DEC-065)

**Completed:**
- Operator-reported pilot bug (post DB-reset + unpause): near-term uncrewed shifts invisible on `/admin/at-risk`; nudging a candidate *removed* a shift from the board. Root-caused to route (b)'s willingness-exhaustion gate (`trail.asked > 0 && trail.pending === 0`) — a live/ghosted ask keeps `pending > 0` (worse, `expireAsks` is unwired, #151), so the shift stayed hidden as "actively worked."
- `src/admin/at-risk-board.ts` — **deleted the gate.** New rule: uncrewed required seat + trip within `FILL_DEADLINE_HOURS` (48h) → boards, regardless of in-flight asks. Route (a) eligibility-exhaustion (boards however far out) / regression / credential-lapse untouched. Module doc + comment sweep (`willingness-exhaustion` → `imminence / route (b)`).
- `src/builder/tick.ts` — `board_landed` ping (DEC-026) now fires for near-term uncrewed shifts (intended — operator wants the ping); stale comment fixed. `src/builder/derive.ts` — comment sweep.
- Tests: 3 flipped (live-ask-now-boards, never-asked-now-boards, tick worked-shift-now-lands) + new `Claimed`-seat boundary case (gapSeats is the sole over-board guard now). Full `vitest` **555 pass**, typecheck + build clean.
- `docs/DECISIONS.md` **DEC-065** (supersedes the willingness-exhaustion membership rule; decouples board visibility from #151). Swept stale hide-while-working copy across SPEC §2.5, OPERATOR_MANUAL FAQ, E2E walkthrough (2.4/2.7/7.2/7.3), and the board page subhead.

**Code review:** `@code-review` — logic correct, **no blockers**; confirmed safe in every edge case. All findings (4 stale-copy surfaces + comment drift + missing `Claimed` test) addressed in a follow-up commit. Flagged `board_landed` ping volume rises at pilot scale (deduped, not spam) — recorded in DEC-065 "Revisit if."
**PR:** [#155](https://github.com/mobiustripper42/muster/pull/155)
**Points:** 2
**Branch:** task/at-risk-show-uncrewed-48h
**Opened at:** 2026-06-26T12:50:50Z

**Next Steps:**

**Context:**
