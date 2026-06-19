---
session: 20
dev: eric
slug: 92-event-duration
branch: task/92-event-duration
started: 2026-06-19T10:42:30Z
ended:
points:
pr_numbers: [102]
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

**Next Steps:**

**Context:**
