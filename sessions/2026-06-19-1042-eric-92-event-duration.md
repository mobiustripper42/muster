---
session: 20
dev: eric
slug: 92-event-duration
branch: task/92-event-duration
started: 2026-06-19T10:42:30Z
ended: 2026-06-19T19:45:28Z
points: 22
pr_numbers: [102, 103, 104, 105, 106, 107, 108]
status: closed
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

## Task 4: #93 + #97 — Stale-safe outbox notices + session-aware root redirect (PR A of the 93/94/97 bundle)

**Completed:**
- **#97** — `app/page.tsx` placeholder → session-aware server component (`readSubject`): crew → `/crew`, operator → `/admin`, else the sign-in prompt. Crew bookmark / home-screen shortcut now lands on My Shifts (interim ahead of the parked crew "living link").
- **#93** — `app/(admin)/admin/outbox/page.tsx` `ANSWERED_COPY` reworded past-tense/action-framed ("You answered: in./out.") so a lingering redirect param reads true, matching the board's stale-safe style. `lost` was already stale-safe.
- New `e2e/root-redirect.spec.ts` (3 cases: no-session prompt, crew→/crew, operator→/admin) — green. `verify` green.

**Code review:** Clean bill of health — readSubject exhaustive + null/expired falls through to prompt, redirect() outside try/catch, import paths correct, no sibling present-tense notice missed, e2e well-isolated. No changes required.
**PR:** [#105](https://github.com/mobiustripper42/muster/pull/105)
**Points:** 2
**Branch:** task/93-97-crew-reentry-polish
**Opened at:** 2026-06-19T16:51:20Z

## Task 5: #94 — removeAsk/removeOutboxEntry + idempotent outbox seed (PR B of the 93/94/97 bundle)

**Completed:**
- Added `removeAsk` + `removeOutboxEntry` to the `Repository` port (`src/ports/repository.ts`) with the no-FK referential-cleanup caveat documented, plus both adapter impls (`in-memory-repository.ts`, `postgres-repository.ts`).
- 2 new equivalence tests in `repository-contract.ts` → `npm run test:pg` **25/25 against Postgres** (was 23).
- `db/seed-outbox-dev.ts` `shipShift` now deletes each scenario seat's prior outbox entries + asks before re-firing (delete-and-recreate), fixing the non-idempotency: a closed-no-response ask was a fake "silent" round that stacked on re-run ("3rd ask · Bo went silent"). Header comment updated.
- `docs/E2E-PILOT-WALKTHROUGH.md` #94 note flipped from "full-wipe first" to "clean reset, no wipe needed."
- **#94 acceptance proven:** ran the seed twice with no wipe → tide seat has exactly 2 asks (Lance declined + Bo live) + 1 outbox entry → why-line stays "2nd ask · Lance declined". `verify` green.

**Code review:** Clean bill of health — adapter parity locked by the contract tests, delete order integrity-safe (entries before asks; never deletes seats/crew; reliability log excluded from the integrity scan), deterministic reproduction, convention-consistent. No changes required.
**PR:** [#106](https://github.com/mobiustripper42/muster/pull/106)
**Points:** 3
**Branch:** task/94-outbox-seed-idempotent
**Opened at:** 2026-06-19T17:02:19Z

## Task 6: #100 — All-shifts full-visibility view + complete /admin nav (DEC-042)

**Completed:**
- **Part A:** `src/admin/all-shifts.ts` (core `deriveAllShifts`, pure read over existing derivations) + `app/(admin)/admin/shifts/page.tsx` — every current shift, day-filterable (today · weekend · range), → cockpit. 5 unit tests.
- **Part B:** `app/(admin)/admin/page.tsx` links every surface, At-Risk first/heavier, All-shifts a plain badge-less link.
- **DEC-042** recorded (the deliberate anti-dashboard exception + binding guardrails + sunset trigger).
- 3 e2e tests (`e2e/all-shifts.spec.ts`: list + At-Risk pointer, empty-state firewall, nav). verify + unit + e2e all green.
- **@architect-gated** (ran on Opus per operator call): default-today, neutral-ink state (no colour), no auto-refresh/scoreboard, a separate empty state from the board's ✓, window clamped. Guardrails enforced in code, not just documented.
- **Branch hygiene note:** initially built on the task/94 branch by mistake; relocated cleanly to `task/100-all-shifts` off main (independent of #94/PR #106) before shipping.

**Code review:** Every binding DEC-042 guardrail verified enforced; derivation sound; no nested-anchor bug. Four cleanup findings all fixed in-PR (encode cockpit link, scope label after clamp, accurate Today chip, weekend-on-Sunday). N+1 in resolveShiftStateOnRead noted as pilot-scale-fine follow-up.
**PR:** [#107](https://github.com/mobiustripper42/muster/pull/107)
**Points:** 5
**Branch:** task/100-all-shifts
**Opened at:** 2026-06-19T18:01:17Z

## Task 7: #101 — Anchor the crew seed's shifts to now (stop the harness rotting)

**Completed:**
- `db/seed-crewapp-dev.ts` — `SOON`/`LATER` now derive from `now` (+15d/+16d) via the at-risk seed's `dateOf` helper (vessel-local, DEC-032). ~2 weeks out keeps shift-soon upcoming AND before its 7d staffing horizon, preserving the far-from-trip suppression demo.
- `docs/RUNNING.md` + `docs/E2E-PILOT-WALKTHROUGH.md` — the four "fixed 2026-07-04/05" references updated to "anchored to now, never rots"; the #65 known-limitation note removed (resolved).
- Validated: seed lands shift-soon today+15 (dynamic); **full e2e suite 15/15** with the anchored seed — the direct acceptance test for #101. verify green. Dev-seed + docs only, no app/core, no migration.

**Code review:** Clean bill of health — `dateOf(at(15*24))` matches the at-risk pattern byte-for-byte, +15d confirmed beyond STAFFING_HORIZON_LEAD_DAYS=7, the hardcoded `sentAt` on the open ask traced and verified inert, Dooley's fixed past dates correctly untouched, docs carry no stale claims.
**PR:** [#108](https://github.com/mobiustripper42/muster/pull/108)
**Points:** 2
**Branch:** task/101-crew-seed-anchor
**Opened at:** 2026-06-19T19:38:39Z

**Next Steps:**
- Merge **#108** (last open PR; the other six merged).
- Run **/retro** to close Phase 5 — patch-bumps per merged PR + minor bump at phase close, velocity math.
- Next milestone is the **real crew weekend** (it triggers Phase 6, Pass D). The pilot runbook (`docs/PILOT_RUNBOOK.md`) is the operational path.

**Context:**
- **Phase 5 is functionally complete:** 5.1–5.4 (deploy/auth/tz/import) + 5.5 e2e harness (#65) + the manual (#68) + the pilot runbook (#78) all shipped. The hosted deploy is a **pilot, not production**.
- **#70 closed** (its deliverable was the loud runbook warning); the two genuine prod gates remain deferred by design — Twilio (DEC-MSG-1) + the single-operator constant. Don't treat the channel as production-ready.
- **e2e harness is live + non-rotting:** Playwright on :3100 against `muster_test`; all 3 seeds anchor to `now` (#101 fixed the crew seed). CI `e2e` job is **non-required** ("first to cut") — flip it on in branch protection when trusted.
- **DEC-042** records the `/admin/shifts` all-shifts view as a deliberate anti-dashboard exception with a sunset trigger (deprecate when the operator stops opening it).
