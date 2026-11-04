Read-only audit: who can reach what in Muster without signing in, and does every door check who is knocking?

This message is the approved plan. Do not wait for a "go", and do not run any session skill (`/its-alive`, `/kill-this`, `/save-this`, `/its-dead`).

## What to check out

Branch `task/16.9-self-service-cancel` (`main` plus pull request #1214, which adds a cancel action to the customer's `/b/<code>` page). Audit that branch, not `main`.

## The question

Muster has two kinds of door. **Capability URLs**: a link whose secret is the only key — the customer's booking page, the pay link, the waiver link, the calendar feed, and any others you find. **Sign-in**: the 6-digit emailed code, the session cookie, and the crew-to-admin switch. Then every server action and route handler, because in Next.js every exported function in a `"use server"` file is a public endpoint whether or not a page links to it.

For each capability URL, answer:

1. **What does holding it let someone see and do?** Personal data shown, and every action it can trigger: pay, cancel, refund, change contact details, sign a waiver, request a change.
2. **Can it be guessed or enumerated?** How the secret is minted, its entropy, and whether any lookup that finds one (booking lookup at `/b/find`, for one) is rate-limited and how.
3. **How long does it work?** Expiry; what happens after the booking is cancelled, the trip departs, or the operator reissues the link; whether the old one really stops.
4. **Where can it leak?** Referer to third parties, logs, error messages, analytics, messages sent to the wrong person, search indexing.
5. **What reaches the page that belongs to someone else?** Issue #1213 is the known case: customers merge on an unverified phone (`src/customers/resolve.ts:57-58`), so a stranger's booking page can list your trips. Find every other path of that shape.

For sign-in: code entropy, expiry, attempt limits, what the rate limit keys on and whether that key can be forged (`app/lib/client-ip.ts`, `app/lib/cloudflare-ips.ts`), how the session cookie is signed and checked, how a crew member becomes an admin, and whether any dev-only door (`app/(crew)/crew/dev-code/`) can open in production.

For every server action and route handler: who may call it, whether it checks that before doing anything, and whether it trusts an id from the form (a hidden `reservationId`, for one) without checking that the caller may act on that record.

## Where the code is

Start from the **Auth / capability URL** row of the Blast-Radius Triggers table in `.claude/CLAUDE-context.md`. That row is a starting point, not the boundary: it does not list `app/(public)/p/[token]/` (the pay link) or `app/api/guest-contact/`, and the table's own notes record it missing files several times. Find the rest with `grep -rl '"use server"' app` and `ls app/api`.

What the spec says: `docs/SPEC.md §3.2 Authentication`; DEC-081, DEC-174 and DEC-181 in `docs/decisions/` (resolve each with `grep -rl DEC-181 docs/decisions/`); the manage page and pay link in `docs/SPEC.md §2.8 Booking & Payment — the customer buys a trip`; the waiver link in `docs/design/check-in-and-waivers.md` and `docs/design/check-in-surfaces.md`. The spec is thin here, so most findings will be against what a careful reader would expect, not against a sentence. Say which.

## Rules

- Change no code. Open no pull request, file no issue, post no comment.
- Send no request to any deployed host. Everything here is read from the code or shown by a local test.
- Every claim cites `path:line`.
- Do not guess what Vercel, Cloudflare, Stripe or a browser does. Where a finding depends on it (whether a header can be set by the client, whether a Referer is sent), say so and mark it unverified.
- If you can run unit tests (`npm test -- <file>`; Postgres is not assumed), a test that demonstrates a finding is the strongest evidence. Put the test in the report, not in the repo.
- Be thorough; that is the point of this session. Use subagents to split the work — capability URLs, sign-in, server actions, route handlers — and read in parallel.

## The report

Write `AUDIT-capability-urls.md` at the repository root, on a new branch `audit/capability-urls` cut from `task/16.9-self-service-cancel`. Commit it and push the branch. Do not open a pull request; it is never merged.

Shape:

1. One paragraph: how many doors were checked and how many findings at each severity.
2. Findings, most severe first. Severity:
   - **S1** — a stranger can see another person's data, act on someone else's booking or money, or sign in as someone.
   - **S2** — a holder can do more than intended; a link keeps working after it should stop; guessing or brute force is not limited.
   - **S3** — a leak or gap that needs a second mistake to matter, or a missing check that another layer happens to cover.
   - **S4** — the spec or docs are stale or silent and the code is fine.
3. Each finding: what a careful reader would expect, or the spec sentence and section; the code at `path:line`; one concrete scenario; severity; and confidence — *read*, *tested*, or *suspected*.
4. A table of every capability URL: what it grants, how it is minted, how long it lives, how it is rate-limited.
5. Every server action and route handler, one line each: who may call it and where that is checked, so the coverage is visible.
6. What could not be determined from the code.
