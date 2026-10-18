<!--
The spec for a task headed for /build-task (3+ points). It is the issue body: write it with
`gh issue edit <N> --body-file`, and write every change there, not only in the chat. The agents
read the issue by number and never see the conversation.

The Lead writes this from the spec conversation and reads the code to fill Interfaces. Walk the
operator through it in this order, and stop at the first part they say is wrong:
  1. Summary
  2. Job and acceptance criteria
  3. Every [Lead] line, grouped by section. [you] and [code] lines only if asked.
The operator approves by running /build-task. It refuses to start while any section is blank or
Open questions has anything in it. "None" is an answer; blank is not.

Every line in the sections below carries its source:
  [you]  — the operator said it
  [code] — read from the repo, with the path
  [Lead] — the Lead's own call. These are the lines the operator must read.
-->

## Summary
<!-- Three sentences, plain words: what changes, for whom, and the riskiest [Lead] call. -->

## Job
<!-- One line. What changes for whom. -->

## Acceptance criteria
<!-- Numbered. One behavior each. Tests will name these ids. -->
- **AC1** — given …, when …, then …
- **AC2** — …

## Interfaces
<!-- Exact, from the code — not from memory. The test-writer builds against this list. -->
- **Files touched:** `path/to/file.ts`, …
- **New or changed signatures:** `functionName(arg: Type): ReturnType`, route `POST /api/…`, …
- **Data shapes:** table/column, type, or JSON shape the tests will assert on
- **Reuses:** existing functions/components this must call rather than re-create

## Screen
<!-- Only if the task has a screen. Otherwise write "None". -->
- **Existing screen and components reused:**
- **What's on the screen, in order, with the actual wording:**

## Out of scope
<!-- What a reasonable builder might add that we are not adding. -->

## Decisions
<!-- DEC ids this must honor. Or the search that found none: `grep -rli "<subject>"` → nothing. -->

## Open questions
<!-- Must be empty before handoff. Readback answers move up into the sections above, not here. -->
