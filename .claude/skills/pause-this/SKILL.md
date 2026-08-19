---
name: pause-this
description: Mid-session pause. Checks the build, commits WIP, and notes the pause point in the session file. Use when you need to walk away mid-task without closing the session. Follow up with /restart-this to resume.
tools: Read, Edit, Write, Bash, Glob, Grep
---

You are executing a mid-session pause.

## Step 0 — Locate the open session

```
grep -l "^status: open" .sessions-worktree/sessions/*.md 2>/dev/null
```

**Exactly one match:** that's `SESSION_FILE`. NEW MODE — pause note goes in its Context section (on the sessions branch).

**No match:** check `session-log.md` for `[open]` — LEGACY MODE, pause note goes there.

**More than one match — stop and ask, every time.** Two open files means a session somewhere never reached its own `/its-dead`, or two windows are genuinely running concurrently, which `/its-alive` Step 3 supports. **List the candidates with their `session:`, `branch:` and `started:` and let the user pick.**

Do not try to identify the right one from inside the session. There is no reliable way: the obvious candidate, matching `transcript:`, requires the running session to know its own JSONL path, and it cannot — `/its-alive` Step 5 derives it by globbing the project directory and taking the newest file, which is a guess that is *wrong* in exactly the case that matters, two concurrent windows writing to the same directory. An instruction that cannot be followed is worse than a bad default, because it reads as solved.

Do not sort, and do not take the first. `... | head -1` returns the lexically-earliest filename, and session filenames start with a date, so on the exact input this guard exists for it silently selects the **stale** file. Nothing errors: `head -1` always returns something.

**The wrong-tree check goes in Step 2, not here.** This skill commits WIP, and `git branch --show-current` resolves against the current directory rather than the session — `/its-alive` Step 3 offers a linked worktree for a concurrent session, so the two can legitimately differ. Do **not** prompt on a branch mismatch: a session opens on `main` and its work is cut onto branches, so that fires every run and becomes noise. If Step 2 finds **nothing to commit**, that is the ambiguous case — "already committed" and "the WIP is in another tree" look identical from here. See Step 2 for what to do about it.

## Step 1 — Build check (conditional)

Look up the project's build check in `.claude/CLAUDE-context.md §Commands`, **with the Read tool** — never a `sed`/`grep` one-liner. Run whatever is defined (e.g. `npm run build`, `cargo build`, `make`). If `.claude/CLAUDE-context.md §Commands` defines no build step, skip silently.

If the build fails: do NOT commit broken code. If you can't fix quickly, note the errors in the pause entry so the next sitting knows where to start.

## Step 2 — Commit WIP on the task branch

```
git add -A
git commit -m "WIP [phase/task] — [brief description of where things stand]"
```

Prefix with `WIP`. This commit goes to the **current task branch** — NOT to the sessions branch.

**Name the files being staged**, one line from `git diff --cached --name-only`. It is the only moment a wrong-tree commit is visible to a person, and it costs a sentence.

**If there is nothing to commit, check the other trees before saying "nothing to pause".** An empty stage is ambiguous between "already committed" and "the WIP is in another checkout this skill cannot see" — and walking away believing WIP is safe when it was never committed is the whole failure this skill exists to prevent.

```
git worktree list                                    # every checkout of this repo
git -C <each other worktree path> status --porcelain # is the WIP sitting over there?
```

Compare on **dirtiness**, not on the session file's `branch:` — that field records the branch the session opened on, usually `main`, which the primary checkout is usually on too, so it cannot locate the right tree. If another worktree is dirty, say which one and stop. If they are all clean, report the no-op normally.

## Step 3 — Note the pause in the session file (sessions branch)

Append a pause line to the session file's `**Context:**` section:

```
**[PAUSED HH:MM UTC]** Working on: [task]. Left off at: [specific file/function/step]. Next: [exactly what to do when resuming].
```

Commit + push with `git -C` targeting the worktree — **no `cd`**. Shell state doesn't persist between Bash calls, and a stray `cd` that fails leaves the next command running in the wrong tree. `/kill-this` and `/its-dead` were both moved off this pattern after downstream projects hit it; those backports never reached here.

```
git -C .sessions-worktree add sessions/$(basename "$SESSION_FILE")
git -C .sessions-worktree commit -m "Pause note for Session <N>"
git -C .sessions-worktree push origin sessions
```

Do not close the session. Do not fill `ended:` / `points:`. Status remains `open`.

## Step 4 — Confirm

Tell the user:
- What was committed on the task branch (or that nothing was)
- What the pause note says
- To run `/restart-this` when ready to resume
