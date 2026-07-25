# Doc consistency audit — 2026-07-25 (sharded run)

The first full consistency pass over this project's doc set. Run in **shards** because the
finding volume, not the corpus size, is what exhausts a context window: 9,281 doc lines produce
enough findings that triaging them in one pass produces bad decisions. S67's unsharded attempt
returned 46 findings (posted as a comment on #525) and lost one of four parallel sweeps silently.

## How this run works

1. **Findings live here, not in a conversation.** Each shard writes one ledger file. The sweep
   agent returns only a count and a path — never the findings themselves.
2. **Shards are subject-scoped, not file-scoped.** A cross-doc mismatch *is* the finding, so
   sharding per file would destroy the check. Each shard reads the slice of every doc that
   touches its subject.
3. **Sequential, one agent per shard.** A lost agent costs one shard, and the run resumes from
   this file across sessions.

## Row format (every ledger file)

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |

- **verdict** — `MISMATCH` (two docs disagree) · `PLACEHOLDER` (unfilled template text) ·
  `CODE-CONTRADICTS` (doc claim false against source) · `UNVERIFIABLE` (needs prod/env access) ·
  `NOISE` (looked like a finding, isn't — recorded so it isn't re-derived)
- **proposed bucket** — `doc-wrong` (edit the doc) · `code-wrong` (file an issue) ·
  `decision` (needs an operator call) · `known` (already an open/closed issue, cite it) ·
  `decisions-internal` (routes to the DECISIONS rewrite task, see below)

Buckets are *proposed* by the sweep and re-assigned at triage. The sweep does not decide.

## Shards

| Shard | Subject | Primary docs | Status |
|-------|---------|--------------|--------|
| F | Workflow / skills / velocity | `CLAUDE.md`, `AGENTS.md`, `CHEATSHEET.md`, `VELOCITY_AND_POKER_GUIDE.md`, `PROJECT_PLAN.md`, `DEV_REFERENCE.md` | **swept — 53 rows, triaged** |
| B | Auth / RLS / login paths | `AUTH.md`, `SECURITY_AUDIT.md`, `RUNNING.md`, `SPEC.md` | not started |
| A | Money / pricing / payments | `SPEC.md`, migrations | not started |
| C | Asks / shifts / derived state | `SPEC.md`, `USER_STORIES.md` | not started |
| D | Reservations & import | `SPEC.md`, `OPERATOR_MANUAL.md`, `E2E-PILOT-WALKTHROUGH.md`, `PILOT_*` | not started |
| E | Deploy / env / ops | `DEPLOY.md`, `RUNNING.md`, `PILOT_RUNBOOK.md` | not started |
| G | Brand / UI | `BRAND.md`, `docs/design/DESIGN-REFERENCE.md` | not started |
| Z | DECISIONS-internal | `DECISIONS.md` only | **deferred to its own task** |

## Standing rules for this run

- **`DECISIONS.md` is read as authority, never as subject.** It is the file most other docs are
  checked *against*, so every shard reads it. But findings *about* `DECISIONS.md` itself —
  internal contradictions, dead cross-refs, the ACTIVE/archive split — go to shard Z and are not
  edited in this run. `feature/reservations` carries ~114 divergent lines in that file
  (DEC-134–137); restructuring it on `main` would have to be hand-reconciled at merge-back.
- **`CLAUDE.md` edits are allowed**, against the usual seeds rule. Every edit to it is appended to
  `seeds-backport.md` so `/push-seeds` gets a manifest instead of a diff to reverse-engineer.
- **`.claude/skills/**` and `.claude/agents/*.md` are evidence, not subjects.** A claim in
  `CLAUDE.md` about what a skill does is checkable against the skill file. Drift *within* those
  template files is `@sync-config`'s job, not this run's.
- **Prior art:** reconcile against the 46-finding report on issue #525 rather than re-deriving it.
  A finding already in that report is still logged here, with the #525 reference in the
  "checked against" column.

## Resume state

- Ledgers complete: **F** (53 rows — 32 MISMATCH, 9 CODE-CONTRADICTS, 1 PLACEHOLDER, 1 UNVERIFIABLE, 10 NOISE)
- Next shard: B (auth), then A (money)
- Shard F cost one agent, 143k subagent tokens. Budget the remaining six shards accordingly —
  the corpus slices for A/C/D are larger than F's.
