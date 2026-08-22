---
session: 91
dev: eric
slug: 678-create-stripe-customers
branch: task/678-create-stripe-customers
started: 2026-08-20T14:20:24Z
ended: 2026-08-22T00:40:15Z
points: 12
pr_numbers: [795, 798, 808, 810]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster-s91/a644283b-bc9c-59d6-a0d0-e05c848a61ed.jsonl
---

# Session 91 — 678-create-stripe-customers

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Send our form's contact details to Stripe, and give the guest their receipt (issue #679, folded into issue #678)

**Completed:**
- **The finding that shaped the whole task:** passing `billing_details` at confirm does nothing on
  its own. Stripe documents *"Details collected by Elements will override values passed here"* — the
  Payment Element was mounted bare, collected its own name and phone, and won. The fields must be
  turned OFF. `defaultValues` can't do it either: read at mount, and the contact inputs sit above
  the card element, so they're empty then. Name and phone only — a suppressed field becomes
  REQUIRED at confirm, and email is optional at `/book`, so suppressing it would reject every
  guest who left it blank (`app/(public)/book/checkout/checkout-form.tsx`).
- `description` + `receiptEmail` on the PaymentIntent (`src/ports/payment.ts`,
  `src/adapters/stripe-payment.ts`, `src/reservations/create-departure-payment-intent.ts`). A raw
  PaymentIntent has no line item, so the dashboard's payments list was bare dollar amounts.
- `Payment.receiptUrl` + `PaymentPort.getReceiptUrl`, captured best-effort in the webhook and
  rendered as "View Stripe receipt" on `/b/<code>`. Stored, not fetched at render — that page is a
  guest-facing GET. Migration `db/migrations/20260820151500_payment_receipt_url.sql` (additive).
- **Removed the marketing opt-in checkbox.** `SPEC.md:641` puts marketing deliberately out of
  scope, it's absent from `docs/design/mockups/booking-form.html`, and it arrived in `58e314b` with
  the checkout screen rather than as a decision. It was collecting consent nothing stored.
- Field-level helper text, so "no email" stops silently meaning "no receipt". Tip helper copy
  rewritten (`fee'd` isn't a word; the tax treatment is internal accounting, not a guest's question).

**Scope that was cut, and why:** issue #678's Stripe-Customer half (a `stripeCustomerId` column,
`ensureCustomer`, phone-derived idempotency key, both repo adapters) was **built and then reverted
uncommitted**. It buys Stripe-side customer coherence, which the operator explicitly does not need —
what's wanted is customer → purchases → Stripe transaction, and the first two links already exist
(`/admin/customers/[customerId]` shows history and links each booking to its money view).

**Code review:** 1 finding — the tip-copy rewrite is undisclosed scope in the commit (recorded in
the PR body rather than re-committed). Money path, idempotency, receipt-absence handling and the
no-dashboard-link rule all verified clean.
**Security review:** ran on the money-moving blast-radius trigger. **0 findings at confidence ≥ 8.**
Traced and ruled out: `receiptUrl`→`href` provenance (only writer is the signature-verified
webhook), capability-URL leak via `Referer` (the anchor carries `rel="noopener noreferrer"`),
cross-booking payment leak, new PII exposure (the same values already went in metadata), webhook
fail-open, and SQLi on the new column.
**PR:** [PR #795](https://github.com/mobiustripper42/muster/pull/795)
**Points:** 5
**Branch:** task/678-create-stripe-customers
**Opened at:** 2026-08-20T22:05:00Z

## Task 2: Stop /book scanning every checkout hold, and sweep the expired ones (issue #713)

**Completed:**
- **The issue's own acceptance needed both of its options, not just the recommended one.** It calls
  filtering "the obvious first move", but the AC also demands expired holds stop accumulating —
  which filtering does nothing about. The sweep turned out nearly free: `acquireCheckoutHold`
  already deleted expired rows inside an open transaction, scoped to the acquiring slot. Dropping
  that scope IS the sweep, and an acquire is the only moment one can run (DEC-109 chose lazy
  expiry so there'd be no cron — right for correctness, silent about volume).
- `listLiveCheckoutHolds(asOf)` on the port + both adapters; `listCheckoutHolds()` kept as the raw
  read. **Two methods deliberately:** the delete assertions must see rows that ARE present but
  expired, or a broken sweep looks identical to a working filter.
- Widened `DELETE` in both adapters (`src/adapters/postgres-repository.ts`,
  `src/adapters/in-memory-repository.ts`). Safe because expiry is a global fact — an expired hold
  is already inert everywhere.
- `db/migrations/20260820230000_checkout_holds_expires_at_idx.sql` — `(source, expires_at)`.
- Both callers pass one instant; `app/(public)/book/page.tsx` now hands the SAME one to the
  deriver instead of minting a second `new Date()`. The deriver's own liveness check stays.

**Code review:** 1 finding, fixed — a leftover JSDoc still calling `listCheckoutHolds()` "the ONLY
sanctioned raw read". Fixing it surfaced the same defect one declaration higher, on
`acquireCheckoutHold`'s contract (still described the delete as slot-scoped); that one the review
did NOT catch and is the more load-bearing of the two.
**Security review:** not run — no blast-radius trigger. None of the 7 files match a path row and the
migration is `create index` only. **Recorded because it's close:** I first called this the money
path and that was wrong. A mistake in the widened DELETE causes a double-hold, which the DEC-109
write CAS rejects and auto-refunds — a reliability failure with a money-shaped consequence, not a
money change. Nothing to add to the trigger table.
**Proof, honestly:** 3 contract cases written first; two failed for the expected reason. The third
(sweep must not touch a LIVE hold on another slot) **passed before the change** — a regression guard
on the widened predicate, not evidence the widening works.
**PR:** [PR #798](https://github.com/mobiustripper42/muster/pull/798)
**Points:** 2
**Branch:** task/713-prune-checkout-holds
**Opened at:** 2026-08-21T04:05:00Z

## Task 3: Reject off-grid checkout holds — close the invisible-lockout variant of issue #799 (closes #799)

**Completed:**
- **Origin: a manual DoS probe this session that became real.** Proved an unauthenticated scripted
  request can drive `startElementsCheckout` (server action → `acquireDepartureHold`) with no
  browser, no card, no cookie — demonstrated end to end via copy-as-cURL (`ok:true` + a new
  `checkout_holds` row on a free slot; `sold_out` on a held one, proving the full pipeline ran).
  Filed as issue #799, then a second adversarial DoS review (attached to the session) expanded it
  and found the **invisible variant** below. All findings verified against source before filing.
- **The fix (highest-value slice):** `isOnScheduleGrid(schedule, date, time)` in
  `src/reservations/availability.ts` — round-tripping date, in season, allowed weekday, listed
  departure time; pure and total. `acquireDepartureHold` (`src/reservations/claim.ts`) rejects
  off-grid with a new `off_schedule` reason before any read/write. Threaded through
  `create-departure-payment-intent.ts` (replacing a hand-rolled reason chain) and the checkout
  action's message map.
- **Why it matters:** an off-grid hold (`13:31`) overlaps the real `13:30` in the claim path's
  interval math while the deriver keys holds on EXACT identity — so `/book` showed `13:30`
  available while every real checkout returned `sold_out`. Grid-validation makes the deriver's
  exact-identity match correct by construction — the two now agree.
- **Scope split, per two build-time gotchas:** #806 (per-session cap + require-token — blocked on
  Next RSC pages not being able to set a cookie during render), #807 (Stripe idempotency key —
  must fold the amount in or a tip-changed retry 400s). Both filed.

**Also filed this session from the two reviews (not worked):** #793 (delete dead hosted-checkout
path whose tests assert totals we don't charge), #794 (checkout 375/900 layout + price-before-card),
#800 (/b/find throttle keyed on attacker text → full-table scans, HIGH), #801 (login window locks
out the correct code, HIGH), #802 (unbounded-reads bundle, tracking).

**Code review:** 2 findings, both non-blocking edges about callers that don't exist yet. (1)
`isOnScheduleGrid` doesn't admit a materialized off-grid override event — not a live bug (customer
path never targets one), addressed with a comment flagging sell-from-calendar (12.11). (2) the dead
`create-departure-checkout.ts` still mis-maps `off_schedule` → `invalid_guest_count` — safe
(returns `ok:false`, no hold, no charge), left for #793's deletion rather than churn dead code.
**Security review:** ran (money-moving trigger — `create-departure-payment-intent.ts`). **0 findings
≥ 8.** Battery-tested `isOnScheduleGrid` against whitespace/unicode/timezone/rollover inputs (all
rejected); confirmed no unguarded hold-write path, no PI bypass, no control-flow change.
**PR:** [PR #808](https://github.com/mobiustripper42/muster/pull/808)
**Points:** 2
**Branch:** task/799-cap-checkout-holds
**Opened at:** 2026-08-21T14:15:00Z

## Task 4: Login window gates guesses, not the correct code (closes #801)

**Completed:**
- **The bug:** `verifyLoginCode`'s per-subject failure window (50/24h) gated the atomic claim
  AHEAD of the code-hash compare, so once the window filled `claimLoginAttempt` returned null and
  the function returned generic `invalid` before checking the code — a legitimate crew member
  holding the CORRECT code got locked out for 24h. ~60 requests on a guessable roster email (the
  operator is crew, DEC-092) burns and re-locks it daily. DEC-142's own "revisit if a real crew
  member is locked out" clause, due.
- **The fix:** the presented code's hash goes into `claimLoginAttempt` (`src/ports/repository.ts`
  + both adapters). A matching hash bypasses the WINDOW bound and leaves the counter untouched (a
  success is not a failure). Wrong guesses never match → brute force still capped at 50/day. The
  per-code `attempts < MAX_ATTEMPTS` ceiling stays an independent AND (DEC-081). One row-locked
  statement, both adapters — race-safe, double agrees.
- `src/auth/login-code.ts` computes the hash before the claim and passes it in. DEC-142 amendment.
  Flipped the pre-existing "correct code at cap is refused" test to `ok:true` + new unit/contract
  parity cases. Added `src/auth/**` to the Auth blast-radius row in `.claude/CLAUDE-context.md`
  (it was missing — same gap the doc flags for `refund-payment.ts`).

**Code review:** 0 findings — clean bill of health; adapter parity + race-safety verified against
both adapters via the shared contract suite.
**Security review:** ran (auth trigger, `src/auth/**`). **0 findings.** Probed the correct-code
bypass (unforgeable sha256, bound `$7`, no injection), the moved-hash timing (no new roster oracle
— unknown email still short-circuits before hashing), and confirmed expiry / consume-CAS /
per-code-cap all still enforced for a correct code. No new bypass, no new lockout.
**PR:** [PR #810](https://github.com/mobiustripper42/muster/pull/810)
**Points:** 3
**Branch:** task/801-login-window-gate-order
**Opened at:** 2026-08-21T16:05:00Z

**Next Steps:**

**Context:**
- **Concurrent with session 90**, which holds the main checkout `/home/eric/muster` (last seen on
  `task/724-cancel-reason`). This session runs in the linked worktree `/home/eric/muster-s91`,
  cut from `main` at `6c19a05`.
- Branch was cut as `task/679-…` by typo and renamed to `task/678-create-stripe-customers` at open
  (zero commits, never on origin). The session file was renamed to match. Issue #679 is a separate
  task (send our form's contact details to Stripe).
- Both sessions share the one `sessions` branch worktree at `/home/eric/muster/.sessions-worktree`,
  because a branch can only be checked out once. `/kill-this` and `/its-dead` in either window
  `reset --hard` it — so the two must not run at the same moment.
- **`/security-review` reads the shell's cwd, not the session's branch** — run it from inside
  `/home/eric/muster-s91`, never from the main checkout (session 89 finding).
- Drift vs seeds at open: 5 `logic`-class files differ (the five session skills). seeds-version 5
  on both sides. Not acted on.
