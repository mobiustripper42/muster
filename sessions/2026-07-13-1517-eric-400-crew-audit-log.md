---
session: 49
dev: eric
slug: 400-crew-audit-log
branch: task/400-crew-audit-log
started: 2026-07-13T15:17:03Z
ended: 2026-07-13T21:44:02Z
points: 11
pr_numbers: [402, 406, 407, 409, 410]
status: closed
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

## Task 2: #400 Slice B — /admin/audit one-list read (DEC-118)

**Completed:**
- **Port reads** `src/ports/repository.ts` + both adapters — `listAuditEvents()` + `listAllReliabilityEvents()`, newest-first (pg uses 0024's `timestamp desc` indexes; in-memory sorts `timestamp desc` + insertion-desc tiebreak to match pg).
- **Read model** `src/admin/audit-trail.ts` — ONE list = `audit_events` UNION a reliability add/drop projection (`ask_accepted`→added, `shift_bailed`/`no_show`→removed). Excludes ask-context types (declined/ignored/nudged) — those stay on `/admin/asks`. Filters: crew + kind (added/removed/changed). Actor labels resolved (admin→name, importer→"Xola import", self-claim, self-bail vs "reported bail").
- **UI** `app/(admin)/admin/audit/page.tsx` — single list mirroring `/admin/asks`, Crew + Kind filters, calm-neutral tags, honest no-backfill header. Admin-home nav card.
- **Closed the deferred trainee emitter** (`staffTrainee`/`unstaffTrainee` → `crew_added`/`crew_removed`, admin actor) so the union view is complete day one. DEC-118 updated.
- **Tests** `src/admin/audit-trail.test.ts` (union, projection filter, actor labels, ordering, filters, orphan). `npm run verify` green (1028).
- **Design pivot (user-directed):** DEC-118 said "sibling of /admin/asks, no fold-in"; user overrode → ONE unified list, no second list, kind+crew filters, no actor filter.

**Code review:** clean on load-bearing (double-counting provably absent, projection filter correct, trainee emitter additive). 2 nits: adapter ordering (fixed — aligned in-memory to pg); `metadata.manual` (no change — already typed at `reliability.ts:86`).
**PR:** [#406](https://github.com/mobiustripper42/muster/pull/406)
**Points:** 4
**Branch:** task/400-crew-audit-log-slice-b
**Opened at:** 2026-07-13T17:03:00Z

## Task 3: #404 db:crew rank — crew by reliability score (CLI)

**Completed:**
- `src/crew/crew-cli.ts` — new `rank` subcommand: ranks all crew by reliability via the SAME `scoreCrewMember` + `effectiveRankScore` the ask loop uses (true ask order, manual thumb `*` included), best-first, id tiebreak; prints score + event count + status marks. `runCrewCommand` gained an optional `now` param (default `new Date()`) for testability — backward-compatible.
- `src/crew/crew-cli.test.ts` — ordering + thumb-marker + events-column test. `npm run verify` green (1028). Ran live on dev DB (full roster ranked, +5 → −109).
- **Decision (#404):** CLI now (cheap, true ask order); the richer crew **admin surface** option split to **#408** — build when a crew admin page lands, fold ranking in there then.

**Code review:** clean bill of health — sort parity with `rankByReliability` confirmed byte-for-byte, `now` param non-breaking, display/markers mirror `list`.
**PR:** [#409](https://github.com/mobiustripper42/muster/pull/409)
**Points:** 2
**Branch:** task/404-crew-rank-cli
**Opened at:** 2026-07-13T21:17:00Z

**Next Steps:**
- **Audit fix #407** (all-14-events list) merged + promoted as **v1.0.7** — prod correct. (Not its own `/kill-this`; continued Task 2.)
- **#409 rank CLI** open — merge whenever; no migration, no conflicts.
- **#408** parked — crew admin surface (reliability ranking + crew mgmt), build when that page lands.
- **#400 is COMPLETE** (Slice A #402 merged + Slice B #406 open). Once #406 merges, hand-apply migration 0024 to prod if not already (verify ledger). Eyeball `/admin/audit` at 375px on mill-dev — I couldn't self-screenshot (no outbound HTTP; mill-dev is your browser).
- **Merge order:** #406 overlaps concurrent session 48's open PRs — #401 (DECISIONS.md) + #405 (postgres-repository.ts). Use "Update branch" or merge those first; neither is a migration conflict.
- Follow-up (parked, DEC-118): split/merge `changedCrew` audit emit — lower-priority, `admin` actor via `forwardFormNotices`.

**Context:**
- **Concurrent session 48** (`11.4-booking-link-confirm`, PRs 401/403/405) ran on another machine this whole window — separate session file, no branch conflict on `sessions`. `/kill-this`'s `head -1` grabbed IT first; had to target session 49 explicitly. Watch this at `/its-dead`.

**Context (close):**
- **#400 shipped end-to-end + live.** Audit list is `/admin/asks` (repurposed from ask-history), shows ALL 14 crew events each as its own row, crew + kind filters. `db:crew rank` CLI shipped (#404 → #409). Prod at **v1.0.8**; migrations 0021–0024 applied to prod.
- **The audit UI took ~10 turns of wrong shapes** before converging. Root cause + fix saved as memory [[spec-convergence-enumerate-then-confirm]]: enumerate the set from source + confirm BEFORE coding; don't let prior DECs/dedup instincts override plain words. Operator self-noted skipping QA on the promote (in a hurry).
- **Stale-test trap:** repurposing `/admin/asks` broke `e2e/ask-trail.spec.ts`; red from #407, rode through #407/#409 merges because **e2e isn't a required check**. Fixed in #410 (renamed → `audit-trail.spec.ts`). Lessons: renaming a route = check its e2e; check CI **pass/fail**, not `--watch` exit code (merged #409 on red before catching it).
- **`src/admin/ask-trail.ts`** read model now unused by any page (only its test + `listAllAsks` port). Candidate for removal later.
- **Concurrent session 48** still open on another machine — leave its file alone.
