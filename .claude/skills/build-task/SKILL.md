---
name: build-task
description: Build a specced task through @test-writer and @implementer instead of coding it in the session. For any task that changes behavior and has a criterion the Proof slot can check, whatever its points, once the spec has been walked with the operator from this skill's task-spec.md and the branch is cut; Step 0 writes the spec into the issue. Replaces the prove / build / run-the-proof steps and ends by running /kill-this.
---

You are the Lead. You do not write production code or tests in this skill. You check the spec, hand
work to two agents, verify what they return, and ship. Every check below is one you run yourself —
an agent's report that something passed is a claim, not a result.

**The operator running this skill is the approval of the spec.** The spec was worked through
with the operator from `task-spec.md` (beside this file) before now: the summary first, then the
job and acceptance criteria, then the `[Lead]` lines. Step 0 writes it into the issue; the
operator does not. Do not present it again. From here the run goes to the pull request,
stopping only where information turns out to be missing.

## Step 0 — Gate

Abort with a one-line reason if any of these fail:

- **Testable.** The line between the two loops, whatever the points. At least one acceptance
  criterion is something the `Proof` slot can check — behavior, data, or on-screen wording and
  order. A task that is only layout, spacing or styling
  has nothing for `@test-writer` to assert: use the normal loop, with `@ui-reviewer` and a
  screenshot at the hand-back.
- **Branch.** You are on `task/X.Y-*` or `task/<issue>-*`, not `main`.
- **Proof slot.** `.claude/CLAUDE-context.md` § Workflow Mechanisms names a real `Proof` and
  `Proof command`. If it says `none`, there is nothing to write tests in — use the normal loop.
- **Spec.** Decide by the issue body, not by memory of the conversation. If the body already has
  every section heading in `task-spec.md`, it is the spec — an earlier run's, with its `[code]`,
  `[Lead]` and `[you]` lines, or one written by hand: write nothing. A spec already in the issue is
  changed by editing it there, never by re-writing it from the conversation. Otherwise write the
  spec the operator walked in this conversation, in this order:
  1. Every section was settled in the walk. If one was not, or there was no walk, abort naming
     what is missing, with the issue untouched.
  2. Write the body file in the scratchpad.
  3. If the body holds anything — the request the issue was filed with — post it as an issue
     comment, so it is kept and the agents, who read only the body, never take it for the spec.
  4. `gh issue edit <N> --body-file <file>`. If it fails, stop. Print the issue's link.

  Then read the body back with `gh issue view <N>`: every section in `task-spec.md` is present
  and non-empty, and `Open questions` is empty. "None" is an answer; blank is not.

The issue body is the spec. Agents are pointed at it by number. Never paraphrase it into a prompt.
The one exception is a second readback round, whose prompt names the lines that changed.

When the gate passes, run `date -u +%Y-%m-%dT%H:%M:%SZ` and keep the time it prints: it is where
Step 6's cost starts counting.

Shell variables do not survive between calls. Every value this skill names — the time, `START`,
`TESTS`, `REF` and the test files — is kept in the conversation, and a command written with `$NAME`
takes the value as printed.

Keep what `git rev-parse HEAD` prints as `START`. Then, if `git status --porcelain` lists anything —
work already in the tree before this run, such as a staged rename or an edit the operator made —
commit it on its own: `git add -A`, name in one line the files `git diff --cached --name-only`
lists, then `git commit -m "build-task: work already in the tree (squashed at ship)"`. It ships with
the task but is not the build. Committed, it is out of reach of the test lock and of every stash
below, which would otherwise take it with the build and delete it. Step 5 folds it back in; a run
abandoned before then leaves it as a commit on the branch.

## Step 1 — Readback

Spawn `@test-writer` with: the issue number, and the instruction **readback only — write nothing.**

It returns five sections: **Assumptions** (things it would have to decide that the spec does
not), **Questions**, an **Interface check**, a **Reuse check** (existing code that already
does something the spec would build, and anything the spec describes in more than one place
without naming one shared home for it), and a **Removal check** (every test that uses something
the spec removes or renames). An Interfaces entry reported NOT FOUND and not marked new
is a question. If Assumptions, Questions and the Reuse check are empty, and the Removal check is
`None` or holds only `used by no test`, go to Step 2.

Sort each item, and write every one you accept into the section of the issue it belongs to
(`gh issue edit <N> --body-file`). An answer that lives only in this conversation is invisible to
both agents, and comes back as the same item next round.

- **The code settles it** — a `[code]` line with the path. Keep going.
- **The Lead can settle it** — test design, or malformed input that defaults to what the existing
  code already does. A `[Lead]` line. Keep going. If you can cite the path that settles it, it is
  `[code]`; if not, `[Lead]`.
- **The operator would notice it in use** — stop. Put these to the operator one at a time, each
  with your recommendation. Write each answer as a `[you]` line.

**A reuse match** goes into Reuses as a `[code]` line with the existing path — a Screen match onto that
element's line in Screen, as its component. Then the spec stops asking for the copy: the
criterion that restated it is reworded to point at it, its "New or changed signatures" entry is
removed, and "Files touched" gains the existing file if reuse means exporting from it. When
reusing it would change behaviour — the existing rule differs from the spec's — sort it as a
`[you]` item above, with your recommendation. A match you reject is one `[Lead]` line saying why.

**Something described twice with no shared home** gets one: a `[Lead]` line under Interfaces' "New
or changed signatures" naming the CSS class, component, function or constant that holds it, marked
new, with its file added to "Files touched". A CSS class is not a signature and gets no stub. Each
place that described it is reworded to point at that home. When the places describe it differently,
choosing one changes what a criterion does: sort it as a `[you]` item above, with your
recommendation.

**A test that uses something removed** goes onto Interfaces' Removes line, with its file added to
"Files touched", saying what happens to it. When the behaviour it checks goes away with the removed
thing, it is deleted: a `[code]` line citing the criterion or Removes entry that takes the
behaviour away. When the behaviour survives under what replaces it, it is retargeted: a `[code]`
line naming the replacement. When the spec does not say whether the behaviour survives, sort it as
a `[you]` item above, with your recommendation. A removal changes what that test checks, not what
a criterion does, so it earns no second round on its own.

Keep every `[code]` and `[Lead]` line, word for word, for the pull request body (Step 6).

**Rounds.** One round by default. Run a second only when round 1 changed what an acceptance
criterion does — a criterion's text, or a `[code]`/`[Lead]` line that adds behaviour no criterion
states — and name the changed lines in its prompt. A reuse match counts only when reusing changes
what a criterion does (the `[you]` case above); rewording a criterion to point at existing code,
or adding a Reuses path, does not. Naming a shared home, and rewording the places to point at it,
does not either. **If round 2 changes behaviour again, stop and ask** — the spec needs rework, not
a third read. An edit that only clarifies wording does not earn
another round; `@test-writer` can still stop in Step 2 and return a question.

**Coming back to the spec later counts against the same rule.** A question from Step 2 is sorted
as above and written into the issue. It earns a readback round only if it changed behaviour, and
that round is the second: if one has already run, stop and ask. A Stop from Step 3 ends the run
instead; what comes back after it is the operator's call.

## Step 2 — Tests

Spawn `@test-writer` with: the issue number, and the instruction **write the tests.**

It returns one of three things:

- **A question** — the spec forced a guess. Sort it as in Step 1 and write the answer into the
  issue, then re-run readback only as Step 1's Rounds rule allows.
- **A stub report** — a stub would force a test to bend: edit an existing test, or work around
  what the stub cannot provide. Bring it to the operator with your recommendation; do not let
  `@test-writer` bend the test to get past it.
- **The tests** — the files it created, edited or deleted (tests, fixtures, helpers), the stubs it wrote, a
  map of acceptance criterion → test names, and how each test fares against the stubs.

**Why stubs.** A red test proves something only when it fails on its own assertion: that failure is
what shows it can catch the bug it is named for. When every test fails because the module doesn't
exist, the run proves only that the module is missing — a test asserting nothing fails the same
way. So `@test-writer` also writes stubs: the names and signatures Interfaces gives, with empty
bodies, so every test runs and is seen failing for its own reason before any code exists. This is
not the one-test-at-a-time loop: that loop pays for a person discovering a design as they go, and
here the spec has already settled it.

Check, in order:

1. **Coverage both ways.** Every acceptance criterion has at least one test, except one marked
   `(by hand)`, which is checked at the hand-back instead. Every test names the criterion it
   covers. A gap either way goes back to `@test-writer`. A test file that existed before this run
   and appears in its Files list: read `git diff "$START" -- <file>`. Tests added to it, with the
   imports and helpers they need, are new tests, not an edit — but only in a file Interfaces'
   Files touched names; added anywhere else goes back to `@test-writer`. A change to an existing
   test's name or body is an edit, and that is a stub report, not a test — unless Interfaces'
   Removes line lists it, and the edit is the deletion or retarget that line names. A retargeted
   test keeps its own name, with no criterion id, and is exempt from the naming rule and from
   check 2: it guards behaviour that already exists, so it may pass against the stubs.
2. **Fails for the right reason.** Run the `Proof command` yourself, against the stubs. Each test
   must fail on its own assertion — a wrong value, a missing row, a call that didn't throw — not on
   a missing file or function, a typo, a bad import path, or broken setup. The one exception is a
   column or table this task creates, which no stub can provide: "does not exist" is its right
   reason, when the report marks it new in this task. A test that passes
   against the stubs is accepted only beside the failing partner the report names, the test that
   proves the behaviour it guards. Anything else goes back to `@test-writer`.
3. **Lock the tests.** Commit every file `@test-writer` created, edited or deleted, except the stubs, on its
   own: `git add <files>` then `git commit -m "build-task: tests (squashed at ship)"`. Record
   `TESTS=$(git rev-parse HEAD)`, and keep the test files: every file a `@test-writer` report in
   this run lists under Files. The commit is the lock: it holds the original bytes, so a
   violation can be undone, and `git diff` against it needs no working directory. Step 5 folds it
   back into one commit before `/kill-this`, so `@code-review` still sees the tests. The stubs stay
   in the tree, uncommitted: they are production files, and `@implementer` replaces them.

## Step 3 — Implement

Spawn `@implementer` with: the issue number, the test file list, the stub list, and the failing
output from Step 2.

It returns one of:

- **Done** — a summary of what changed. Go to Step 4.
- **Stop** — a test it believes is wrong, and why. Do not let it work around the test. Set the
  build aside and keep it: `git stash push --include-untracked -m "build-task <N>: build"`. Find it
  by its message, which prints its ref, `REF` (nothing printed means the build changed nothing):
  `git stash list --format='%gd %s' | grep -F ': build-task <N>: build' | cut -d' ' -f1`. Then
  write `git stash show -p --binary --include-untracked "$REF"` into a patch file in the scratchpad,
  as a backup. Never show, apply or drop a bare `git stash`: `stash@{0}` may be the operator's.
  Then stop, and bring the Stop to the operator with the stash's ref, the patch's path and
  `START`. They decide whether the spec or the test was wrong, how it is fixed, and whether the
  build comes back. A Stop is not a failed round. A run started again after it keeps this run's
  `START`, so Step 5 still folds the earlier commits in. When they rule a test wrong, the fix goes
  to `@test-writer` with their ruling as its brief and the stub list, saying the stubs went into
  the stash with the build: it fixes that test and writes the stubs again. Step 2's checks 1 to 3
  run on what it returns; the Lead commits it, that commit is the new `TESTS`, and any file it
  lists joins the test files. If the build comes back, first put each stub file back as `HEAD`
  has it (`git checkout HEAD -- <file>`, or delete one `HEAD` lacks), then `git stash apply
  "$REF"`. Then Step 3 again. A test the Lead fixes by hand is never locked, and Step 4 then reads
  it as a violation.

## Step 4 — Verify

1. `git diff --quiet "$TESTS" -- <the test files>` — any change to a test file fails the task.
   The list is kept, not read from the `TESTS` commit, because after Step 5's fold a review
   route's `TESTS` commit holds only its own new test. Set the implementation aside with
   `git stash push --include-untracked -m "build-task <N>: violation"` (the tests come back as
   committed; the stubs go with the implementation), find its `REF` by that message as Step 3 does, then
   `git stash drop "$REF"`, and re-run Step 3 once, telling `@implementer` the stubs are gone
   and giving no stub list. A second violation: stop and tell the operator.
2. Run the `Proof command` yourself. Green, or back to Step 3 with the failure output.
3. Read `@implementer`'s "Stubs left as stubs". Anything but `None` is an empty function that no
   test needed and would ship as a silent no-op: remove it, or bring it to the operator.

**Two failed `@implementer` rounds on the same tests: stop and ask.** Something is wrong with the
spec, the tests, or the task's size, and a third round is spending the allowance to find out
which.

## Step 5 — Ship

First `git reset --soft "$START"`, so the work already in the tree, the tests and the code ship as
one commit and `/kill-this`'s `git diff HEAD~1` shows all three. This is the only reset: by the
time a review route runs, `/kill-this` has pushed that commit, and folding again would rewrite a
pushed branch (seen in Haul). A route's test commit and its fix commit ship as commits of their
own on top. Then run `/kill-this`. When it reaches code-review findings, route each one:

| Finding | Goes to |
|---|---|
| Real bug a test should have caught | `@test-writer` (new test, no stubs, in the test file the Lead's brief names — it must fail against the current code on its own assertion; the Lead commits it on its own; `TESTS` is that commit, and its file joins the test files), then `@implementer` |
| Real bug, tests are fine | fresh `@implementer`, finding as its brief |
| One-line cleanup, naming, a constant | fix it yourself |
| Architectural | escalate to `@architect`, as `@code-review` already says |

After any fix: Step 4 again, then let `/kill-this` open the pull request.

## Step 6 — Receipt

Print it every time, before the hand-back, and append it to the pull request body under
`## /build-task receipt` (`gh pr edit <PR> --body-file`), so it outlives the conversation:

```
/build-task receipt — issue #<N>
  readback      — <rounds>, <questions asked>
  settled       — none | <n>, word for word in the pull request body
  removals      — none | each removed thing the Removal check searched, with its tests or "used by no test"
  test-writer   — <tests> tests across <criteria> criteria
  stubs         — <n> written, <n> left as stubs, <n> tests passing beside a partner
  implementer   — <rounds> rounds, <stops> stops (a run started again after a Stop counts it)
  test lock     — intact | violated (<file>)
  review routes — <n> to test-writer, <n> to implementer, <n> fixed by Lead
  cost          — <cost.mjs>
```

Write every line but the cost, after `/kill-this` has opened the pull request, into a file in the
scratchpad, keeping the cost line exactly as the template has it. Then, from the repo root, with
the time Step 0 printed:

    node .claude/skills/build-task/cost.mjs --since <time> --receipt <file> 2>/dev/null || echo "unavailable — cost.mjs did not run"

It reads this session's transcripts and writes the output tokens each role wrote and the active
minutes, which include short waits on the operator but not long ones, into the file in place of
`<cost.mjs>`. Never type or reshape those lines: in Haul they were retyped in four shapes, and the
receipts could not be compared. Whatever it writes stays, `unavailable — <why>` included, and the
run carries on. If it printed the `echo` line, it never ran: put that line where `<cost.mjs>` was.
If it printed `no receipt file at`, `could not write receipt` or `no cost placeholder`, fix the file
and run it again; once more failing, the cost line is `unavailable — <what it printed>`. The new
body for `gh pr edit` is the current body, then `## /build-task receipt`, then that file, then,
unless `settled` is none, `### Settled, word for word` with each `[code]` and `[Lead]` line added
during the run, one per line; print the file as the receipt.

The receipt is also what this workflow spent, in a shape the old loop's session file can be
compared against. `settled` is the operator's audit of the calls made without them — every
`[Lead]` line, and a judgment call filed as `[code]`, shows up there. The lines go in the pull
request body and not the printed receipt because in Haul the block ran long and hand-backs
summarised it, and a summary of a call made without the operator is not an audit of it. The
hand-back links to that section instead of restating it.
