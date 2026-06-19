---
session: 20
dev: eric
slug: 92-event-duration
branch: task/92-event-duration
started: 2026-06-19T10:42:30Z
ended:
points:
pr_numbers: [102, 103, 104]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/0820d289-7d61-4cc5-8764-ec90397c77d9.jsonl
---

# Session 20 — 92-event-duration

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: #65 — e2e/UI Playwright harness over crew + admin flows (Phase 5.5)

**Completed:**
- First browser-test tooling in the project. `playwright.config.ts` drives `next dev` on **:3100** against the throwaway `muster_test` DB (never `muster_dev` — dedicated port + explicit `DATABASE_URL` pin), single worker, desktop + 375px projects, screenshot/trace on failure.
- `db/reset-test.ts` — scripted clean-slate (migrate + truncate-all, `_migrations` preserved). The seeds upsert and never delete, so a truncate is the only way to get crew-only vs both-seeds states deterministic.
- `e2e/fixtures.ts` — `resetAndSeed` spawns the existing dev seed CLIs with `DATABASE_URL`→test (seed scripts untouched); `signInAsCrew`/`signInAsAdmin` drive the real dev-link sign-in (the button POSTs straight to `/crew/auth`).
- 6 flows / 5 specs: `auth-crew` (sign-in + render: ask, my-shifts, standing, credential nudge), `crew-ask` (In/Out), `bail-regression` (crew-only → board "late bail"), `bail-reask` (both seeds → re-ask + board suppression + cockpit "awaiting reply"), `board-nudge` (row leaves board).
- Plumbing: `test:e2e`/`test:e2e:ui`/`db:reset:test` scripts; CI `e2e` job (postgres service + chromium), kept **out** of the docker-free `verify` gate; `.gitignore` + RUNNING.md run recipe.
- Validated: `npm run verify` green; `npm run test:e2e` green — all 9 executions, run multiple times against real `muster_test`.

**Code review:** Clean bill — airtight test-DB isolation, correct CI separation, non-flaky selectors. Two findings fixed in-PR (tightened `signInAsCrew` wait so a `/crew?auth=…` failure can't masquerade as success; `||` fallback for empty `TEST_DATABASE_URL`). One filed as **#101** (crew seed's fixed dates 2026-07-04/05 rot the suite after that — documented mitigation until then).
**PR:** [#102](https://github.com/mobiustripper42/muster/pull/102)
**Points:** 5
**Branch:** task/65-e2e-harness
**Opened at:** 2026-06-19T11:41:36Z

## Task 2: #68 — Operator manual + flow/state diagrams

**Completed:**
- `docs/OPERATOR_MANUAL.md` (new) — task-oriented operator manual, the human-facing translation of SPEC §1 + DECISIONS + BRAND. Centerpiece: "empty board = success" + the vanished-shift/suppression explainer (the operator's two recurring confusions).
- Three Mermaid diagrams (render on GitHub): the spine flowchart (reservation→event→shift→ask→crewed/at-risk→you) + the Shift and Seat state machines.
- Documents the **actual live** pilot surfaces (board, cockpit, outbox, import), a playbook of the issue's "how do I…" scenarios, the reliability/tiers/call-vs-departure/silent-vs-declined concepts, a glossary, and an honest "what's not in the pilot yet" (no auto-text → outbox relay; no roster/builder UI; reschedule/cancel by phone).
- Indexed in `.claude/CLAUDE-context.md` Additional Docs.
- Fact-checked every surface claim against the components; caught two stale refs in `docs/RUNNING.md` ("Warming signals →"/"4 shifts" vs live "Trending at-risk →") — left out of scope, flagged in the PR.

**Code review:** Docs-accuracy pass — matches the code closely, all 3 diagrams valid. One real gap fixed (boost/floor was written as a live button; it has no UI yet → now flagged as roster-phase) + two wording nits (surface count, verbatim "changed since reviewed" copy).
**PR:** [#103](https://github.com/mobiustripper42/muster/pull/103)
**Points:** 3
**Branch:** task/68-operator-manual
**Opened at:** 2026-06-19T16:20:11Z

## Task 3: #78 — Pilot weekend runbook (5.R), closes #70

**Completed:**
- `docs/PILOT_RUNBOOK.md` (new) — one-page operational sequence for a real crew weekend on the hosted pilot: sign-in → seed/shakedown → import → tick → outbox → triage, plus a "when something looks off" table. Links out to DEPLOY/OPERATOR_MANUAL/WALKTHROUGH instead of duplicating.
- Carries **#70's pilot-only-not-production warning verbatim** (Gate paragraph, emphasis preserved) in a top callout, annotated with current gate status: auth (5.2/#76) + timezone (5.3/#77) ✅ resolved; manual outbox relay (Twilio/DEC-MSG-1) + single-operator ⛔ still pilot-only.
- **Closed #70** (the prod-readiness gate) — its deliverable was the loud runbook warning, now met. Left a [closing comment](https://github.com/mobiustripper42/muster/issues/70#issuecomment-4753310027) recording the two deferred tells (Twilio, single-operator) so they survive in DEC-MSG-1 + the plan. PR carries `closes #78` + `closes #70`.
- Indexed in `.claude/CLAUDE-context.md`.

**Code review:** Clean bill — verbatim #70 quote is a word-for-word match (the #78 AC), all operational claims trace to DEPLOY.md + code, gate annotations consistent with #76/#77 closed. One optional parity note taken (the `/api/health` example now matches the canonical payload).
**PR:** [#104](https://github.com/mobiustripper42/muster/pull/104)
**Points:** 2
**Branch:** task/78-pilot-runbook
**Opened at:** 2026-06-19T16:34:09Z

**Next Steps:**

**Context:**
