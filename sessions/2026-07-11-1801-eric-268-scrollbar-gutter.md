---
session: 45
dev: eric
slug: 268-scrollbar-gutter
branch: task/268-scrollbar-gutter
started: 2026-07-11T18:01:40Z
ended:
points:
pr_numbers: [375, 377]
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

**Next Steps:**

**Context:**
