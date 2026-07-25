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
| F | Workflow / skills / velocity | `CLAUDE.md`, `AGENTS.md`, `CHEATSHEET.md`, `VELOCITY_AND_POKER_GUIDE.md`, `PROJECT_PLAN.md`, `DEV_REFERENCE.md` | **✅ CLOSED — 53 rows, all resolved** |
| B | Auth / RLS / login paths | `AUTH.md`, `SECURITY_AUDIT.md`, `RUNNING.md`, `SPEC.md` | not started |
| A | Money / pricing / payments | `SPEC.md`, migrations | **✅ CLOSED — 7 rows, 8 noise** (audited `feature/reservations`) |
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

- **Shard F closed** — 53 rows, 43 real findings fixed/filed/parked, 10 noise. One issue filed
  (#533, Phase 11 never closed). The six `CLAUDE.md` fixes **shipped** — seeds PR #148 (merged),
  which also carried the agent `model:` pins and the `CLAUDE.md §Commands` build-gate repoint.
  Muster-side fixes shipped in PR #535 (merged).
- **Shard A closed** — 7 findings, 8 verified-consistent. All `doc-wrong`; **no code defects, no
  issues filed.** Audited `feature/reservations` @ `0ad83d6`, not `main` (see the shard file for
  why). Fixes not yet applied — the ledger is the deliverable.
- Next shard: B (auth), then C/D.
- Shard F cost one agent, 143k subagent tokens, and produced 53 findings from the *smallest*
  corpus slice. Shard A ran in-context for far less. Budget C/D closer to F than to A — expect
  the triage pass, not the sweep, to be the expensive half.

### Lessons that change how later shards run

1. **Verify seeds claims against `origin/main`, not the local checkout.** The local `~/seeds` was
   11 commits behind, which produced four wrong or misfiled rows in shard F (4, 5, 6, 18) and one
   fabricated "11 commits of pull-seeds debt" that turned out to be a single low-priority file.
2. **A finding against `CLAUDE.md` is probably an upstream defect.** Muster's copy was
   byte-identical to the seeds template, so shell findings are template findings — they affect
   every project sharing it, and the fix routes through `/push-seeds`. **Confirmed at triage:** 23
   of shard F's 43 findings lived in files byte-identical to seeds templates.
4. **Check which tree the subject actually lives in before sweeping.** Shard A's entire corpus is
   on `feature/reservations`, not `main` — 862 commits and every money migration. A `main` sweep
   would have produced a ledger of "SPEC describes unbuilt features" and missed all 7 real rows.
   Shards C and D (asks/shifts, reservations/import) need the same check first.
5. **Not every shard needs a sweep agent.** Shard A's corpus was grep-reachable and small; running
   it in-context beat the ledger-on-disk indirection. Use the agent when the finding volume, not
   the corpus, is what threatens the window — that was F, and will be C and D.
3. **The ledger-on-disk pattern held.** The orchestrator read one 79-line file instead of taking
   53 findings into context. Keep it for every remaining shard.
