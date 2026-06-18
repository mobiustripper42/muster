---
session: 18
dev: eric
slug: walkthrough-pass2
branch: walkthrough-pass2
started: 2026-06-18T17:24:12Z
ended:
points:
pr_numbers: [88]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/4daf4597-f010-42e0-8823-7cb2fb10869e.jsonl
---

# Session 18 — walkthrough-pass2

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: #87 — split confirmed-seat vacate into Remove (no penalty) vs Bailed (logs lateness)

**Completed:**
- Core `vacateSeat()` in `src/asks/ask-loop.ts` — `bail()` minus `logShiftBailed`; exhausted pool rests at `Open` (not `Bailed`), removed occupant excluded from re-ask, same occupant-pin race guard.
- `removeSeat` server action in `app/(admin)/admin/shift/[shiftId]/actions.ts` (`removed=`/`raced`/`not_confirmed`/`unavailable`); `reportBail` unchanged for the Bailed button.
- `components/assignment/seat-card.tsx` — Confirmed seat now two buttons (plain Remove / red Bailed) + intro line.
- Cockpit `page.tsx` — `removed=` → no-penalty `ok` notice; generalized the shared `not_confirmed` copy (dropped "to bail", per review).
- `docs/DECISIONS.md` DEC-039 (supersedes the DEC-038 single button; explicit choice, not a default checkbox).
- `docs/E2E-PILOT-WALKTHROUGH.md` step 3.4b exercises the split; checklist synced.
- Tests: 3 new `vacateSeat` cases (no `shift_bailed`; empty pool → Open; occupant-pin → throws). `src/asks/` 71/71; both typechecks + `next build` green.
- NOTE: PR #88 bundles the whole pass-2 walkthrough (18 commits — cockpit/board copy across Parts 1–3 + this #87 split), committed directly onto `walkthrough-pass2` per operator call.

**Code review:** One finding — shared `not_confirmed` copy said "to bail," wrong on the Remove path; fixed (95783b4). Otherwise clean — faithful mirror of the bail path with the penalty removed.
**PR:** [#88](https://github.com/mobiustripper42/muster/pull/88)
**Points:** 3
**Branch:** walkthrough-pass2
**Opened at:** 2026-06-18T18:24:13Z

**Next Steps:**

**Context:**
