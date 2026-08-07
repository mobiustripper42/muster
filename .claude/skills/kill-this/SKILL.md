---
name: kill-this
description: Per-task PR + session-log update. Build check, commit code, push the task branch, run code review, open a PR, and append a `## Task <N>` block to the running session file on the orphan `sessions` branch. May run multiple times in one Claude window — one per task. Pair with `/its-dead` once at the end of the window. Time math + version bump moved to `/retro` (DEC-S013).
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are shipping one task. Under DEC-S013, `/kill-this` runs **per task**, not per session — there may be N invocations between `/its-alive` and `/its-dead`. Each one opens its own PR and appends one `## Task <N>` block to the session file (which lives on the orphan `sessions` branch via `.sessions-worktree/`, per DEC-S014).

## Step 0 — Capture branch + locate session file

`BRANCH=$(git branch --show-current)`.

Find the open session file on the sessions worktree:
```
SESSION_FILE=$(grep -l "^status: open" .sessions-worktree/sessions/*.md 2>/dev/null | head -1)
```

If none found: STOP. The user must run `/its-alive` first. (If `.sessions-worktree/` doesn't exist, that's also a sign `/its-alive` hasn't run — `/its-alive` Step 0.6 creates the worktree.)

Read the file's frontmatter to get session number `N` and the current `pr_numbers:` list.

Determine the next task index:
```
TASK_NUM=$(($(grep -c "^## Task " "$SESSION_FILE") + 1))
```

## Step 1 — Build check

Look up the project's build check in `.claude/CLAUDE-context.md §Commands` (e.g. `npm run build`, `cargo build`, `make`). Run it. Fix errors before proceeding. Do not commit broken code.

If no build step is defined (markdown-only / domain project), skip silently.

## Step 2 — Commit code on the task branch

Stage all uncommitted code changes on the **task branch** (the current `$BRANCH` — NOT the sessions worktree). The session-file update happens later in Step 5 and goes to the sessions branch, not here.

```
git add -A
git commit -m "<phase/task summary>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If there is nothing to commit, surface that and stop here — no PR for no code.

**Push the branch — do not open a PR yet:**

- **On `main` (DEC-S005 solo flow, unprotected main):** `git push origin main`. Skip Steps 3+4 — no PR. Go to Step 5.
- **On a `task/*`, `claude/<slug>`, or feature branch:** `git push -u origin $BRANCH`. Continue.

Capture `SUBJECT=$(git log -1 --format=%s)` for the PR title.

## Step 3 — Code review

Run `@code-review` against `git diff HEAD~1`. Capture the findings — needed for the PR body and the task block.

When addressing review findings before opening the PR: Read every file before editing it (parallel writes fail silently without a prior Read).

### Step 3.5 — High-blast-radius check (does this PR want `/code-review ultra`?)

`@code-review` hunts the project's known invariants. `/code-review ultra` is a different tool — it launches multiple agents to audit the branch independently from different angles and filters by confidence. It is **user-triggered and billed; Claude cannot launch it.** Do not attempt to run it via Bash or otherwise.

Read the project's trigger table from `.claude/CLAUDE-context.md` under `## Blast-Radius Triggers` and match it against the branch diff (`git diff $(git merge-base HEAD main)...HEAD --name-only`). If that section is absent, fall back to the four generic triggers below.

| Trigger | What to match |
|---|---|
| **Money moving** | payment-provider calls, webhook handlers, refunds, fee/tip/balance math |
| **Money being computed** | hours, rates, pay periods, tips, invoice totals — and any export that carries them |
| **Auth / capability URL** | session issue and validation, token minting, bearer or signed-link paths, permission checks |
| **Data-changing migration** | a new migration containing `drop`, `alter … type`, `update`, or `delete` (an additive `add column` does **not** trigger) |
| **Too big to review well** | the diff is large or sprawling enough that you would not confidently sign off on it yourself |

**The test, when a path isn't listed:** *does a number this code produces end up on someone's paycheck or invoice?* If yes, it's the money path — whether or not a payment provider is anywhere near it. The first two rows exist separately because defining "money" by **where money moves** misses where it is **computed**: a time-clock table can land with no payment file in the diff, and a wrong timestamp, a mis-bucketed pay period, or a double-counted punch is a wrong payment that no provider-shaped trigger would ever catch.

**If one or more hit, run the free local pass first, then surface the paid one.** A trigger that only ever produces a suggestion to spend money produces nothing on the days you decide not to spend it — and those are exactly the PRs it fired on.

1. **Run `/security-review`** against the branch. It is local, unbilled, and aimed at this class: authorization boundaries, injection, secret handling, unsafe defaults, failure modes that fail open. This is not a duplicate of Step 3 — `@code-review` hunts the project's conventions and invariants; this hunts the ways a hostile or malformed input gets through. Fold its findings into the PR body under their own heading, so the reviewer can see which pass produced what.
2. **Then print exactly this and continue** — never block, never run the billed tool:

```
⚠ This PR touches: <triggers>.
  Ran /security-review (local, free) — findings above.
  `/code-review ultra` is the deeper multi-agent pass: yours to run, I can't.
```

**Where each one earns its cost:** `/security-review` reads the diff once, carefully. `/code-review ultra` fans out across several independent agents and filters by confidence, which is what catches the finding a single careful read talks itself out of. Run the local pass always on a trigger; save the billed one for a genuinely novel money or auth path, where being wrong is expensive and one reviewer's confidence is not enough.

If none hit, run nothing extra. Docs, seeds, agent/skill files, dev tooling, and single-surface UI never trigger it — their blast radius stops at the dev environment.

### Step 3.6 — Say what actually ran

**Print this every time, including when nothing triggered.** Not as a summary of findings — as a receipt of which passes happened.

```
Review passes:
  ✓ @code-review       — <N> findings: <one-line verdict>
  ✓ /security-review   — <N> findings: <one-line verdict>      ← only when a trigger hit
  ⊘ /security-review   — not run (no blast-radius trigger)     ← otherwise
  ⊘ /code-review ultra — never automatic; yours to invoke
```

**Why this is its own step.** With three possible passes, "no news" is ambiguous in the one direction that matters: a review that silently didn't run looks exactly like a review that ran clean. That ambiguity was already reported on the two-pass version — a `⚠ consider ultra` line appeared and the operator could not tell from the output whether `@code-review` had run at all. Adding a third pass makes it worse unless the receipt is unconditional.

**A pass that errored is `✗`, not a missing line.** If `@code-review` fails to return, or `/security-review` can't run, say so on its row and continue to the PR — but never let a failed pass render as a quiet absence. The whole point of the receipt is that absence is never something the reader has to infer.

**Why this is a step and not a rule to remember:** the trigger is a property of the diff, and the moment you'd need to recall it is the moment you're least likely to (late, task finished, PR ready). Checking the diff is reliable; remembering is not.

## Step 4 — Open the PR

Resolve base branch — always the project's active trunk (DEC-S022):
```
BASE=main
```
`main` is the active trunk in every project. A `production` branch, if the project has one, is a downstream deploy pointer advanced by `/promote-production` — it is **never** a PR base. (If a project's default branch isn't `main`, set `BASE` to that; the steady state is `main`.)

### Step 4.0 — Resolve existing PR state for this branch

Set `EXISTING_PR_STATE` to one of `OPEN`, `MERGED`, `CLOSED`, `NONE`. Method 1 = `gh pr view "$BRANCH" --json url,state 2>/dev/null`. Method 2 = `mcp__github__list_pull_requests` (head: `<owner>:$BRANCH`, state: all). Method 3 = STOP and ask the user.

- **OPEN**: capture `PR_URL` and `PR_NUMBER`, skip Step 4.2 (no duplicate). Note in the task block.
- **MERGED / CLOSED**: unusual — this branch was already shipped. Ask the user: "Existing PR is `$EXISTING_PR_STATE`. Open a new PR on top? (y/n)" — if no, surface and stop; if yes, proceed to Step 4.2.
- **NONE**: proceed to Step 4.2.

### Step 4.2 — Create the PR

Compose `BODY`:

**## Summary**
One-line description.

**## Files changed**
Bulleted list from `git diff --name-only $BASE..HEAD`.

**## Code review**
Lead with the Step 3.6 receipt — which passes ran, which didn't, and why — then the findings from each, under its own sub-heading so the reviewer can tell them apart. "Clean bill of health" is a statement about a pass that *ran*; never write it in place of a pass that didn't.

**## Test plan**
Step-by-step scenarios you generated yourself from `git diff --name-only $BASE..HEAD`. Specific URL → action → expected result. Migration files → `supabase db push` verification. RLS / pgTAP touches → `supabase test db`. UI paths → per-screen scenario. Never empty, never generic.

Try in order:
1. `gh pr create --base "$BASE" --head "$BRANCH" --title "$SUBJECT" --body "$BODY"`
2. MCP `mcp__github__create_pull_request` fallback.
3. STOP: print body for the user to paste manually; note "PR not opened" in the task block.

Capture `PR_NUMBER` and `PR_URL`.

## Step 5 — Append the task block to the session file (sessions branch)

The session file lives on the orphan `sessions` branch at `.sessions-worktree/sessions/<file>.md`. Read it first.

Compose the task block:

```
## Task <TASK_NUM>: <one-line title>

**Completed:**
- <bullet list of what got done, with file paths>

**Code review:** <findings summary or "Clean">
**PR:** [#<PR_NUMBER>](<PR_URL>)
**Points:** <effort estimate>
**Blocked:** <only if blocked>
**Branch:** <BRANCH>
**Opened at:** <ISO 8601 timestamp>
```

Use the **Edit** tool on `$SESSION_FILE` (the worktree path) to:

1. Append the `## Task <TASK_NUM>:` block before the `**Next Steps:**` section near the bottom.
2. Update the frontmatter `pr_numbers:` list to append `<PR_NUMBER>`. Example: `pr_numbers: [42, 43]`.

Then commit + push using `git -C` to target the worktree directory (no `cd` — shell state doesn't persist between Bash calls, and a stray `cd` that fails leaves the next command running in the wrong tree):

```
git -C .sessions-worktree add sessions/$(basename "$SESSION_FILE")
git -C .sessions-worktree commit -m "Session <N> — log Task <TASK_NUM> (PR #<PR_NUMBER>)"
git -C .sessions-worktree push origin sessions
git -C .sessions-worktree checkout sessions 2>/dev/null || true
```

The final `checkout sessions` re-pins the worktree HEAD to the `sessions` branch — guards against a detached-HEAD state if anything upstream rewrote history.

The user's main checkout never moves; the task branch stays clean (no session-file pollution).

## Step 6 — Surface to the user

```
Task <TASK_NUM> shipped.
PR: <PR_URL>
Code review: <one-line summary>

Next: keep working in this session (cut another branch + `/kill-this` again), or run `/its-dead` to close the session.
```

If `EXISTING_PR_STATE` was `OPEN` and Step 4.2 was skipped, surface the existing PR URL and note that the task block now references the pre-existing PR.

## Notes

- **No time math, no version bump, no CHANGELOG.** All deferred to `/retro` per DEC-S013. This skill ships a task and logs it; that's it.
- **Branch ownership.** Code commits go to the current task branch. Session-file commits go to the sessions branch via the worktree. Two completely separate timelines.
- **Multiple PRs per session is normal.** Each `/kill-this` appends a `## Task <N>` block; the `pr_numbers:` list grows. `/retro` reads this list to enumerate the PRs to query for merge timestamps.
- **Merge ordering is free.** The user can merge each PR whenever — before the next `/kill-this`, after `/its-dead`, days later. Retro reads GitHub at retro time and gets the merge timestamps regardless.
- **Atomicity at `/its-dead`.** Once `/its-dead` writes `status: closed`, the session file is never modified again. `/retro` reads it but only writes to `RETROSPECTIVES.md` and (on dev projects) to `package.json` / `CHANGELOG.md` / git tags.
