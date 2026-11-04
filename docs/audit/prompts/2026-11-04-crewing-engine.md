Read-only audit: does Muster's crewing engine do what `docs/SPEC.md` §1.1–1.4 says — and can anyone end up on a boat who is not allowed to crew it, or can a shift that needs crew stop being worked without anyone knowing?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

Muster turns trips into shifts, works out who may legally crew each seat, asks them in reliability order, and escalates what it cannot fill. For every rule the spec states about that — shift and seat states and the edges between them, the escalation tiers, who is eligible, who is asked, in what order and when, what makes a shift `Crewed` or `At-Risk`, which reliability events are logged and how they score — find the code that implements it and say whether it does what the spec says.

Then the reverse: find code that decides a shift or seat state, who is eligible, who is asked, in what order, or when, where the spec says nothing.

Then answer these four directly, whatever the spec says:

1. **Can someone who is not allowed to crew a seat end up `Confirmed` on it?** List every path that writes a seat to `Claimed` or `Confirmed` — an "in" on an ask, a self-serve pick, an admin assign, a lean, a split or merge that moves seats, anything else you find. For each: is the oracle re-checked at the moment of the write, or is a pool computed earlier trusted? What happens when a credential lapses, PTO is added, the person is archived, or they are confirmed on an overlapping shift after the ask went out and before they tap "in"?
2. **Can one person be confirmed on two overlapping shifts?** Including two "in" taps on two shifts at the same moment.
3. **Can a shift that needs crew stop being worked silently** — no ask out, not `Crewed`, never `At-Risk`? Look hardest at the edges: a bail (DEC-128 rests the seat `Open` and fires no ask), a split or merge, a trip added to or removed from a crewed shift, a vessel or manning change, a shift that crosses its staffing horizon between two ticks, a tick that fails halfway or runs twice.
4. **When two people say "in" to the same seat at once, does exactly one win**, and does the loser's ask end as `withdrawn` (DEC-146), not `ask_ignored`?

## What the spec says

`docs/SPEC.md` §1.1 (the shift and seat state machine), §1.2 (the escalation tiers and the assignment protocol), §1.3 — the **crew eligibility** half only (`src/oracle/`, six rules) and the two horizons — and §1.4 (the reliability score). Then the rules in §2.3 Shift Builder, §2.4 Assignment View, §2.5 At-Risk Board, §2.6 Crew App and §2.7 Crew Self-Serve that decide a state, an eligibility, an ask or an order. Read the decisions those sections cite — at least DEC-024, DEC-031, DEC-061, DEC-063, DEC-080, DEC-116, DEC-120, DEC-128, DEC-145, DEC-146 — resolving each with `grep -rl DEC-128 docs/decisions/`. Where a section says "amended by" or "superseded by", the amendment is the rule.

Out of scope, because other audits cover them: booking availability (`src/reservations/availability.ts`) and anything about money; payroll and the time clock; the wording and delivery of messages (which channel, retries, what the text says). Whether an ask is *made*, to *whom* and *when* is in scope; how it reaches the phone is not.

## Where the code is

Start from `src/oracle/`, `src/builder/`, `src/asks/`, `src/crewapp/` and `src/domain/` (`states.ts`, `reliability.ts`, `entities.ts`). Then the doors that change crewing state: the admin actions under `app/(admin)/admin/` (`shift/`, `shifts/`, `at-risk/`, `asks/`, `time-off/`, and any other that assigns, leans, splits, merges or archives), the crew actions in `app/(crew)/crew/actions.ts` and under `app/(crew)/crew/`, and the scheduled job `app/api/cron/tick/` (scheduled in `vercel.json`). Follow whatever those call that decides a state, an eligibility or an ask. This list is a starting point, not the boundary.

Three traps, from `.claude/CLAUDE-context.md`, that have produced wrong reasoning here before:

- **vessel + date does not identify a shift.** Shifts split and merge. A lookup or a uniqueness assumption keyed that way is a finding.
- **Two windows that look alike and are not (DEC-080).** `XOLA_PULL_LEAD_DAYS` is how far ahead reservations are fetched; `STAFFING_HORIZON_LEAD_DAYS` is how far ahead a shift is worked and crew are asked. Both are env-overridable per deploy, so never state a deployed value; cite the default where it is defined (`src/builder/derive.ts`).
- **Manning is per-vessel data (1, 2 or N seats), never a fixed captain-and-mate pair**, and a vessel with no required crew is an error, not a state.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line` and quotes the spec sentence it is about, with its section.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. Postgres is not available, so tests run against the in-memory repository. Where a finding depends on the Postgres adapter (a lock, a conditional write, a constraint), read the SQL and say it was read, not run.
- A test that demonstrates a finding is the strongest evidence. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- Be thorough; that is the point of this session. Use subagents to split the work and read in parallel — for example: the state machine and the tick; eligibility and every write to a seat; the ask, the drip and escalation; reliability events and the score; the builder (grouping, split, merge, manning). The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-crewing-engine.md` at the repository root, on a new branch `audit/crewing-engine` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many rules checked, how many match, how many differ, how many are not built, how many code behaviours have no spec, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — someone not allowed to crew a seat (wrong rating, lapsed credential, inactive or archived, on PTO, recurring day off, or double-booked) can end up `Confirmed` on it; or a shift reads `Crewed` while a required seat is not legally filled.
   - **S2** — a shift that needs crew silently stops being worked (no ask, not `Crewed`, never `At-Risk`); or a person is asked who should not be, asked twice, asked before the staffing horizon, or asked after the seat filled.
   - **S3** — the wrong thing is shown to the operator or crew (a state, who was asked, standing); or a reliability event is logged wrong, missed or doubled, so the ask order is wrong.
   - **S4** — the spec is stale or silent and the code is fine.
3. Each finding: the spec sentence and section (or "spec silent" and what a careful reader would expect); the code at `path:line`; what differs; one concrete scenario with names, times and dates; severity; and confidence — *read* (from the code), *tested* (a test shows it, reproduced), or *suspected*.
4. The four direct questions above, each answered in a short paragraph, with the table of every path that writes a seat to `Claimed` or `Confirmed`: where it is, whether it re-checks eligibility at the write, and what guards against a race.
5. A short list of rules that match, one line each, so the coverage is visible.
6. What could not be determined from the code.
