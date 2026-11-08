Read-only audit: where Muster writes one row and then another, can a failure between them leave the two disagreeing?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

The worked example: cancelling a booking used to save the booking as cancelled and then release its boat as a second save. A failure between the two left a cancelled booking holding a boat. Issue #1228 made them one write (`cancelBookingAndRelease` in `src/ports/repository.ts`). Muster Reservations goes live on 2027-02-01. Find every other pair like that.

1. **Every sequence of two or more writes that must agree** — two repository calls in a row; a repository write and a Stripe call (charge, refund, cancel an intent); a repository write and a message send; a write and a trail row; a write and a cache or a cookie. Include writes in a server action, a webhook, a cron job and the core.
2. **For each, answer:** what is written first and what second; what state is left if the process dies, the connection drops, or the second call throws, between them; whether anything later notices and repairs it (a retry, a webhook redelivery, a reconciler, a screen a person reads); and whether the pair could be one write (one transaction, one port method) or must stay two (an external call cannot join a database transaction) — and if it must stay two, which order fails safe.
3. **Then the reverse:** pairs that are already one write — say so in one line, so the coverage is visible.

Weight bookings, payments, refunds, cancels and payment links above crew and payroll. Those still get a row each, but a one-line one.

## Where the code is

Every caller of the port in `src/ports/repository.ts`: `src/reservations/`, `src/crew/`, `src/builder/`, `src/asks/`, the server actions under `app/`, `app/api/webhooks/` and `app/api/cron/`. The Postgres adapter `src/adapters/postgres-repository.ts` shows which port methods are already one transaction. `docs/audit/README.md` § To do item 8 is where this audit was proposed.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line`.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. If `node_modules` is missing, say so in the report and carry on reading; do not install anything. Postgres is not available, so tests run against the in-memory repository. Where a finding depends on the Postgres adapter, read the SQL and say it was read, not run.
- A test that demonstrates a finding is the strongest evidence. A failure between two writes can be shown with a stub that throws on the second call. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- **Do not re-report a known finding.** `docs/audit/README.md` holds the ledger of every finding from the earlier audits (payroll F8 is one pair already found). Where you meet one, cite it by its ledger id in one line and move on.
- Be thorough; that is the point of this session. Use subagents to split the work and read in parallel — for example: reservations and payments; webhooks and cron; crew and payroll; everything else. The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-paired-saves.md` at the repository root, on a new branch `audit/paired-saves` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many write sequences found, how many are already one write, how many could be, how many must stay two and fail safe, how many fail unsafe, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — a failure between the writes leaves a customer charged or owed with no booking, a boat sold twice, or a booking lost, and nothing repairs it.
   - **S2** — it leaves the operator, a customer or crew seeing something untrue, and nothing repairs it.
   - **S3** — it leaves an inconsistency that something repairs, late or by a best-effort path.
   - **S4** — the pair is safe but could be one write, or its ordering is undocumented.
3. Each finding: both writes at `path:line`; the state left between them; what repairs it, or "nothing"; one concrete scenario; whether it can be one write; severity; confidence — *read*, *tested*, or *suspected*.
4. A table of every sequence: where, the two writes, one write or two, fails safe or unsafe.
5. What could not be determined from the code.
