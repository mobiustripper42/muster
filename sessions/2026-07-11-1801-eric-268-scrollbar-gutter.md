---
session: 45
dev: eric
slug: 268-scrollbar-gutter
branch: task/268-scrollbar-gutter
started: 2026-07-11T18:01:40Z
ended:
points:
pr_numbers: [375, 377, 378, 379, 380, 385, 388]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/079da17b-1b62-4fa4-9b6a-b394651a3f5d.jsonl
---

# Session 45 — 268-scrollbar-gutter

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Extract Filter + ShiftRow from admin/shifts/page.tsx (closes #357)

**Completed:**
- Phase 10.5 (backlog cleanup — non-deferred, non-low issues). Pure move-refactor: `app/(admin)/admin/shifts/page.tsx` was 887 lines (>4× the 200-line ceiling after #321 presets + #330 crew filter grew it). Split into three new files under `components/admin/`:
  - `shifts-filter.tsx` — the date/preset/crew `Filter` bar
  - `shift-row.tsx` — the `ShiftRow` card + `canonicalIdOf` helper (both exported; page re-imports)
  - `shifts-view-types.ts` — shared `Mode`/`Scope` unions (single source of truth; no route→component or component→component type coupling)
- page.tsx down to 512 lines — now just auth + window resolution + data + two-pane layout, composing the extracted pieces. Byte-identical component logic (only `export` + import-path adjustments).
- Verified: typecheck (core+app), lint, build all green; e2e desktop (`E2E_PROD=1`) `all-shifts`+`shifts-view`+`two-pane-builder` **15/15**.

**Code review:** Clean bill of health — line-by-line byte-identical moves confirmed, both `canonicalIdOf` call sites resolve, no dead imports, action-import path matches the `risk-row.tsx` convention. Nit (non-blocking): `shift-row.tsx` is 218 lines, 18 over the ceiling (carried-over doc comments) — split the split/merge forms out if it grows. **#365 (next) adds to shift-row.tsx — watch the size.**
**PR:** [#375](https://github.com/mobiustripper42/muster/pull/375)
**Points:** 3
**Branch:** task/357-extract-shifts-components
**Opened at:** 2026-07-11T18:57:13Z

## Task 2: Keep the selected row in view on the two-pane board (closes #365)

**Completed:**
- Operator-reported: clicking a shift on the desktop two-pane `/admin/shifts` snapped the independently-scrolling `board-col` (DEC-085) to the top, losing your place. Fix = **DEC-112**: a `'use client'` island `components/admin/reveal-selected-row.tsx` `<RevealSelectedRow sel nav={ctx}>` that nudges **board-col's own scrollTop** to reveal the selected row (`col.scrollTop += rowRect.top − colRect.top − 16`, guarded), never the window. Inert on mobile (`offsetParent === null`). Re-runs on `[sel, nav]` so a filter/mode change with the pane open re-reveals the row.
- **Rejected the obvious CSS `#shiftrow-<id>` fragment**: native `scrollIntoView` bubbles through scrollable ancestors and drags the WINDOW ~50px on desktop windows < ~750px tall, via a **pre-existing ~100px `lg` document overflow** — breaking DEC-085 "window never scrolls." @architect confirmed imperative-scoped-scroll is the more robust call (not just expedient).
- **Filed #376** for the latent document overflow (own bug; @architect said decouple from #365).
- @architect-gated (DEC-026 island-family extension). DEC-112 recorded.
- Verified: typecheck/lint/build green; e2e desktop `two-pane-builder` **8/8** (incl. `window.scrollY < 5` guard — the guarantee the fragment broke), `shifts-view` 7/7, `all-shifts` 3/3.

**Detour worth noting:** simple anchor → verified window-scroll leak → client island + DEC-112 + spun-off #376. Two code-review passes: caught (1) the window-leak on the fragment approach, (2) the filter-change-with-pane-open gap (widened effect to `[sel,nav]`). Real-mobile-Safari eyeball owed (e2e is Chromium; island is inert on mobile via `offsetParent`).
**Code review:** Island mechanics clean (scroll math, mobile guard, id uniqueness, RSC boundary, StrictMode idempotence). 2 items addressed (nav-keyed re-reveal + dual-purpose testid comment); `useEffect` over `useLayoutEffect` kept (SSR warning).
**PR:** [#377](https://github.com/mobiustripper42/muster/pull/377) — **stacked on #375** (base `task/357`); retarget to main after #375 merges.
**Points:** 5 (grew from the window-leak detour)
**Branch:** task/365-preserve-list-scroll
**Opened at:** 2026-07-11T19:53:46Z

## Task 3: Make FILL_DEADLINE_HOURS env-tunable (closes #322)

**Completed:**
- Decided (user, this session): env-tunable, **keep 48h default** — ship the knob, not the value (issue said "do not change the value yet"). `src/builder/derive.ts`: `FILL_DEADLINE_HOURS = 48` → `envPositiveNumber("FILL_DEADLINE_HOURS", 48)`, mirroring DEC-062's `STAFFING_HORIZON_LEAD_DAYS`. Operator flips prod to 3 days later via Vercel env `FILL_DEADLINE_HOURS=72`, no code change.
- DEC-031 double-duty preserved (same instant = shown "fills by" AND route-(b) At-Risk boarding via `EXHAUSTED_THRESHOLD_HOURS` re-export).
- `derive.test.ts`: env-override test block (default 48 / 72 override / fraction / garbage→48) mirroring the STAFFING one. DEC-113 recorded.
- Verified: `derive` + `at-risk-board` tests **77 pass** (incl. 4 new); typecheck core+app, build green. Core-only, no UI/e2e.
- Self-reviewed (mechanical exact-mirror of an established pattern; no agent).

**Code review:** Self — mechanical mirror, default preserved, no schema/domain state.
**PR:** [#378](https://github.com/mobiustripper42/muster/pull/378) — off main, independent. DEC-113 shares the DECISIONS.md append spot with #377's DEC-112 → trivial conflict on 2nd merge.
**Points:** 2
**Branch:** task/322-fill-deadline-env
**Opened at:** 2026-07-11T19:57:40Z

## Task 4: Split teardown from the call lead in the shift-end (closes #275)

**Completed:**
- Shift-end "back" reused `CALL_LEAD_MINUTES` (45, pre-trip prep) as the post-trip teardown → ran long. Added `TEARDOWN_MINUTES = 25` (`src/builder/derive.ts`) for the tail; front call time unchanged. Applied to all three window computations: `shiftEndFromEvents`, `committedWindow`, `committedMinutes`.
- **Code review caught a real miss:** `suggestSplit`'s gap/span math still used the same symmetric `2×CALL_LEAD` (its docstring literally says "teardown") → under-counted dead gaps 20min/boundary (90-min gap read as 70, missed split cues). Fixed `occupiedMin = TRIP_DURATION + TEARDOWN + CALL_LEAD`; repinned split-suggestion + all-shifts tests.
- DEC-041 **amended in place** (was contradicting the code) — placed at DEC-041, NOT the append point, so no conflict with #377/#378. No new DEC (constant refinement).
- All ripples updated: payroll (`committedMinutes`, hours 90→70/shift), calendar DTEND, outbox/crew-view shift-end + comments.
- Verified: **full unit 968 pass**; e2e `payroll` (5h10m→4h50m), `calendar-feed`, `crew-ask/open`, `shifts-view` split cue, `all-shifts` — all green.

**Code review:** 2 passes. Caught the split-suggestion miss (same buffer, unfixed) + DEC-041 contradiction + stale test title — all addressed. Front/call-time verified untouched.
**PR:** [#379](https://github.com/mobiustripper42/muster/pull/379) — off main. Shares derive.ts with #378 (different regions, trivial merge). **Payroll hours drop ~20min/shift — expected.**
**Points:** 3 (grew via the split-suggestion consistency fix)
**Branch:** task/275-teardown-minutes
**Opened at:** 2026-07-11T20:13:59Z

## Task 5: Crew 'other shifts today' on the shift card (closes #315)

**Completed:**
- User-scoped this session: an expand/collapse "other shifts today" on `crew/shift/[id]` listing the day's other boats — boat, first departure, crew. Designed to later host a cohort-message button (its own issue; DTO carries `shiftId`).
- `src/crewapp/other-shifts.ts` `otherShiftsOnDay()` — reuses admin `deriveAllShifts`, narrows to a lean crew DTO. **PII boundary: no guest manifest** (physically can't — narrow DTO); **no scoreboard** (DEC-042). `crewName` only populates for Confirmed seats (no tentative-claim "aboard" leak).
- `components/crew/other-shifts-today.tsx` — no-JS `<details>`, collapsed default, renders null when sole shift that day.
- Wired into page.tsx (best-effort fetch AFTER the crew-on-this-shift auth gate).
- Crew seed: 2nd same-day boat (Growler/Gilly) — Gilly UNRATED + force-Confirmed → inert (no ask-pool disturbance). Added `other-shifts-today` to the mobile 375px allowlist.
- Verified: 3 unit tests; **full suite 971 pass**; e2e desktop + 375px mobile; **52 crew-seed specs green (no regressions)**.

**Code review:** Clean bill of health — PII boundary by construction, auth ordering correct, Confirmed-only crew, seed inert + non-colliding.
**PR:** [#380](https://github.com/mobiustripper42/muster/pull/380) — off main, independent.
**Points:** 5
**Branch:** task/315-other-shifts-today
**Opened at:** 2026-07-11T20:43:12Z

## Task 6: Import — don't flag yesterday's un-boated trips as 'assign a boat' (closes #384)

**Completed:**
- Operator-reported (2026-07-12): the daily import's loud "N booked trips have no boat — assign a boat & re-import" alert listed trips **all from yesterday** (past trips can't be crewed → noise). Filed #384, diagnosed + fixed same session.
- Cause: `pullWindow` starts at `today−1` (reconciliation back-buffer), but `bookedNoBoat` filtered `>= window.start` (yesterday) → past un-boated trips got the actionable alarm. Fix (`src/import/xola-pull.ts`): lower bound `>= today`; past drops into the benign `mapSkipped` tally. Fetch buffer unchanged.
- Discovered the **.xlsx upload is retired (DEC-043)** — prod import is now the manual **API pull** (`pullXola`), not xlsx. **Corrected the stale `xola-ingest-credential-model` memory** + MEMORY.md hook.
- Tests: `xola-pull.test.ts` boundary repinned (today IN, today−1 OUT-but-counted, end IN, past-end OUT). **Full suite 969 pass**; typecheck+build clean. Self-reviewed (one-filter change, boundaries pinned).

**Code review:** Self — minimal, boundary-pinned.
**PR:** [#385](https://github.com/mobiustripper42/muster/pull/385) — off main, independent. Core-only, no migration/UI.
**Points:** 1
**Branch:** task/384-import-no-boat-past
**Opened at:** 2026-07-12T12:49:47Z

## Task 7: Doorbell SMS — bare 'You have a new Muster message [link]' (closes #387)

**Completed:**
- Operator-reported: the doorbell notification SMS inlined a single short note's raw text (§7.5 content mode) → confusing (message out of context + link). Now every ring's body is the fixed "You have a new Muster message"; channel appends the deep link. Fixes auto-SMS + operator relay text (same field); keeps message content off SMS entirely.
- `src/adapters/forward-notifications.ts`: body = `RING_NOTIFICATION_BODY`; dropped content-inline + "N new" count + unused message fetch. `mode` still flows for the ring-outbox record.
- Tests repinned (forward-notifications, doorbell-tick, ring-relay) + an assert the note text does NOT leak. 967 unit pass; ring-relay e2e 3/3.

**Code review:** Self — scoped copy change, tests cover the no-leak.
**PR:** [#388](https://github.com/mobiustripper42/muster/pull/388) — off main, independent.
**Points:** 1
**Branch:** task/387-doorbell-sms-bare
**Opened at:** 2026-07-12T14:57:39Z

**Next Steps:**
- **IN PROGRESS: MESSAGING flag** (disable ALL messaging via env flag, DEC-059-style; user decided 2026-07-12) — hide crew Messages link + shift-card Message buttons, admin Messages nav/tile, cockpit cohort link. Leave routes/code. Own issue+PR.
- **#293** (retire OPERATOR_CREW_MEMBER_ID singleton) held for a fresh session — delicate 7-site auth/messaging refactor (act-as → acting admin's crew id; is-this → admins-set membership; exclude-from-ring → doorbell). Needs @architect. NOT started (stray local `task/293` branch, no commits).
- **Merge order:** #375 (357) then #377 (365, stacked). #378/#379 both touch derive.ts (diff regions, trivial). #378 DEC-113 + #377 DEC-112 append same DECISIONS.md spot → resolve conflict on 2nd merge (keep both). #379 amended DEC-041 in place (no conflict).
- **#376** filed (latent ~100px lg document overflow — pre-existing DEC-085 violation, decoupled from #365).
- Concurrent **Session 46** (feature/reservations, Phase 11) ran in another window this whole session.

**Context:**
- Phase 10.5 = backlog cleanup (non-deferred, non-low). Labeled the 6 in-scope issues `phase:10.5`; #330 closed as already-shipped (#358).
- #365 was the big detour: simple CSS anchor leaked window scroll (verified) → DEC-112 client-JS island (@architect-gated) + spun-off #376. #275 grew via a review-caught split-suggestion miss (same teardown buffer). Both landed fully-baked, not half-fixed.
- Two-review-passes each on #357/#365/#275/#315 caught real issues (window-leak, filter-change gap, split-suggestion, none on #315). `E2E_PROD=1` for the dev-lock-safe e2e path throughout.

**Context:**
