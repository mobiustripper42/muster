Read-only audit: does the code have what `docs/PROJECT_PLAN.md` and `docs/SPEC.md` say has shipped?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

Muster Reservations goes live on 2027-02-01, and the plan is what the operator reads to know what is done. An earlier audit found the reconciler (Phase 15, task 15.16) marked `[x]` and never built (money F3 in `docs/audit/README.md`). Find every other one.

1. **Every `[x]` row in `docs/PROJECT_PLAN.md`.** For each, find the code that delivers what the row says. A row that names a file, a function, a cron entry, a migration, a screen or a test is checked against that thing existing and doing what the row claims. Verdict per row: **built**, **partly built** (say what is missing), **not built**, or **superseded** (a later row or decision replaced it — cite it).
2. **Every acceptance criterion in `docs/SPEC.md`** — lines written as a criterion, a "must", or a checkbox — in §2.8 (payments), §2.10 (reservations the operator runs), §3.3 (the cancel cascade) and §3.4 (disputes). Same verdicts.
3. Then the reverse: a feature the code has that neither the plan nor the spec mentions. One line each.

Weight the reservation phases (12 to 16) and anything a customer or the operator touches on a booking above the crew phases. Crew and payroll rows still get a verdict, but a one-line one.

## Where things are

`docs/PROJECT_PLAN.md` (each phase's table). Do not open the GitHub issues the rows link; judge each row from the repository only. `docs/SPEC.md`. Decisions in `docs/decisions/`, resolved with `grep -rl DEC-<id> docs/decisions/`. The code under `src/`, `app/`, `db/migrations/` and `vercel.json`.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line` and, where there is one, quotes the spec or plan sentence it is about, with its section.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. If `node_modules` is missing, say so in the report and carry on reading; do not install anything. Postgres is not available, so tests run against the in-memory repository. Where a finding depends on the Postgres adapter, read the SQL and say it was read, not run.
- A test that demonstrates a finding is the strongest evidence. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- **Do not re-report a known finding.** `docs/audit/README.md` holds the ledger of every finding from the earlier audits. Where you meet one, cite it by its ledger id ("money F3") in one line and move on.
- Be thorough; that is the point of this session. Use subagents to split the work and read in parallel — for example one per phase. The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-plan-vs-code.md` at the repository root, on a new branch `audit/plan-vs-code` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many rows and criteria checked, how many at each verdict, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — a row or criterion marked done is not built, and its absence can lose a customer's money or booking, or sell a boat twice.
   - **S2** — marked done, not built or partly built, and a customer or the operator would notice.
   - **S3** — marked done, partly built, and nobody would notice until it is needed.
   - **S4** — the plan or spec is stale and the code is fine.
3. Each finding: the row or criterion, quoted, with its location; the code at `path:line` or the search that came back empty; what is missing; severity; confidence — *read*, *tested*, or *suspected*.
4. A table of every `[x]` row checked: phase, task, verdict, one-line evidence.
5. What could not be determined from the repository.
