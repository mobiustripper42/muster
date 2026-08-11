---
session: 83
dev: eric
slug: hosting-migration
branch: task/dec-126-import-scope
started: 2026-08-11T12:16:52Z
ended:
points:
pr_numbers: []
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/0c2c0a81-350d-4911-86cc-a6094039ec44.jsonl
---

# Session 83 — hosting-migration

<!-- Task blocks appended by /kill-this, one per task. -->

**Next Steps:**

**Context:**
- Concurrent with Session 82 (`task/616-cancel-and-refund`, still `status: open`). This session
  runs in the main checkout at `/home/eric/muster`, which is sitting on
  `task/dec-126-import-scope` with uncommitted DEC-126/DEC-154 doc edits belonging to that other
  session. **Do not touch that working tree.** Any code this session needs goes on a linked
  worktree.
- Purpose: `docs/HOSTING_MIGRATION.md` Phase B — the read-and-record steps. This session exists
  because the `neon` and `vercel` MCP servers are remote/OAuth and could not be authorized from
  Desktop.
