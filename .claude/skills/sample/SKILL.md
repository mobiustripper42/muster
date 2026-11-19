---
name: sample
description: Answer the sample a hand-back printed, 2 tests and 1 function a script picked from the pull request. With no arguments, lists the unanswered samples. With answers, marks each one real, waste or can't tell in the session file, discusses every waste and can't-tell mark against the code, records the marks and a Discussion in the task's block, and pushes the sessions branch. Optional, never gates a merge.
---

You are answering the hand-back sample (DEC-J032). The sample is 2 tests and 1 function that
`.claude/skills/sample/sample.mjs pick` chose, from the lines the pull request changed, so the
operator reads something the builder did not choose. Answering is strongly suggested and never
required, and nothing here blocks a merge.

Invoking `/sample` approves the push of the `sessions` branch in Step 4 (DEC-J002).

The script owns the line format, the marks and the two questions. This file points at it rather
than restating it: `list` prints each sample with its question, and `mark` rejects anything but the
three marks. Its tests are `<jig>/scripts/sample.test.mjs`.

## Step 0 — Locate the session file

Find the open session file the way `/kill-this` Step 0 does: `grep -l "^status: open"
.sessions-worktree/sessions/*.md`, narrowed by checkout when more than one matches, never the
first of several. No match: stop, the operator runs `/its-alive` first. Keep the path as
`SESSION_FILE`. This works after a `/clear`: it reads the file, not the conversation.

## Step 1 — List

```
node .claude/skills/sample/sample.mjs list "$SESSION_FILE"
```

**No answers given:** print that output as it stands and stop. `no unanswered samples` is the
whole reply when there are none.

## Step 2 — Read the code behind each waste or can't-tell answer

The operator's answer gives, per number, `real`, `waste` or `can't tell`, and may name a pattern
(`platform guarantee`, `word test`). For every sample answered `waste` or `can't tell`, **before
answering**, read the code the line points at: the test and the code it exercises, and any helper,
column or constant it leans on. The test's name, or the operator's reason, is not the code. The
task block's `**Branch:**` line names where it lives; when that branch is not the one checked
out, read it with `git show <branch>:<path>`.

Then ask the first question, always: **how would this break?** If there is no realistic answer,
the mark is `waste`, whatever the operator said. A `can't tell` that survives the reading stays
`can't tell`. A `real` is not discussed. The operator's reason can be wrong while the instinct is
right; the mark does not depend on the diagnosis.

## Step 3 — Mark

Run `mark` for every sample, **from the highest `n` down**: `n` is the position in `list` at the
moment of the call, so marking the lowest first renumbers the rest.

```
node .claude/skills/sample/sample.mjs mark "$SESSION_FILE" <n> <mark> [pattern]
```

`can't tell` and the pattern each go in as one argument, quoted. The marks are `real`, `waste`
and `can't tell`. A non-zero exit means the script refused: say what it printed, and change
nothing by hand.

## Step 4 — Record the discussion, then push

For each sample discussed in Step 2, add one bullet under that task's `**Sample:**` lines, with the
Edit tool on `$SESSION_FILE`, in the form:

```
**Discussion:**
- `path:line` — <how it would break, or that it would not; the verdict, and the pattern if one was named>
```

One `**Discussion:**` line per task, one bullet per sample. Say so in the bullet when the reading
changed the operator's mark.

Then commit and push the `sessions` branch, with `git -C` as `/kill-this` Step 5 does:

```
git -C .sessions-worktree add sessions/$(basename "$SESSION_FILE")
git -C .sessions-worktree commit -m "Session <N> — sample marks (Task <TASK_NUM>)"
git -C .sessions-worktree push origin sessions
git -C .sessions-worktree checkout sessions 2>/dev/null || true
```

Print the marks as written, and any pattern a discussion named. A named pattern is the input to a
by-hand audit of how far it has spread; this skill does not run one.
