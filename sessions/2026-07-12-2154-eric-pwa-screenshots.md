---
session: 47
dev: eric
slug: pwa-screenshots
branch: task/pwa-screenshots
started: 2026-07-12T21:54:42Z
ended:
points:
pr_numbers: [398, 399]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/60da5bf5-e4ad-43be-a451-6810ed010434.jsonl
---

# Session 47 — pwa-screenshots

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Weekend-batch staffing trigger — Fri/Sat/Sun go live together (closes #392)

**Completed:**
- `src/builder/derive.ts` — generalized `staffingHorizonFromEvents` with an optional cohort policy: a trip whose vessel-local weekday ∈ `STAFFING_HORIZON_WEEKEND_DAYS` fires on one shared instant (that week's `TRIGGER_DAY` at `WEEKEND_ASK_TIME`) instead of its flat lead. Weekday from `vesselDateOf` (not the raw UTC instant). New `envDayOfWeek`/`envDaySet` parsers; `bailLatenessMs` untouched.
- `src/config/tenant.ts` — exported `envWallClock`. `src/builder/derive.test.ts` — 6 new tests. `.env.example` — 3 knobs. `docs/DECISIONS.md` — DEC-116.
- Drive-by: `other-shifts.test.ts` missing `Event.source` (unblocked main's typecheck, a stacked-PR-skipped-CI casualty).
- **Ships inert** — env unset = byte-identical to today.

**Code review:** Clean on #392 (Mon-zero math + vessel-local edge correct, parsers poison-resistant).
**PR:** [#398](https://github.com/mobiustripper42/muster/pull/398)
**Points:** 5
**Branch:** task/392-weekend-monday-trigger
**Opened at:** 2026-07-13T11:24:00Z

## Task 2: Weekend-batch ask distribution — one text/person, one boat/day (closes #393)

**Completed:**
- `src/adapters/forward-asks.ts` (+test) — per-recipient batching: multiple asks to one person in a tick → ONE message ("N shifts need you") linking to `/crew`. Applies to all asks.
- `src/asks/ask-loop.ts` — `widenAsk` optional exclude. `src/builder/tick.ts` (+test) — per-day live-ask map; the drip skips anyone holding a same-day boat (urgent blast exempt). `docs/DECISIONS.md` — DEC-117.
- **Code-review fixes (follow-up commit):** in-play-seats-only reserve a day (finding 1, real bug); urgent picks count toward spreading (2); batch anchors to a surviving seat (3). Finding 4 (pre-scan I/O) noted as pilot-scale-fine.
- Rescoped from the architect's turn-queue over-build to two small fixes on the existing ask path. `npm run verify` green (1012).

**Code review:** 4 findings, 3 fixed + tested, 1 (perf) noted.
**PR:** [#399](https://github.com/mobiustripper42/muster/pull/399) — stacked on #398.
**Points:** 5
**Branch:** task/393-ask-batch-dedup
**Opened at:** 2026-07-13T11:26:00Z

**Next Steps:**

**Context:**
