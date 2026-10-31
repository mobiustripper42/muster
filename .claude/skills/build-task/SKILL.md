---
name: build-task
description: Build a specced task through @test-writer and @implementer instead of coding it in the session. For any task that changes behavior and has a criterion the Proof slot can check, whatever its points, once the spec is written into the issue from this skill's task-spec.md and the branch is cut. Replaces the prove / build / run-the-proof steps and ends by running /kill-this.
---

You are the Lead. You do not write production code or tests in this skill. You check the spec, hand
work to two agents, verify what they return, and ship. Every check below is one you run yourself —
an agent's report that something passed is a claim, not a result.

**The operator running this skill is the approval of the spec.** The spec was written into the
issue from `task-spec.md` (beside this file) and worked through with the operator before now:
the summary first, then the job and acceptance criteria, then the `[Lead]` lines. Do not present
it again. From here the run goes to the pull request, stopping only where information turns out
to be missing.

## Step 0 — Gate

Abort with a one-line reason if any of these fail:

- **Testable.** The line between the two loops, whatever the points. At least one acceptance
  criterion is something the `Proof` slot can check — behavior, data, or on-screen wording and
  order. A task that is only layout, spacing or styling
  has nothing for `@test-writer` to assert: use the normal loop, with `@ui-reviewer` and a
  screenshot at the hand-back.
- **Branch.** You are on `task/X.Y-*`, not `main`.
- **Proof slot.** `.claude/CLAUDE-context.md` § Workflow Mechanisms names a real `Proof` and
  `Proof command`. If it says `none`, there is nothing to write tests in — use the normal loop.
- **Spec.** Read the issue body with `gh issue view <N>`. Every section in `task-spec.md` is
  present and non-empty, and `Open questions` is empty. "None" is an answer; blank is not.

The issue body is the spec. Agents are pointed at it by number. Never paraphrase it into a prompt.
The one exception is a second readback round, whose prompt names the lines that changed.

When the gate passes, run `date -u +%Y-%m-%dT%H:%M:%SZ` and keep the time it prints: it is where
Step 6's cost starts counting. Shell variables do not survive between calls, so keep it in the
conversation, not in a variable.

## Step 1 — Readback

Spawn `@test-writer` with: the issue number, and the instruction **readback only — write nothing.**

It returns four sections: **Assumptions** (things it would have to decide that the spec does
not), **Questions**, an **Interface check**, and a **Reuse check** (existing code that already
does something the spec would build). An Interfaces entry reported NOT FOUND and not marked new is
a question. If all but the Interface check are empty, go to Step 2.

Sort each item, and write every one you accept into the section of the issue it belongs to
(`gh issue edit <N> --body-file`). An answer that lives only in this conversation is invisible to
both agents, and comes back as the same item next round.

- **The code settles it** — a `[code]` line with the path. Keep going.
- **The Lead can settle it** — test design, or malformed input that defaults to what the existing
  code already does. A `[Lead]` line. Keep going. If you can cite the path that settles it, it is
  `[code]`; if not, `[Lead]`.
- **The operator would notice it in use** — stop. Put these to the operator one at a time, each
  with your recommendation. Write each answer as a `[you]` line.

**A reuse match** goes into Reuses as a `[code]` line with the existing path — a Screen match into
Screen's "Existing screen and components reused". Then the spec stops asking for the copy: the
criterion that restated it is reworded to point at it, its "New or changed signatures" entry is
removed, and "Files touched" gains the existing file if reuse means exporting from it. When
reusing it would change behaviour — the existing rule differs from the spec's — sort it as a
`[you]` item above, with your recommendation. A match you reject is one `[Lead]` line saying why.

Keep every `[code]` and `[Lead]` line, word for word, for the receipt.

**Rounds.** One round by default. Run a second only when round 1 changed what an acceptance
criterion does — a criterion's text, or a `[code]`/`[Lead]` line that adds behaviour no criterion
states — and name the changed lines in its prompt. A reuse match counts only when reusing changes
what a criterion does (the `[you]` case above); rewording a criterion to point at existing code,
or adding a Reuses path, does not. **If round 2 changes behaviour again, stop and ask** — the spec
needs rework, not a third read. An edit that only clarifies wording does not earn
another round; `@test-writer` can still stop in Step 2 and return a question.

**Coming back to the spec later counts against the same rule.** A question from Step 2, or a spec
fix from Step 3, is sorted as above and written into the issue. It earns a readback round only if
it changed behaviour, and that round is the second: if one has already run, stop and ask.

## Step 2 — Tests

Spawn `@test-writer` with: the issue number, and the instruction **write the tests.**

It returns one of three things:

- **A question** — the spec forced a guess. Sort it as in Step 1 and write the answer into the
  issue, then re-run readback only as Step 1's Rounds rule allows.
- **A stub report** — a stub would force a test to bend: edit an existing test, or work around
  what the stub cannot provide. Bring it to the operator with your recommendation; do not let
  `@test-writer` bend the test to get past it.
- **The tests** — the files it created or edited (tests, fixtures, helpers), the stubs it wrote, a
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
   and appears in its Files list was edited: that is a stub report, not a test.
2. **Fails for the right reason.** Run the `Proof command` yourself, against the stubs. Each test
   must fail on its own assertion — a wrong value, a missing row, a call that didn't throw — not on
   a missing file or function, a typo, a bad import path, or broken setup. The one exception is a
   column or table this task creates, which no stub can provide: "does not exist" is its right
   reason, when the report marks it new in this task. A test that passes
   against the stubs is accepted only beside the failing partner the report names, the test that
   proves the behaviour it guards. Anything else goes back to `@test-writer`.
3. **Lock the tests.** Commit every file `@test-writer` created or edited, except the stubs, on its
   own: `git add <files>` then `git commit -m "build-task: tests (squashed at ship)"`. Record
   `TESTS=$(git rev-parse HEAD)`. The commit is the lock: it holds the original bytes, so a
   violation can be undone, and `git diff` against it needs no working directory. Step 5 folds it
   back into one commit before `/kill-this`, so `@code-review` still sees the tests. The stubs stay
   in the tree, uncommitted: they are production files, and `@implementer` replaces them.

## Step 3 — Implement

Spawn `@implementer` with: the issue number, the test file list, the stub list, and the failing
output from Step 2.

It returns one of:

- **Done** — a summary of what changed. Go to Step 4.
- **Stop** — a test it believes is wrong, and why. Do not let it work around the test. Bring it to
  the operator: either the spec was wrong (fix the issue body under Step 1's Rounds rule) or the test was
  (set the implementation aside with `git stash push --include-untracked` and `git stash drop`,
  uncommit the tests with `git reset --soft "$TESTS~1"` so they stay in the tree to be revised,
  then Step 2 with the instruction **write the tests** followed by the finding, word for word; the
  stubs went with the implementation, so Step 2 writes them again).

## Step 4 — Verify

1. `git diff --quiet "$TESTS" -- $(git diff-tree --no-commit-id --name-only -r "$TESTS")` — any
   change to a file the tests commit holds fails the task. Set the implementation aside with
   `git stash push --include-untracked` (the tests come back as committed; the stubs go with the
   implementation), then `git stash drop`, and re-run Step 3 once, telling `@implementer` the stubs
   are gone and giving no stub list. A second violation: stop and tell the operator.
2. Run the `Proof command` yourself. Green, or back to Step 3 with the failure output.
3. Read `@implementer`'s "Stubs left as stubs". Anything but `None` is an empty function that no
   test needed and would ship as a silent no-op: remove it, or bring it to the operator.

**Two failed `@implementer` rounds on the same tests: stop and ask.** Something is wrong with the
spec, the tests, or the task's size, and a third round is spending the allowance to find out
which.

## Step 5 — Ship

First `git reset --soft "$TESTS~1"`, so tests and code ship as one commit and `/kill-this`'s
`git diff HEAD~1` shows both. Then run `/kill-this`. When it reaches code-review findings, route
each one:

| Finding | Goes to |
|---|---|
| Real bug a test should have caught | `@test-writer` (new test, no stubs — it must fail against the current code on its own assertion; committed on its own; `TESTS` is that commit), then `@implementer` |
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
  settled       — none | each [code] and [Lead] line added during the run, word for word, one per line
  test-writer   — <tests> tests across <criteria> criteria
  stubs         — <n> written, <n> left as stubs, <n> tests passing beside a partner
  implementer   — <rounds> rounds
  test lock     — intact | violated (<file>)
  review routes — <n> to test-writer, <n> to implementer, <n> fixed by Lead
  cost          — <first line of cost.mjs>
<the rest of cost.mjs's lines, as printed>
```

For the cost, run this from the repo root after `/kill-this` has opened the pull request, with the
time Step 0 printed:

    node .claude/skills/build-task/cost.mjs --since <time> 2>/dev/null || echo "unavailable — cost.mjs did not run"

It reads this session's transcripts and prints the output tokens each role wrote and the active
minutes, which include short waits on the operator but not long ones. Whatever it prints goes in
the receipt as is, `unavailable — <why>` included, and the run carries on.

The receipt is also what this workflow spent, in a shape the old loop's session file can be
compared against. `settled` is the operator's audit of the calls made without them — every
`[Lead]` line, and a judgment call filed as `[code]`, shows up there.
