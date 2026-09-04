---
session: 103
slug: reservations-phase-plan
branch: task/reservations-phase-plan
started: 2026-09-03T17:47:36Z
ended:
points:
pr_numbers: [905, 910, 924]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster-s91/fc4ca4b8-4ceb-5d27-9011-6826c042120c.jsonl
---

# Session 103 — reservations-phase-plan

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Phase 12 triage and retro (shipped by `/retro`, not `/kill-this`)

**Completed:**
- Triaged all 14 open `phase:12` issues to zero. Created `phase:cutover` (issues #544, #623, #545, #468, #467, #466); closed issues #622, #489, #687 (→ new issue #901, outbox sunset); unphased issue #484 to lane A; unphased issues #683, #776, #668, #667 for the next phase. Deleted `phase:12b` after relabelling its 9 closed issues to `phase:12`; 8 formerly-12b open issues now unphased. Removed residue `phase:10`/`10.5` labels from issues #301, #247, #293.
- `/retro` for Phase 12: 208 pts over 47.6d, 30.6 pts/wk, 0 re-est / 0 drift, 49 unplanned issues (135 pts). `docs/PROJECT_PLAN.md` Phase 12 row + Outcome + Drift reconciliation; `docs/RETROSPECTIVES.md` block at top. No version bump (operator's call).
- One fabricated claim caught: the PR body said a grep "returns DEC-S026" without the grep having run. Corrected in the body; DEC-S026 is a jig-side id and not a record in this repo.

**Code review:** n/a — retro docs
**PR:** [PR #905](https://github.com/mobiustripper42/muster/pull/905) — merged
**Points:** —
**Branch:** task/reservations-phase-plan
**Opened at:** 2026-09-03T21:30:00Z (approx.)

## Task 2: Plan Phases 14–16 — reservations built to §2.8/§2.10 and the audit

**Completed:**
- `docs/PROJECT_PLAN.md`: intro block, Phase 14 (the pending row, 9 tasks / 39 pts), Phase 15 (money on our row + reconciler + two removals, 7 / 29), Phase 16 (operator side + self-service cancel, 9 / 40), Phase 17 placeholder (per-trip override + customer-notify, future, not pokered). 25 tasks, 108 pts.
- Inputs: SPEC §2.8 (read in full), §2.10 (read in full), audit header/decisions/gaps (read) and a Sonnet extraction of the 15 non-BUILT criterion findings.
- Operator decisions taken in-session: three phases not one; at-risk board stays and gets an answer in 14.3; self-service cancellation in (16.9); per-trip override needs the notify path and is Phase 17, not this release.
- Phase numbering: 13 was already Time Clock (closed 2026-08-04), so the plan is 14/15/16 rather than 13/14/15.

**Code review:** 5 findings, all fixed — 16.9 had "full refund with flex" against `SPEC.md:1712-1713` (flex narrows the window, never waives the fee); issue #826 is criterion 5 not 2; three bare `#N`. Every citation, issue title and DEC verified by the reviewer.
**PR:** [PR #910](https://github.com/mobiustripper42/muster/pull/910)
**Points:** 3
**Branch:** task/reservations-phase-plan-14-16
**Opened at:** 2026-09-04T15:50:15Z

## Task 3: Phase 14.1 — three states, no sweeper, pending shows as held; DEC-109 withdrawn

**Completed:**
- No new DEC after all — operator's model: the spec holds settled answers; a record is for a later change of mind or a frozen supersession. `docs/SPEC.md` §2.8.1 union is `pending | booked | cancelled`; lapsed is computed on every read, never stored; §2.8.8 has no sweeper, reaper never deletes a row with a payment id; §2.8.10 calendar shows a live pending row as `held`; §2.10.2 fixes the five slot states `open` `sold` `held` `busy` `blocked` (`busy` replaces `unavailable` in prose; code rename rides with 14.9).
- `docs/decisions/DEC-109-*.md` → v1 `status: withdrawn` signpost to §2.8.1 (gate needs a successor DEC for `superseded`; the successor is the spec). Baseline line dropped.
- `docs/dictionary.yml` — `lapsed` + five slot states.
- `docs/audit/2026-08-29-spec-2.8-conformance.md` + `scripts/check-audit-citations.mjs` — 74 SPEC + 8 code citations renumbered by script off the diff hunk map; four dated notes on findings that quoted deleted sweeper sentences. `check:audit` was already red on `main` (PR #903) — rode along on the operator's call.
- Comments on issues #912, #913 (14.2: add `pending` only), #919 (14.8: reaper, not sweeper). `PROJECT_PLAN.md` untouched mid-phase.

**Code review:** 2 findings, both fixed — DEC-109 understated its citation surface (22 files, not 2); six pre-existing off-by-one bare refs in the audit.
**PR:** [PR #924](https://github.com/mobiustripper42/muster/pull/924)
**Points:** 2 (audit re-baseline rode along; ~1 pt of unplanned work, no re-estimate)
**Branch:** task/14.1-pending-row-decision
**Opened at:** 2026-09-04T19:18:40Z

**Next Steps:**
- Merge PR #921 (Phase 14 link write-back) and PR #924.
- 14.2 (issue #913) stacked on 14.1: `pending` in the union, nullable `eventId`, `admin` source — ship in the same stack as 14.3 (issue #914).
- `check:audit` will go red again the moment 14.2 edits `entities.ts:615`; it is outside `verify` by design. Decide at 14.2 whether to keep re-baselining or retire the gate until the phase closes.

**Context:**
- Linked worktree (`muster-s91`). Session 102 open concurrently (live). Model: Fable 5.1 this session.
