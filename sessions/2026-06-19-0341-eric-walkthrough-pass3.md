---
session: 19
dev: eric
slug: walkthrough-pass3
branch: walkthrough-pass3
started: 2026-06-19T03:41:51Z
ended: 2026-06-19T10:40:23Z
points: 3
pr_numbers: [96]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/2f9ccd57-cacb-415f-8ee9-c6689c584f74.jsonl
---

# Session 19 — walkthrough-pass3

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: #92 — Event trip length → shift end from a flat constant (DEC-041)

**Completed:**
- Decision-bearing slice; operator made the two calls: source = (c) flat `TRIP_DURATION_MINUTES = 100`; `shiftEnd = latestScheduledDeparture + TRIP_DURATION_MINUTES + CALL_LEAD_MINUTES` ("report time" = the call lead reused symmetrically as a teardown buffer, not a new constant).
- **No migration / no `Event.durationMinutes` column** — dropped from the issue's scope on YAGNI (operator's own challenge): a flat constant writes no information into a column, and the additive migration is cheap to add *when* a real per-event source (Xola/operator-config) lands. Documented as a deliberate omission in DEC-041.
- `src/builder/derive.ts` — `TRIP_DURATION_MINUTES` + `CALL_LEAD_MINUTES` (moved down from shift-card, the shared low layer both crew + outbox already import) + `latestScheduledStart` + `shiftEndFromEvents` (instant, DST-correct per DEC-032).
- `src/crewapp/shift-card.ts` — `shiftEndTime` (clock string); `plusMinutes` exported; window math switched to scheduled-only departures (code-review fix). `src/crewapp/crew-view.ts` — ask card gains `shiftEndTime` (the planted `#92` breadcrumb). `src/admin/outbox-view.ts` — `tripEnd` (ISO UTC).
- Display: `/crew` ask card + `/admin/outbox` facts line → start–end range; `/crew/shift/[id]` → a "Shift End" tile beside Start/First-departure. Customer-facing duration stays portal-era (data lands, no surface).
- `docs/DECISIONS.md` DEC-041. 12 new unit tests; targeted suites 68/68 (251/251 across crewapp+admin+builder+asks); both typechecks + `next build` green.

**Code review:** One real finding, fixed — `buildShiftCard` derived its window from ALL events while the outbox, ask card, and `bailLate` filter `status==scheduled`, so a cancelled *latest* trip would push the shift card's end past the other surfaces (falsifying DEC-041's consistency claim). Now scheduled-only + a test locking the cancelled-later-trip case. One known limitation left as-is (pre-existing): a departure after ~21:35 wraps the clock-string end past midnight with no +1d marker — same wrap `callTime`/`minusMinutes` already carry, documented in the `plusMinutes` comment.
**PR:** [#96](https://github.com/mobiustripper42/muster/pull/96)
**Points:** 3
**Branch:** task/92-event-duration
**Opened at:** 2026-06-19T04:13:27Z

**Next Steps:**

**Context:**
