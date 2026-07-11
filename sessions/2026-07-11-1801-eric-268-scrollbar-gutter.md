---
session: 45
dev: eric
slug: 268-scrollbar-gutter
branch: task/268-scrollbar-gutter
started: 2026-07-11T18:01:40Z
ended:
points:
pr_numbers: [375]
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

**Next Steps:**

**Context:**
