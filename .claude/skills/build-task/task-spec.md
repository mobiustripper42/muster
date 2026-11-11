<!--
The spec for a task headed for /build-task: any task that changes behaviour, whatever its points.
It is the issue body: /build-task's Step 0 writes it there from the walk, and every later change
is written there too, not only in the chat. The agents read the issue by number and never see the
conversation.

A small task fills the same sections, briefly. A bug fix's AC1 is the reproduction, stated as the
behaviour it should have; a section with nothing to say is "None".

The Lead drafts this from the spec conversation and reads the code to fill Interfaces, to find
what it must reuse, and to search the tests for everything it removes — readback's reuse and
removal checks are the second look, not the first. Walk it in stops, one per reply, and wait for
the operator's answer at each:
  1. Summary and Job, together
  2. Acceptance criteria
  3. Interfaces — the [Lead] calls first, each a plain sentence: what changes and why, no file
     names. The file and signature lists follow, for reference; the operator reads the calls and
     skims the lists.
  4. Screen
  5. Seeds, Out of scope, Decisions and Open questions, together — they are usually short.
[you] and [code] lines only if asked. At each stop the operator discusses it or approves it
before the next goes out. Any word of approval is "Approved" — "next", "okay", "sounds good",
"yes" — and moves to the next stop without asking whether it was one. The finished spec goes into
the issue whole, at /build-task Step 0, and the agents read the full lists there; the walk is a
conversation, not one document.
The operator approves the walk by running /build-task. Its Step 0 writes the spec into the issue,
then refuses to start while any section is blank or Open questions has anything in it. "None" is an answer; blank is not.

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
<!-- Exact, from the code — not from memory. The test-writer builds against this list.
     One shared home: a style, a piece of markup, a rule or a value that the Screen section or the
     criteria describe in more than one place is built once, as a CSS class, component, function or
     constant named under New or changed signatures with its file under Files touched (under
     Reuses, if it exists already), and each place points at it. Two descriptions with no home
     named get built twice, and no search of the code finds that copy, because it does not exist
     yet. -->
- **Files touched:** `path/to/file.ts`, …
- **New or changed signatures:** `functionName(arg: Type): ReturnType`, route `POST /api/…`, …
- **Data shapes:** table/column, type, or JSON shape the tests will assert on
- **Reuses:** existing functions, components, constants and rules this must call rather than re-create
- **Removes:** each export, constant, copy or config key, route, page or file this deletes or renames, and every test that uses it, with what happens to that test: deleted, or retargeted to what replaces it. "None" when nothing goes

## Screen
<!-- Only if the task has a screen. Otherwise write "None".
     Components are the ones `.claude/ui-context.md` points to. -->
- **Design:** a new screen names its desktop mockup and its mobile mockup. A change to a built screen names that screen as its design and says where the change goes at desktop width and at mobile width; it gets a new mockup only if the operator asks for one.
- **What's on the screen, in order:** one line per element — its component, or for a button its kind, then its actual wording.
- **New:** an element no component covers is marked new, with one line on why none fits. The task adds it as a component, with any rule the project enforces for components, named under Interfaces like any other shared home.

## Seeds
<!-- The data a person needs for the (by hand) criteria, made by the project's dev seeds — never by clicking through the app first. Name the seed commands each (by hand) criterion starts from, and the seed this task adds or extends to reach that state. A seed this task adds or extends is listed under Interfaces' Files touched. "None" when no criterion is (by hand), or the project has no database or no seed command. -->

## Out of scope
<!-- What a reasonable builder might add that we are not adding. -->

## Decisions
<!-- DEC ids this must honor. Or the search that found none: `grep -rli "<subject>"` → nothing. -->

## Open questions
<!-- Must be empty before handoff. Readback answers move up into the sections above, not here. -->
