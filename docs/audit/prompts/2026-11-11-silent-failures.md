Read-only audit: when Muster catches or swallows an error, does a person ever find out?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

Muster Reservations goes live on 2027-02-01. Earlier audits found, one at a time, failures that are logged and nothing else: a confirmation that fails to send but counts as sent, a failed refund whose only alert is a best-effort email (money F4, F5, payroll F2 in `docs/audit/README.md`). This audit finds all of them at once.

1. **List every place an error is caught, swallowed or turned into a default** — `logSwallowed` (`app/lib/swallowed.ts`), every `try`/`catch`, every `.catch(`, every `catch {}` with no body, every `Promise.allSettled`, every result type whose failure branch is ignored, every `?? default` that hides a failed read.
2. **For each, answer three things:** what failed (a send, a charge, a refund, a write, a read); what the user in front of the screen is told; and **who finds out later and how** — a durable row someone's screen lists, an alert that is retried until it lands, or only a log line nobody reads. Name the screen or the alert, or say "nobody".
3. **Then the reverse:** a screen that tells someone a thing happened ("we've let the team know", "you'll get a text", "refunded") where the code does not know it happened.

Weight anything on a booking, a payment, a refund, a cancel, a customer message or an operator alert above the crew and payroll paths. Those still get a row each, but a one-line one.

## Where the code is

Everything under `src/` and `app/`. Start from `app/lib/swallowed.ts` and its callers, `src/reservations/`, `app/b/`, `app/(public)/book/`, `app/api/webhooks/`, `app/api/cron/`, and the adapters in `src/adapters/` that talk to Stripe, Twilio and email. `src/log.ts` is the logger; `.claude/CLAUDE-context.md` says what reads production logs.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line` and, where there is one, quotes the spec sentence it is about, with its section.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. If `node_modules` is missing, say so in the report and carry on reading; do not install anything. Postgres is not available, so tests run against the in-memory repository. Where a finding depends on the Postgres adapter, read the SQL and say it was read, not run.
- A test that demonstrates a finding is the strongest evidence. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- **Do not re-report a known finding.** `docs/audit/README.md` holds the ledger of every finding from the earlier audits. Where you meet one, cite it by its ledger id ("money F5") in one line and move on.
- Be thorough; that is the point of this session. Use subagents to split the work and read in parallel — for example: payments and refunds; customer messages; operator alerts; cron jobs; everything else. The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-silent-failures.md` at the repository root, on a new branch `audit/silent-failures` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many catch sites found, how many reach a person, how many reach only a log, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — money moves, or a booking changes, and nobody is ever told: the customer is charged or owed and no one with the power to fix it finds out.
   - **S2** — a customer or the operator is told something happened that did not, or a failure needs a person and reaches only a log.
   - **S3** — a failure reaches a person late, or by a path that is itself best-effort.
   - **S4** — swallowed on purpose and harmless, but undocumented.
3. Each finding: the code at `path:line`; what fails; what the screen says; who finds out and how; one concrete scenario; severity; confidence — *read*, *tested*, or *suspected*.
4. A table of every catch site: file and line, what fails, who finds out (screen, alert, log only, nobody).
5. What could not be determined from the code — for example what production logs are actually read by.
