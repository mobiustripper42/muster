---
name: save-this
description: Between tasks, right before /clear. Writes what this conversation knows and the files don't — the next task, open pull requests, standing rules, the parking lot, and what the next task needs from this one — into the open session file's Next Steps, then commits and pushes the sessions branch. The cleared context reads it back.
tools: Read, Edit, Bash, Glob, Grep
---

You are saving what a `/clear` would lose. The plan holds which task is next; it does not hold what came up while working — deferred forks, follow-ups, rules in force, what the last task left behind for the next. That exists only in this conversation until this skill writes it down.

The loop it serves, per window: `/its-alive` once, then per task — spec, build, `/kill-this`, merge, **`/save-this`**, `/clear` — and `/its-dead` once at the end.

## Step 0 — Locate the session file

```
grep -l "^status: open" .sessions-worktree/sessions/*.md 2>/dev/null
```

**Exactly one match:** that is the session file.

**No match:** stop. There is no open session; tell the user to run `/its-alive`.

**More than one match:** narrow by checkout before asking. `/its-alive` records the transcript path, and that path is built from the directory the session was opened in (`/its-alive`'s transcript-path step), so it names the checkout:

```
HERE="$HOME/.claude/projects/$(pwd | tr '/' '-')/"
grep -lF "transcript: $HERE" <each open file>
```

The trailing `/` is what keeps `~/muster` from matching `~/muster-s91`'s sessions. **Exactly one file left:** that is yours. Two lanes in two checkouts settle here without a question, which is the whole point — a window that began with `/clear` has no memory of which file it opened. **Zero or several left** (two windows in one checkout, or a file opened with no transcript path): report each candidate's `session:`, `branch:` and `started:`, and ask. Never take the first match — filenames start with a date, so `head -1` picks the oldest, and nothing errors.

## Step 1 — Gather what is true now

Read the file first. If Next Steps already holds a save, it is the starting point for every list below — not memory.

- **Next task:** what the user said comes next. If they did not say, name the one you'd do next and mark it proposed — from the previous save's Next task, the open phase's issues, or what this conversation pointed at — so the user corrects it before /clear instead of the next context starting blind. "Not named" only when there is no reasonable candidate.
- **Open pull requests:** for each number in the frontmatter's `pr_numbers:`, check its state (`gh pr view <N> --json state,statusCheckRollup,reviewDecision`). List only the ones still open, each with its CI state and any review waiting. Then one line: "The rest of `pr_numbers` is merged." Do not list merged pull requests one by one.
- **Standing rules:** constraints in force until something ends them — "nothing to production until Phase 16 ends", "issue #1080 goes last". Not parking-lot items: nobody closes them, so they do not belong under a seven-item cap. Carry every rule from the previous save **word for word**, add any the user set in this conversation, and drop one only when the user retired it or its own end condition has been met — say which, in the reply.
- **Parking lot:** start from the previous save's parking lot. Keep every item the user did not close in this conversation, then add the new items this conversation raised, in order, one line each. **An item leaves only when the user closed it.** A context that lost track of a thread must not be able to delete it by saving. Standing rules never go here.
- **Carry-over:** at most three lines of what the next task needs from this one and cannot get from the plan, the issue or the code — a component just built that the next task reuses, a gotcha found, a decision made mid-task. Tasks in a phase are rarely independent; this is the part of a summary worth keeping. Replaced each save, not accumulated. "None" is an answer.

## Step 2 — Replace Next Steps

Replace **everything after the line that is exactly `**Next Steps:**`, up to but not including the line that is exactly `**Context:**`** — whole lines with nothing else on them, so a note that quotes either heading cannot move the boundary. If there is no `**Context:**` line, replace to the end of the file. If either heading appears as a whole line more than once, stop and say so rather than guess. Leave the frontmatter, every `## Task` block and the Context section untouched.

A replace, not an append: Next Steps always says what is open now. The section's shape:

```
**Next Steps:**

_Saved <ISO 8601 timestamp> by /save-this._

**Next task:** <named task, or "<task> (proposed)", or "Not named">

**Open pull requests:**
- PR #<N> — <title> — CI <green / red: check name / pending> — <review state>
- The rest of `pr_numbers` is merged.

**Standing rules:**
- <rule, word for word, with its end condition>

**Parking lot:**
1. <item>
2. <item>

**Carry-over:**
- <what the next task needs from this one>
```

Write `**Open pull requests:** none — every pull request in `pr_numbers` is merged.`, `**Standing rules:** none.`, `**Parking lot:** nothing.` and `**Carry-over:** none.` when those are empty. An absent heading is indistinguishable from a forgotten one.

## Step 3 — Commit and push the sessions branch

```
git -C .sessions-worktree add sessions/<file>.md
git -C .sessions-worktree commit -m "Session <N> — save before clear"
git -C .sessions-worktree push origin sessions
git -C .sessions-worktree checkout sessions 2>/dev/null || true
```

`git -C`, never `cd`. Invoking this skill approves this push and no other.

## Step 4 — Tell the user

Say that it is saved and safe to `/clear`, name the next task if there is one — saying so when it is proposed, so the user can correct it before `/clear` — and name any standing rule dropped and why. The reply keeps its usual shape; the parking lot can print after as usual.

You cannot run `/clear`. It is a built-in command, and only the user types it.

## The other half — reading it back

A save nothing reads is worse than none, and `CLAUDE.md`'s spec step says what reads it: a fresh context starts by reading the open session file's Next Steps (found the same way as above). **Reading restores:** the saved parking lot becomes the conversation's parking lot again — open threads carried across the clear, not a copy to drop because the file has them. Standing rules and carry-over stay in the file and are obeyed from there; the next save carries them on.
