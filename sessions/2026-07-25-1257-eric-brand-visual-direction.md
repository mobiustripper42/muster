---
session: 69
dev: eric
slug: brand-visual-direction
branch: task/brand-visual-direction
started: 2026-07-25T12:57:17Z
ended:
points:
pr_numbers: [534]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/963e972e-c6e8-4d50-93cb-7c3da0a94634.jsonl
---

# Session 69 — brand-visual-direction

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Sharded doc-consistency audit — scaffold + shard F closed

**Completed:**
- **Designed the sharding method** after the operator diagnosed the prior run's failure: the payload
  is *findings*, not corpus size. `docs/audit/2026-07-25/README.md` — subject-scoped shards (not
  per-file, which would destroy cross-doc comparison), one ledger per shard, sweep agents return
  only a count + path, sequential so a lost agent costs one shard and the run resumes across sessions.
- **Ran shard F** (workflow/skills/agents/versioning/velocity/phase-arithmetic) → 53 rows in
  `docs/audit/2026-07-25/shard-F-workflow.md`. Method held: orchestrator read one 79-line file.
- **Resolved all 43 real findings.** `CLAUDE.md`, `.claude/CLAUDE-context.md`, `docs/AGENTS.md`,
  `docs/CHEATSHEET.md`, `docs/PROJECT_PLAN.md`, `docs/DEV_REFERENCE.md`.
- **`docs/DECISIONS.md`** — added the `DEC-S` namespace paragraph (operator's design). 41 citations
  across 7 docs pointed at a series the file never mentioned.
- **Pinned 4 agents to Sonnet** (`pm`, `sync-config`, `tape-reader`, `doc-consistency`) — all were
  unpinned and inheriting Opus while three docs claimed Sonnet.
- **Fixed 8 phase-point arithmetic errors** in PROJECT_PLAN; left P1's unexplained 55 flagged in place.
- Filed **#533** (Phase 11 never closed by `/retro`).

**Code review:** Three findings, all fixed in `5fb2344`. One real defect — the first draft asserted
Phase 1 shipped "55" to match the velocity table instead of deriving it (column sums to 54). Also
recovered a step dropped in the AGENTS.md dedup, and completed the VersionTag surface list.

**PR:** [#534](https://github.com/mobiustripper42/muster/pull/534)
**Points:** 5
**Branch:** task/doc-consistency-sharded
**Opened at:** 2026-07-25T14:42:00Z

**Next Steps:**
- **Shards B (auth) and A (money) next; C/D/E/G recommended for parking** — low yield against SPEC
  content that's mid-rewrite, and #532 just rewrote BRAND.
- **Change the shard contract before B runs:** land the *sweep* (ledger only, no doc edits) as its
  own PR so the operator reads a table and picks rows, then a small fix PR per accepted batch.
  Shard F fused sweep and fix, which is what made its diff feel like a wall.
- **Cap the fix batch:** anything that isn't a one-line factual correction becomes an issue, not an
  edit. Shard F's 8 arithmetic rows each needed a judgment call — those are the rows worth arguing with.
- **`/push-seeds` owes 5 backports** — `docs/audit/2026-07-25/seeds-backport.md` is the worklist.
  These are defects in every project sharing the shell, not Muster-local.
- **#533** (Phase 11 close) is unstarted and needs operator calls: the one open `phase:11` issue,
  and whether the minor bump lands retroactively as 1.1.0.

**Context:**
- **Verify seeds claims against `origin/main`, never the local checkout.** `~/seeds` was 11 commits
  behind, which produced four wrong/misfiled ledger rows and one fabricated "11 commits of
  pull-seeds debt" that was actually a single low-priority file. Cost a full re-check cycle.
- **A finding against `CLAUDE.md` is probably an upstream seeds defect.** Muster's copy was
  byte-identical to the template, so shell findings affect every project sharing it.
- **The ledger-on-disk pattern is the reusable win** — worth keeping for any high-volume sweep,
  not just docs.
- Session 68 (11:21Z) was marked abandoned at session open. It had closed #525/#529/#530/#531
  without recording a single task block; that work exists only in git + issue history.
- `.claude/seeds-version` says `4`, seeds says `3`. Unexplained.

**Context:**
