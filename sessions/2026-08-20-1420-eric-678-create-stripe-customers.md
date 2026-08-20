---
session: 91
dev: eric
slug: 678-create-stripe-customers
branch: task/678-create-stripe-customers
started: 2026-08-20T14:20:24Z
ended:
points:
pr_numbers: [795]
status: open
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
