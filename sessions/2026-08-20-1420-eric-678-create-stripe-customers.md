---
session: 91
dev: eric
slug: 678-create-stripe-customers
branch: task/678-create-stripe-customers
started: 2026-08-20T14:20:24Z
ended:
points:
pr_numbers: []
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster-s91/a644283b-bc9c-59d6-a0d0-e05c848a61ed.jsonl
---

# Session 91 — 678-create-stripe-customers

<!-- Task blocks appended by /kill-this, one per task. -->

**Next Steps:**

**Context:**
- **Concurrent with session 90**, which holds the main checkout `/home/eric/muster` (last seen on
  `task/724-cancel-reason`). This session runs in the linked worktree `/home/eric/muster-s91`,
  cut from `main` at `6c19a05`.
- Branch was cut as `task/679-…` by typo and renamed to `task/678-create-stripe-customers` at open
  (zero commits, never on origin). The session file was renamed to match. Issue #679 is a separate
  task (send our form's contact details to Stripe).
- Both sessions share the one `sessions` branch worktree at `/home/eric/muster/.sessions-worktree`,
  because a branch can only be checked out once. `/kill-this` and `/its-dead` in either window
  `reset --hard` it — so the two must not run at the same moment.
- **`/security-review` reads the shell's cwd, not the session's branch** — run it from inside
  `/home/eric/muster-s91`, never from the main checkout (session 89 finding).
- Drift vs seeds at open: 5 `logic`-class files differ (the five session skills). seeds-version 5
  on both sides. Not acted on.
