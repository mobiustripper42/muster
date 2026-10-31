<!--
The spec for a task headed for /build-task: any task that changes behaviour, whatever its points.
It is the issue body: write it with `gh issue edit <N> --body-file`, and write every change there,
not only in the chat. The agents read the issue by number and never see the conversation.

A small task fills the same sections, briefly. A bug fix's AC1 is the reproduction, stated as the
behaviour it should have; a section with nothing to say is "None".

The Lead writes this from the spec conversation and reads the code to fill Interfaces and to find
what it must reuse — readback's reuse check is the second look, not the first. Walk the
operator through it in this order, and stop at the first part they say is wrong:
  1. Summary
  2. Job and acceptance criteria
  3. Every [Lead] line, grouped by section. [you] and [code] lines only if asked.
The operator approves by running /build-task. It refuses to start while any section is blank or
Open questions has anything in it. "None" is an answer; blank is not.

Every line in the sections below carries its source:
  [you]  — the operator said it
  [code] — read from the repo, with the path
  [Lead] — the Lead's own call. These are the lines the operator must read. [Lead] lines added
           during a /build-task run are not walked through; they appear in its receipt.
-->

## Summary
<!-- Three sentences, plain words: what changes, for whom, and the riskiest [Lead] call. -->

## Job
<!-- One line. What changes for whom. -->

## Acceptance criteria
<!-- Numbered. One behavior each. Tests will name these ids. Mark a criterion only a person can
     check — on a device, by eye — with `(by hand)`: it gets no test and is checked at the
     hand-back. -->
- **AC1** — given …, when …, then …
- **AC2** — …
- **AC3** — (by hand) on the phone, …

## Interfaces
<!-- Exact, from the code — not from memory. The test-writer builds against this list. -->
- **Files touched:** `path/to/file.ts`, …
- **New or changed signatures:** `functionName(arg: Type): ReturnType`, route `POST /api/…`, …
- **Data shapes:** table/column, type, or JSON shape the tests will assert on
- **Reuses:** existing functions, components, constants and rules this must call rather than re-create

## Screen
<!-- Only if the task has a screen. Otherwise write "None". -->
- **Existing screen and components reused:**
- **What's on the screen, in order, with the actual wording:**

## Seeds
<!-- The data a person needs for the (by hand) criteria, made by the project's dev seeds — never by clicking through the app first. Name the seed commands each (by hand) criterion starts from, and the seed this task adds or extends to reach that state. A seed this task adds or extends is listed under Interfaces' Files touched. "None" when no criterion is (by hand), or the project has no database or no seed command. -->

## Out of scope
<!-- What a reasonable builder might add that we are not adding. -->

## Decisions
<!-- DEC ids this must honor. Or the search that found none: `grep -rli "<subject>"` → nothing. -->

## Open questions
<!-- Must be empty before handoff. Readback answers move up into the sections above, not here. -->
