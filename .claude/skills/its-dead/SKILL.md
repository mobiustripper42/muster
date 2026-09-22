---
name: its-dead
description: Session end. Stamps `ended:` on the open session file, tallies total points from per-task blocks, displays wall_clock to screen for gut-check, commits + pushes the sessions branch. No time math, no version bump, no merge handshake — those moved to `/retro`. Run once at the end of a Claude window after every task's `/kill-this` has shipped its PR.
tools: Read, Edit, Write, Bash, Glob, Grep
---

You are closing the session. This is a one-action skill: stamp `ended:`, write `status: closed`, commit + push to the orphan `sessions` branch. All time math (wall_clock and active = wall_clock − breaks, via transcript break inference) and version bumps moved to `/retro`. The session file becomes atomic — never modified after this runs.

## Step 0 — Locate the open session (on the sessions worktree)

```
grep -l "^status: open" .sessions-worktree/sessions/*.md 2>/dev/null
```

**Exactly one match:** that's `SESSION_FILE`. NEW MODE. Continue.

**No match:** STOP and ask the user how to proceed. Do not invent a session file — `/its-alive` creates it, and its absence means the session was never opened.

**More than one match:** another window has a session open. Report the candidates — `session:`, `branch:`, `started:` — and ask which is yours. Do not sort and do not take the first: `... | head -1` returns the lexically-earliest filename, and session filenames start with a date, so it silently picks the *stale* file whenever that one opened earlier. Nothing errors.

Leave the other file alone. Its `ended:` is not knowable from here, and a guess poisons `/retro`'s input more quietly than a blank does. Say in the closing summary that it is still open.

## Step 1 — Stamp `ended:`

```
END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Edit `$SESSION_FILE` frontmatter:
- `ended: <END_UTC>`
- `status: closed`

Do **not** write `wall_clock`, `active`, `breaks`, `duration`, or any time-derived field. Time math is `/retro`'s job.

## Step 2 — Tally total points

Scan the body for the per-task `**Points:**` field (`/kill-this` writes one per task):

```
grep -oE "^\*\*Points:\*\* *[0-9]+" "$SESSION_FILE" | grep -oE "[0-9]+"
```

Sum and write the total into the frontmatter:
- `points: <SUM>`

**No `-A <N>` window, and that is the fix, not a simplification.** This step used to read `grep -A 5 "^## Task " | grep "Points:"`, which assumes `**Points:**` sits within five lines of its `## Task` heading. It does not: `/kill-this`'s own block template puts the open-ended `**Completed:**` bullet list first (`kill-this/SKILL.md` § Step 5), so in one observed session the four real gaps were 61, 55, 52 and 53 lines. The windowed command matched nothing and returned `points: 0`. `^\*\*Points:\*\*` is anchored and unique to that template, so it needs no window to avoid a false match.

**Cross-check the count before you write.** The number of matches must equal the number of `## Task <N>` blocks:

```
grep -c "^## Task " "$SESSION_FILE"
```

If the two disagree, stop and say so rather than writing a sum. This is here because a wrong number cannot be corrected later: `/its-dead` writes `points:` into a file that is atomic the moment it closes, and `/retro` reads it as the phase's real cost.

If no `## Task <N>` blocks exist (a session that ran `/its-alive` and `/its-dead` with no `/kill-this` in between), `points: 0`. No warning — sometimes the work is exploration that didn't ship. **Zero task blocks and zero points is a fact; task blocks with zero points is a bug** — the two used to produce identical output, which is why the undercount was silent.

## Step 3 — Append session-wide Context (optional)

If the user wants to add session-wide Next Steps or Context notes that aren't per-task, prompt them — as plain lines, not fenced:

> Anything to add to **Next Steps** (what to pick up next session)?
> Anything for **Context** (gotchas, patterns, hidden constraints)?

Append to the existing `**Next Steps:**` and `**Context:**` sections at the bottom of the file. These sections cover the session as a whole; per-task notes live inside their own `## Task <N>` block.

## Step 4 — Display wall_clock to screen (gut-check only — NOT persisted)

Compute on screen for the user's sanity check:

```
WALL_CLOCK = (END_UTC − started) in hours, rounded to nearest 0.083h (5 min).
```

Emit as plain prose lines, never fenced; drop the leading `>`, it marks the example:

> Wall clock: Xh Ym  (started <ISO_STARTED>, ended <END_UTC>)
> PRs this session: #N1, #N2, ...   (from pr_numbers list)
> Total points: <SUM>

**Do not write this to the file.** The user verifies; `/retro` computes the persisted numbers at phase end.

If the wall_clock looks wildly wrong (e.g. user expected 2h, sees 9h because of an overnight gap), the user can record a note in the Context section. The actual active time will be inferred at retro (wall_clock minus transcript break gaps); the displayed wall_clock is just the raw delta.

## Step 4.5 — PRs opened outside `/kill-this` (the review that didn't run)

A PR opened by hand-typed `gh pr create` never passed `/kill-this` Step 3, so `@code-review` never ran on it. Nothing else in the workflow notices: the code is on a branch, the PR looks normal, and the only missing artifact is a review that was never going to announce its own absence.

List the PRs this session actually produced and compare against the frontmatter:

```
gh pr list --author @me --state all --limit 30 --json number,createdAt,headRefName
```

Keep the ones created at or after the session's `started:` stamp. Any of those **not** in `pr_numbers:` was shipped by hand.

For each, display as plain lines, not fenced:

> ⚠ PR #N (<branch>) was opened outside /kill-this — @code-review never ran on it.
>   Review before merging: @code-review against `gh pr diff N`.

Report only. Don't open the review yourself and don't backfill a `## Task` block for it — the user decides whether the PR is worth a retrospective pass. If every session PR is in `pr_numbers:`, say nothing.

## Step 4.8 — Declare the tape's name

```
mkdir -p ~/.claude/tape/.names
REPO=$(basename "$(git rev-parse --show-toplevel)" | LC_ALL=C tr '[:upper:]' '[:lower:]' \
  | LC_ALL=C sed 's/[^a-z0-9.-]/-/g; s/-\{2,\}/-/g; s/\.\{2,\}/./g' \
  | LC_ALL=C cut -c1-32 \
  | LC_ALL=C sed 's/^[-.]*//; s/[-.]*$//')
echo "${REPO:+$REPO-}$(basename "$SESSION_FILE" .md)" > ~/.claude/tape/.names/$CLAUDE_CODE_SESSION_ID
```

No output to report. If `$CLAUDE_CODE_SESSION_ID` is empty, skip it silently — the tape still gets kept, named by uuid.

**The repo prefix is the point.** `~/.claude/tape/` is one flat directory every repo on this machine writes into, and a session file's name carries only the date and the slug. A jig session and a tinkle session both on `main` produce the same `YYYY-MM-DD-HHMM-main`, distinguishable only if they happened to open in different minutes. The session *file* has no such problem — it lives inside its own repo — so the tape is the only place that needs this.

**Prefix rather than infix**, so the directory groups by project and stays chronological within each. **In a linked worktree** `--show-toplevel` returns the worktree path, so two lanes get distinct names; that is correct, not a bug.

**The `sed` is not decoration.** `keep-tape.mjs` REFUSES a declared name that isn't a plain filename (`PLAIN` at `<jig>/scripts/keep-tape.mjs:56`, where `<jig>` is the jig checkout as `/its-alive` resolved it) and falls back to the uuid — so an unsanitised folder name with a space or a `..` in it would make the tape name *worse* than the no-prefix version it replaces. `${REPO:+$REPO-}` drops the prefix entirely when a folder name sanitises to nothing, rather than emitting a leading `-` that `PLAIN` would also refuse.

**`LC_ALL=C` is what makes the character class mean ASCII.** Under a UTF-8 locale — `en_US.UTF-8`, the default on this machine and on GitHub Actions — glibc collation makes `[^a-z0-9.-]` match by collation rather than by byte, and accented letters pass straight through: a folder named `café` sanitises to `café`, raw multi-byte bytes intact, which `PLAIN` then refuses. That is precisely the uuid fallback this step exists to avoid, reintroduced for every non-English folder name. Byte-literal is the only behaviour that is the same everywhere, so all three stages are pinned.

**`cut -c1-32` caps the prefix**, and trimming the edges runs *after* it rather than before. A long folder name plus the session stem can pass the filesystem's 255-byte limit, and the failure lands inside the hook as a caught copy error — a lost tape, logged, with nothing on screen. Thirty-two characters is past every real repo name here. Cutting last would leave a name that had been trimmed and then re-grew a trailing `-` or `.` at the cut point, which `PLAIN` accepts and nobody would have chosen.

This block is executed by `<jig>/scripts/keep-tape.test.mjs`, which extracts it from this file and runs it in a throwaway repo — so editing it here is covered, and a change that breaks the naming fails the suite.

**What this is for.** Claude Code deletes transcripts on a rolling window, so a `SessionEnd` hook (`<jig>/scripts/keep-tape.mjs`) copies this session's `.jsonl` to `~/.claude/tape/`. The hook is handed its own `transcript_path` and knows the uuid; it does **not** know this session file's name. This step is the only place both are known, so it writes the one down for the other to find.

**Why the copy isn't done here.** This skill runs *before* the session ends. The transcript is still being appended to, so a copy taken now loses every turn after it — including the closing summary. The hook fires at the right moment and reads the name left for it.

**Nothing reads the tape automatically.** No skill, no agent, no index, no drain. A human opens one in a chat session occasionally. Do not offer to read it, summarize it, or build anything that does.

If the hook isn't installed on this machine the name file is simply never consumed, and `/its-alive` Step 7.6's policy check is what tells you — `settings-policy.mjs` reports the hook absent.

## Step 5 — Commit + push the sessions branch (from the worktree)

```
git -C .sessions-worktree add sessions/$(basename "$SESSION_FILE")
git -C .sessions-worktree commit -m "Close Session <N>"
git -C .sessions-worktree push origin sessions
```

No version bump. No CHANGELOG. No tag. No branch cleanup (task branches and their PRs are managed by the user per-task at `/kill-this` time and via the GitHub merge button).

## Step 6 — Closing summary

Emit as plain prose lines, never fenced; drop the leading `>`, it marks the example:

> Session <N> closed.
> Wall clock (raw): Xh Ym       <- gut-check only, not persisted
> PRs: #N1, #N2, ...            <- still need merging if any are still OPEN
> Points (per-task sum): <S>
>
> The session file is now atomic — no further writes will modify it.
> Time math (active = wall_clock − breaks, via break inference) + version bump will run at /retro.

If any `pr_numbers` PR is still OPEN, append the line:

> ⚠ PRs still OPEN: #N1, #N2. Merge them whenever — order and timing don't matter for retro math.

If on a phase-rituals project, append:
```
Phase progress: gh issue list --label phase:current --state open
```

## Notes

- Sanity check at close: the displayed wall_clock is `ended − started`. If it includes overnight or away-from-desk time, that's correct — `/retro` will subtract break gaps later. The screen number isn't the final number.
- No interactive merge handshake (an earlier version had one). The user merges PRs whenever convenient — before `/its-dead`, after, doesn't matter. Retro reads GitHub for merge timestamps at retro time.
- Atomicity guarantee: once `status: closed` is set and the file is pushed, this skill is done. No subsequent skill modifies this file. `/its-alive`'s old Step 7.5 backfill is gone.
