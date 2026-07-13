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
- **#400 crew audit log — resume the risk seam** on branch `task/400-crew-audit-log` (foundation committed `0b90678`, NOT PR'd — incomplete slice). Done: `audit_events` store (migration 0024, `src/domain/audit.ts`, `src/oracle/audit-log.ts`, port `appendAuditEvent` + both adapters, DEC-118), typechecks clean. **Remaining Slice A:** return-shape changes to `vacateSeat` (+`removed`) and `manualOverride`/`overrideSeat` (+`displaced` — capture BEFORE the `saveSeat` overwrite) + callers; the 4 **edge emitters** (vacate, override, self-claim, import `changedCrew`) in the server actions; per-emitter tests. Then **Slice B** = `listAuditEvents` union read + `/admin/audit` UI (sibling of `/admin/asks`, no fold-in). Architect design in DEC-118.
- **Weekend batch (#398/#399, DEC-116/117) is LIVE on prod at v1.0.5 but INERT.** Go-live = set `STAFFING_HORIZON_WEEKEND_DAYS="4 5 6"` (+ `TRIGGER_DAY=0`, `WEEKEND_ASK_TIME=09:00`) in Vercel — do NOT until you want it on. Optional: `STAFFING_HORIZON_LEAD_DAYS=6.5` (afternoon-trip timing, undecided, still 7).
- `ASK_SILENT_TIMEOUT_MINUTES=240` set in prod this session — confirm the var name has the trailing `S`.

**Context:**
- v1.0.5 promoted to production (17-PR cross-phase batch); release note in `docs/RETROSPECTIVES.md`. Bump/tag/promote done out-of-order (promote-then-nothing; bump-first) per operator.
- Two `Event.source` drive-by CI fixes this session (other-shifts.test.ts typecheck, seed-crewapp-dev.ts e2e) — a stacked-PR-skipped-CI pattern; watch for more if e2e breaks.
