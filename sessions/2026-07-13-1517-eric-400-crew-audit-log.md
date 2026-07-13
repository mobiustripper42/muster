---
session: 49
dev: eric
slug: 400-crew-audit-log
branch: task/400-crew-audit-log
started: 2026-07-13T15:17:03Z
ended:
points:
pr_numbers: [402]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/488147c1-61df-4696-9ad2-2abd45d1cce6.jsonl
---

# Session 49 — 400-crew-audit-log

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: #400 Slice A — crew audit log risk seam + edge emitters (DEC-118)

**Completed:**
- **Return-shape deltas** `src/asks/ask-loop.ts` — `vacateSeat` +`removed`; `manualOverride` → `{seat, displaced?}` (displaced captured BEFORE the `saveSeat` overwrite; only a *different* prior occupant counts); `overrideSeat` +`displaced`. Caller fix `src/builder/manning.ts` (`staffTraineeSeat` → `placed.seat`; trainee seats always Open → no displacement).
- **Four edge emitters** (best-effort, post-mutation, never fail the committed seat write): override (`crew_added` + `crew_removed` on displacement) + vacate (`crew_removed`) in `app/(admin)/admin/shift/[shiftId]/actions.ts` (admin actor = `subject.id`, DEC-092); self-claim (`crew_added`, crew actor no id) in `app/(crew)/crew/open/actions.ts`; import (`shift_changed` per `changedCrew`, importer:xola + runId) in `app/(admin)/admin/import/actions.ts`.
- **Tests:** return-shape + displaced ordering in `ask-loop.test.ts`; new `src/oracle/audit-log.test.ts` (emit shape, actor-id optionality, deterministic id no-collision). `npm run verify` green (1021).
- Ships **capturing not displaying** — no read path until Slice B; no backfill.

**Code review:** 2 findings, both handled. (1) **bug fixed** — `mintId` didn't fold `shiftId`; a `shift_changed` pair (same crew, two shifts, one import run) collided on id → Postgres PK collision → silent row drop. Fixed + regression test. (2) **deferred + noted in DEC-118** — `staffTrainee`/`unstaffTrainee` are the same operator add/drop shape but outside Slice A's emitter list; close in Slice B alongside the read UI.
**PR:** [#402](https://github.com/mobiustripper42/muster/pull/402)
**Points:** 5
**Branch:** task/400-crew-audit-log
**Opened at:** 2026-07-13T16:02:00Z

**Next Steps:**

**Context:**
