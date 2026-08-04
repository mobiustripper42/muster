---
session: 77
dev: eric
slug: phase-13-plan-rows
branch: task/phase-13-plan-rows
started: 2026-08-03T18:16:06Z
ended:
points:
pr_numbers: [652]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/89b01c17-af5f-481b-87c3-81f73b7c0b74.jsonl
---

# Session 77 — phase-13-plan-rows

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The hours report names the shift nobody punched (#638)

**Completed:**
- `src/admin/payroll.ts` — `PayrollRow.days`, the vessel-local dates behind each estimate row.
  `src/admin/time-clock-report.ts` — `TimeClockRow.days`, bucketed on `vesselDateOf(inAt)`, open
  punches included. `src/admin/payroll-reconcile.ts` — the set difference as `missingDays` per
  row + `missingCount` overall; `exportBlocked` deliberately unchanged. `/admin/payroll` gains a
  `warn` notice linking each missing day to `?day=`. SPEC §2.9.6 + §2.9.7, `db:seed:timeclock`
  gains Gil, +8 unit tests, +1 e2e.

**The issue's own sketch was the wrong structure, and following it would have duplicated the
rules.** #638 said derive `missingCount` inside `buildTimeClockReport` beside `openCount`. That
module reads punches and crew only; doing it there makes it read shifts and seats and
re-implement the paid-seat filter — required + Confirmed + assigned, skip Cancelled, skip
event-less, dedupe the operator double-seat backstop. Four rules and a subtlety, in a second
copy. `payroll-reconcile.ts:21` already states the boundary ("the estimate's seat rules, the
clock's bucketing and the tip split each stay in one place"), so each module returns its own
`days` and the join happens in the one module that already reads both.

**The no-block decision got independent evidence I didn't plan for.** Gating `exportBlocked` on
`missingCount` as a negative control reddened the new test AND a pre-existing one about tips with
no hours — so the asymmetry was already load-bearing elsewhere before this task named it.

**Test-first bought almost nothing here and the negative controls did all the work.** The first
failure was `missingDays` undefined, which proves the field is absent and nothing about whether
any rule bites. Five controls, each reddening the test that names it and nothing else: UTC
bucketing → the DEC-032 test; counting only closed punches as days → the open-punch case;
dropping the required/supernumerary filter → 3; removing the Cancelled skip → 4.

**Two self-inflicted costs worth remembering.** `git checkout <file>` to revert a negative control
discarded the uncommitted implementation in that file — controls on uncommitted work need a file
copy, not git. And the first e2e locator asserted the date link globally; it matched three
elements because several people share that missing day, so it would have passed on someone else's
link and kept passing if Quint's own vanished. Scoped to his entry.

**Code review:** clean bill of health. The reviewer independently confirmed the hours
accumulation is byte-identical (`payroll.ts:72` is the only change inside the loop), the SPEC
prose and §2.9.7 criterion agree with the code, and `exportBlocked` is still `openCount > 0`.
No blast-radius trigger fired — the money-path list is the reservations/Stripe surface — though
this does edit the two modules that compute payroll hours, additively.
**PR:** [#652](https://github.com/mobiustripper42/muster/pull/652) — closes #638, based on
`feature/time-clock` (which took #649 as a merge commit, so this adds exactly one commit).
**Points:** 3 (filed as 2)
**Branch:** task/638-missing-punches
**Opened at:** 2026-08-04T02:45:00Z

**Next Steps:**

**Context:**
- Picks up directly from Session 76, which ended by window loss rather than a normal close.
- Open at session start: **PR #649** (`task/628-hours-report` → `feature/time-clock`, the hours report
  + Gusto CSV) with `/code-review ultra` running against it; **PR #650**
  (`task/phase-13-plan-rows` → `main`, the Phase 13 plan rows re-homed off the orphan
  `claude/muster-time-clock-d61kju`).
- The checkout at `/home/eric/muster` is shared with the operator's own terminal this session.
