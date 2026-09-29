---
name: retro
description: Phase-end retrospective. Closes the current phase and writes a retro that fits on one screen — one line of numbers, a short account of what happened, the operator's own take, and a one-paragraph PM read. Marks PROJECT_PLAN.md `[x]`, reconciles drift, writes RETROSPECTIVES.md, runs version bumps (patch per merged PR + minor at phase close on dev projects). Optionally chains into `/start-phase`.
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are running the phase-end retrospective. Work for this phase is complete (or you've decided to call it done and move scope).

This skill owns the phase retro and **all version bumps** (patch per merge + minor at close). Session files are atomic event logs; GitHub issues and their `points:N` labels are the record of what shipped.

**The retro is short on purpose.** The operator works across several projects and does not reread these, so a retro that takes a page to say what happened loses the one insight worth keeping in the prose around it. Every section below has a length, and the length is the point. The numbers are still written down, because they cost one line and nobody can reconstruct them later.

## Step 0 — Identify the current phase

Find phase N as the **lowest phase number with any open issues** OR (if all closed) the highest phase with `[ ]` rows in PROJECT_PLAN.md but no `[x]` marks yet.

```
for phase in 0 1 2 3 4 5 6 7 8 9; do
  open=$(gh issue list --label "phase:$phase" --state open --json number -q 'length')
  if [ "$open" -gt 0 ]; then echo "Phase $phase has $open open issues"; break; fi
done
```

Confirm: "Run retro for Phase **N**?" Wait.

## Step 1 — Account for all phase issues

```
gh issue list --label "phase:<N>" --state all --json number,title,state,labels --limit 100
```

For each open issue, ask the user: "Move to next phase, leave open, or close as won't-do?"
- **Move:** swap `phase:N` → `phase:N+1`.
- **Leave open:** record in retro.
- **Close as won't-do:** `gh issue close <N> --reason "not planned" --comment "Closed at Phase N retro — descoped."`

## Step 2 — The numbers

Everything here comes from data GitHub and PROJECT_PLAN.md already hold. **No session transcript is read.**

```
gh issue list --label "phase:<N>" --state closed --json number,createdAt,closedAt,labels --limit 200
```

- `points` = Σ of each closed issue's `points:M` label. An issue with **no** `points:` label is skipped and listed in the retro so it is visible — never guess a value.
- `planned` = Σ of the phase's original estimates in PROJECT_PLAN.md.
- `phase_start_iso` = the first `createdAt`; `phase_end_iso` = the last `closedAt`. `days` = the gap between them, in days.
- `re_estimated` = tasks whose points changed between original estimate and final. `net_drift` = Σ final − Σ original; positive means tasks ran bigger than pointed.
- `prs` = PRs merged between those two dates. Count them here, since the numbers line needs them before the version bumps run; Step 9.1 reuses this list:
  ```
  gh pr list --state merged --search "merged:>=<phase_start_iso> merged:<=<phase_end_iso>" --json number,title,mergedAt --limit 100
  ```

**No rate is computed.** Points, days and drift are enough to derive one later if it is ever wanted, and a per-week number was the thing the old retro led with while nobody used it. Never re-pair PR-open → PR-merge to recover "effort" — that window math is the bug an earlier velocity model died on.

The numbers line, used in Steps 6, 7 and 10:

```
**Numbers:** <points> / <planned> pts · <days> days · <re_estimated> re-estimated, drift <±net_drift> · <prs> PRs
```

## Step 3 — Update PROJECT_PLAN.md

Mark all closed phase tasks `[x]`. For each row:
```
| 1.1 | Task description | 3 | [x] [#42](url) |
```

Reconcile drift: issues with `phase:<N>` labels that don't appear in PROJECT_PLAN.md (added mid-phase). Add rows with status `[x] [#N](url)` and inline note `Added during P<N> retro`.

Append one row to the phase table:
```
| Phase | Closed | Points | Days | Re-estimated | Net drift |
|-------|--------|--------|------|--------------|-----------|
| N     | <date> | <points> / <planned> | <days> | <K> | <±D> |
```

**Don't rewrite history.** A table written under an older model keeps its header and its rows; put `—` in any column this skill no longer computes (Throughput, Wall, h/pt) and fill the rest.

## Step 4 — What happened

Write **two or three sentences, 60 words at most**, from the closed issues, the Step 1 moves and descopes, and the phase's session files (their `## Task` blocks and Next Steps). Say what shipped, what was added or cut, and what got in the way. A roadblock is named if there was one; "none" is not written if there wasn't.

Show it to the operator before asking anything. It is there to remind them what happened — they are working across several projects and should not have to remember.

## Step 5 — The operator's take

Ask one question and record the answer verbatim:

> **How did it go, and what would you change?**

One or two sentences is the expected answer. Do not follow up, and do not ask the old three questions separately.

## Step 6 — PM read

Invoke `@pm` with the numbers line, the Step 4 account, the operator's verbatim take, the closed-issue list with moves and descopes, and `docs/RETROSPECTIVES.md` for comparison. Let `@pm` read the session files for detail.

**`@pm` returns one paragraph, 120 words at most.** It reacts to the operator's take rather than paraphrasing it, compares against earlier phases only when a pattern is actually there, and ends on one thing to do differently. Count the words before showing it; over the cap goes back to `@pm` to cut, not to the operator to read.

Show it verbatim:
> **PM read on Phase N:**
>
> <commentary>
>
> Use (a), edit (e), or skip (s)?

- **Use:** carry forward.
- **Edit:** ask "What would you change?" — apply edits, carry forward.
- **Skip:** omit the line from RETROSPECTIVES.md.

## Step 7 — Append to RETROSPECTIVES.md

Read `docs/RETROSPECTIVES.md` first (Edit requires a prior Read). If it doesn't exist, create it with Write and the header `# Retrospectives\n\n`. Otherwise Edit the file by replacing the `# Retrospectives\n\n` header with `# Retrospectives\n\n## Phase <N> — <YYYY-MM-DD>\n\n...block...\n\n` so the new phase lands at the top. The block:

```
## Phase <N> — <YYYY-MM-DD>

**Numbers:** <the Step 2 line>

**What happened:** <Step 4>

**Operator:** <Step 5, verbatim>

**PM read:** <Step 6 — omit this line if skipped>
```

Add `**Unpointed:** #<N>, #<N>` only when Step 2 found closed issues with no `points:` label.

## Step 8 — Commit (sessions branch updates are read-only here)

Session files were already finalized by `/its-dead` and are not modified by this skill.

```
git add docs/PROJECT_PLAN.md docs/RETROSPECTIVES.md
git commit -m "Phase <N> retro — <points>/<planned> pts, drift <±D>"
git push origin <BRANCH>
```

## Step 9 — Version bumps (versioned projects only)

Run only if the repo root has a `package.json` **with a `version` field** (versioned-project signal):

```
node -e "process.exit(require('./package.json').version ? 0 : 1)" 2>/dev/null || echo "not versioned"
```

If it prints `not versioned`, skip Step 9 entirely. The gate is the field, not the file: a repo can carry a `private`, version-less manifest purely to get a test runner, and bumping it would be inventing a version for something that has none.

**`2>/dev/null` is deliberate and it does swallow one real error.** A `package.json` that is malformed JSON makes `require()` throw, which exits non-zero and reads here as "not versioned" — indistinguishable from a repo that simply has no version. That is the right default for a gate whose job is to decide whether to proceed, and a broken manifest will announce itself the moment anything else npm-shaped runs. Stated so the redirect isn't mistaken for carelessness.

Resolve working branch — always the active trunk:
```
WORKING_BRANCH=main
```
Bumps and tags land on `main` directly; `production` (if any) only moves at `/promote-production`.

If `BRANCH != $WORKING_BRANCH`: STOP. Tell the user "Switch to `$WORKING_BRANCH` and re-run /retro." Wait.

### Step 9.1 — The merged PRs in the phase window

Use the list Step 2 fetched. Sort by `mergedAt` ascending. On **deploy-off-main** projects each PR earns one patch bump + CHANGELOG entry (Step 9.2). On **production-branch** projects patches already landed at `/promote-production` (one release = one patch), so Step 9.2 is skipped and this list feeds only the phase CHANGELOG summary.

### Step 9.2 — Patch-bump per PR (deploy-off-main projects only)

**Skip this entire step if a `production` branch exists** — those projects patch-bump at `/promote-production` on each ship, so per-PR patches here would double-count:
```
git show-ref --verify --quiet refs/remotes/origin/production && echo "has production — skip to 9.3"
```
If `origin/production` exists, go straight to Step 9.3 (minor bump). Only projects that deploy straight off `main` patch-bump per PR below.

For each PR in order, sequentially:

a. **Bump patch:** `NEW_VERSION=$(npm version patch --no-git-tag-version | tr -d 'v')`.

b. **CHANGELOG entry.** If `CHANGELOG.md` doesn't exist, create with `# Changelog\n\n`. Read it first; if it doesn't start with the literal `# Changelog\n` header, STOP and surface (don't guess where to insert). Prepend after the header:
   ```
   ## [<NEW_VERSION>] - <YYYY-MM-DD>
   - PR #<N>: <title>
   ```

c. **Commit + tag (main only):**
   ```
   git add package.json CHANGELOG.md
   [ -f package-lock.json ] && git add package-lock.json
   git commit -m "Bump version to v<NEW_VERSION> (PR #<N>)"
   git tag "v<NEW_VERSION>"
   ```
   Tags land on the trunk at bump time. (This step runs only for deploy-off-main projects — there's no `production` branch to promote to.)

### Step 9.3 — Minor-bump at phase close

After all PR patches:

a. `NEW_VERSION=$(npm version minor --no-git-tag-version | tr -d 'v')` — zeros the patch (e.g. 1.2.7 → 1.3.0).

b. CHANGELOG entry:
   ```
   ## [<NEW_VERSION>] - <YYYY-MM-DD> — Phase <N>
   - <points> pts shipped across <prs> PRs
   - See `docs/RETROSPECTIVES.md` for the retro
   ```

c. Commit + tag (main only):
   ```
   git add package.json CHANGELOG.md
   [ -f package-lock.json ] && git add package-lock.json
   git commit -m "Phase <N> close — bump to v<NEW_VERSION>"
   git tag "v<NEW_VERSION>"
   ```

### Step 9.4 — Push

```
git push origin "$WORKING_BRANCH"
```
If any tags were created in 9.2 or 9.3: `git push origin --tags`.

Echo: `Phase <N> closed at v<NEW_VERSION>` (and `tagged` if main).

## Step 10 — Summary

```
Phase <N> closed.
<the Step 2 numbers line, without the bold label>
Issues: <closed>/<created> closed; <moved> moved to Phase <N+1>
Retro: docs/RETROSPECTIVES.md
Version: v<NEW_VERSION>  (versioned projects only; skipped per Step 9's gate)
```

Then: "Phase <N+1> is next. Run `/start-phase <N+1>` now or stop here?" Let the user invoke `/start-phase` themselves — don't auto-chain.

## Notes

- **Session files are read-only here.** Retro reads them; never writes — a session file is atomic once `/its-dead` closes it.
- **No transcript is read anywhere.** `gh` is the data source for the numbers (Step 2), issue accounting (Step 1) and version bumps (Step 9). If `gh` is down, the numbers cannot be computed; say so and let the user rerun. Don't guess.
- **Old retros stay as written.** Phases closed under an earlier model carry throughput tables, three-question sections and multi-paragraph PM reads. Don't rewrite them and don't blend their numbers with these.
