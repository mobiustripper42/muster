# Seeds backport manifest — doc consistency run 2026-07-25

`CLAUDE.md` is a seeds-managed shell (DEC-S019): it normally syncs from seeds untouched, and
edits made here are overwritten by the next `/pull-seeds`. This run edits it anyway, by operator
decision — the drift is real and waiting on a seeds round-trip would block the audit.

**Every edit to `CLAUDE.md` (or any other seeds-managed file) made during this run gets a row
below.** `/push-seeds` reads this file as its worklist.

**Muster's `CLAUDE.md` was byte-identical to seeds `origin/main`'s `dev/claude/CLAUDE.md` before
these edits** (verified: `diff` → 0 differing lines). So rows 2–6 below are **upstream defects**,
not Muster drift — they are wrong in seeds right now and in every project sharing that shell.
Row 1 is the opposite: a deliberate project substitution that must NOT go upstream.

| # | file:line | what changed | why | backport? |
|---|-----------|--------------|-----|-----------|
| 1 | `CLAUDE.md:1` | `# [Project Name] —` → `# Muster —` | Unfilled template placeholder in a live project (shard F row 1) | **No** — project substitution. The template keeps the placeholder. |
| 2 | `CLAUDE.md:64` | `/retro` row: active-time velocity (wall − breaks, h/pt) → throughput (points/calendar week from issue `closedAt` + `points:N`, DEC-S026, no transcript read). Patch-bump made conditional on having no `production` branch. | Described a velocity model DEC-S026 retired; `.claude/skills/retro/SKILL.md:37` and `:207` are the correct behavior (shard F rows 2, 9) | **Yes** |
| 3 | `CLAUDE.md:66` | `/promote-production` row: "deploy-only; tag already on the commit" → "patch-bump + tag the trunk, then ff-merge" | Contradicted `promote-production/SKILL.md:52,84` and `CLAUDE.md:133` in the same file (shard F row 7) | **Yes** |
| 4 | `CLAUDE.md:84` | @sync-config trigger gains "and the nightly sync Routine (DEC-S010)" | `.claude/agents/sync-config.md:26` runs `mode: auto` on that Routine; the shell listed only the two skills (shard F row 24) | **Yes** |
| 5 | `CLAUDE.md:118-120` | Production-branch section: patch bump moved from `/retro` to `/promote-production`, and the "promotion does not tag" clause deleted | Same contradiction as row 3, stated a second time and inconsistently with `:133` (shard F row 8) | **Yes** |
| 6 | `CLAUDE.md:143` | `<VersionTag />` component path: single seeds path → seeds template path plus a note that the installed copy lives per-project | Three different paths were documented across three files and none matched the real `components/ui/version-tag.tsx` (shard F row 15) | **Yes** |
