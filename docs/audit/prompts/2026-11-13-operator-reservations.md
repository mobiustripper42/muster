Read-only audit: does the operator's side of reservations do what `docs/SPEC.md` §2.10, §3.3 and §3.4 say?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

Muster Reservations goes live on 2027-02-01. The operator runs it from the admin screens: the calendar, booking by phone, the payment link, holds and blocks, discounts, the booking cutoff, cancelling and refunding, the purchases and abandonment lists, the reservation trail, disputes. The money paths were audited already (`docs/audit/2026-11-02-money-spec-2.8.md`). This audit covers everything else the operator does to a booking.

For every rule §2.10, §3.3 and §3.4 state, find the code that implements it and say whether it does what the spec says. Then the reverse: code that decides what the operator can do to a booking, or what they see about one, where the spec says nothing.

Then answer these directly, whatever the spec says:

1. **Can the operator put the system in a state they cannot get out of from a screen?** A booking, hold, block or payment link that no admin action can change, cancel or clear.
2. **Does every operator action on a booking leave a trail row** (`src/domain/reservation-trail.ts`), with who did it?
3. **Does what the operator sees match what is stored** — the calendar, the booking pane, `/admin/purchases`, `/admin/abandonment`, `/admin/integrity` — including after a cancel, a lapse, a refund and a discount?
4. **Can two operators, or an operator and a customer, act on one booking at once** and leave it inconsistent?

## What the spec says

`docs/SPEC.md` §2.10 (reservations the operator runs), §3.3 (the cancel cascade), §3.4 (dispute and chargeback surfacing), and the §2.8 sentences those sections lean on. Read the decisions they cite, resolving each with `grep -rl DEC-<id> docs/decisions/` — at least DEC-162, DEC-163, DEC-193 and the discount and cancellation decisions. Where a section says "amended by" or "superseded by", the amendment is the rule.

Out of scope, because other audits cover them: how a charge, refund or balance is computed and sent to Stripe (the money audit); sign-in and capability URLs (`docs/audit/2026-11-03-capability-urls.md`); the crewing engine and payroll; check-in and waivers.

## Where the code is

`app/(admin)/admin/` — start with `calendar/` (including `[reservationId]/`), `purchases/`, `abandonment/`, `integrity/`, `blocks/`, and any other screen that reads or changes a booking. Then `src/reservations/`, `src/domain/reservation-trail.ts`, `app/lib/payment-link.ts`, and the port methods they call in `src/ports/repository.ts`. This list is a starting point, not the boundary.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line` and quotes the spec sentence it is about, with its section.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. If `node_modules` is missing, say so in the report and carry on reading; do not install anything. Postgres is not available, so tests run against the in-memory repository. Where a finding depends on the Postgres adapter, read the SQL and say it was read, not run.
- A test that demonstrates a finding is the strongest evidence. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- **Do not re-report a known finding.** `docs/audit/README.md` holds the ledger of every finding from the earlier audits. Where you meet one, cite it by its ledger id ("money F12") in one line and move on.
- Be thorough; that is the point of this session. Use subagents to split the work and read in parallel — for example: booking by phone and the payment link; holds, blocks and cutoff; discounts; cancel and refund from the admin side; the lists and the trail. The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-operator-reservations.md` at the repository root, on a new branch `audit/operator-reservations` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many rules checked, how many match, how many differ, how many are not built, how many code behaviours have no spec, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — an operator action sells a boat twice, loses a booking, or leaves a customer charged or owed with no way to fix it from a screen.
   - **S2** — the operator sees something that is not true about a booking, or cannot do something §2.10 says they can.
   - **S3** — an action leaves no trail, or a screen is right but misleading.
   - **S4** — the spec is stale or silent and the code is fine.
3. Each finding: the spec sentence and section (or "spec silent" and what a careful reader would expect); the code at `path:line`; what differs; one concrete scenario with names, times and dates; severity; confidence — *read*, *tested*, or *suspected*.
4. The four direct questions above, each answered in a short paragraph.
5. A short list of rules that match, one line each.
6. What could not be determined from the code.
