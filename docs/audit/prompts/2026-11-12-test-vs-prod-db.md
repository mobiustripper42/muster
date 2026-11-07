Read-only audit: does every method on the `Repository` port behave the same in the in-memory adapter the tests use and the Postgres adapter production runs?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `main`. Audit `main` as it stands.

## The question

Every unit test runs against `src/adapters/in-memory-repository.ts`. Production runs `src/adapters/postgres-repository.ts`. `src/adapters/repository-contract.ts` is the shared suite meant to prove they agree. Three earlier findings each found one place they do not (money F18, crewing S3-1, crewing S4-11 in `docs/audit/README.md`). Muster Reservations goes live on 2027-02-01, so a passing test that proves nothing about production is a launch risk.

For **every method on the port** (`src/ports/repository.ts`), compare the two adapters on:

1. **Ordering** — does a list come back in the same order, and does any caller depend on it?
2. **Nulls and absent fields** — `undefined` versus `NULL`, empty arrays versus no rows, defaults applied in one and not the other.
3. **Conditional writes** — a write that should only happen if a row is in a given state: does each adapter enforce the condition, and return the same result when it fails?
4. **Locks and concurrency** — what Postgres serializes (a row lock, an advisory lock, a unique index) and what the in-memory adapter does instead. Two callers at once: same outcome?
5. **Duplicate keys and constraints** — a unique index or check in SQL with no twin in memory, or the reverse.
6. **Transactions** — a method that does several writes: all-or-nothing in both?
7. **Dates and money** — text timestamps, timezones, integer cents.

Then: **which methods does `repository-contract.ts` not exercise at all**, and which of the seven points above does it skip for the methods it does cover?

Weight the methods reservations, payments, refunds and cancels call above crew and payroll methods. Those still get a row each.

## Where the code is

`src/ports/repository.ts`, `src/adapters/in-memory-repository.ts`, `src/adapters/postgres-repository.ts`, `src/adapters/repository-contract.ts` and the two adapter test files beside them, and `db/migrations/` for the schema, indexes and constraints. DEC-DATA-1 and DEC-131 (`grep -rl DEC-131 docs/decisions/`) say which constraints belong to storage.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Every claim cites `path:line` for both adapters.
- Run unit tests with `npm test -- <file>`. **`npx vitest` is denied by the permission policy; `npm test -- <file>` is not** — two earlier audits lost all their test evidence by using the `npx` form. If `node_modules` is missing, say so in the report and carry on reading; do not install anything. **Postgres is not available**, so the Postgres side is read, not run: say so on every Postgres claim.
- A test that demonstrates a finding is the strongest evidence. Write probe tests as `*.audit-tmp.test.ts`, run them, reproduce each one that shows a finding in the report, and delete them before you commit. The only file you commit is the report.
- **Do not re-report a known finding.** `docs/audit/README.md` holds the ledger of every finding from the earlier audits. Where you meet one, cite it by its ledger id ("money F18") in one line and move on.
- Be thorough; that is the point of this session. Use subagents to split the port's methods between them. The lead re-reads every S1 and S2 at its cited lines before it goes in.

## The report

Write `AUDIT-test-vs-prod-db.md` at the repository root, on a new branch `audit/test-vs-prod-db` cut from `main`. Commit it and push the branch. **Pushing the branch is the whole delivery. Do not open a pull request** — GitHub will offer one; decline it. The branch is never merged.

Shape:

1. One paragraph: the commit audited, how many port methods, how many agree on all seven points, how many differ, how many the contract suite does not cover, and the count at each severity.
2. Findings, most severe first. Severity:
   - **S1** — the adapters differ where a booking, payment, refund or cancel depends on it, so a test passes while production double-books, double-charges or loses a write.
   - **S2** — they differ in a way a customer, the operator or crew would see in production but no test would catch.
   - **S3** — they differ, nothing depends on the difference today, but the next caller would.
   - **S4** — a contract-suite gap with no known difference.
3. Each finding: the method; both adapters at `path:line`; what differs; the caller that depends on it; one concrete scenario; severity; confidence — *read*, *tested* (in-memory side only), or *suspected*.
4. A table of every port method: covered by the contract suite (yes / partly / no), and which of the seven points differ.
5. What could not be determined without a running Postgres.
