---
session: 82
dev: eric
slug: 616-cancel-and-refund
branch: task/616-cancel-and-refund
started: 2026-08-11T01:27:14Z
ended:
points:
pr_numbers: [733, 734]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/e09c3178-c206-4232-92e5-d68538c4d699.jsonl
---

# Session 82 — 616-cancel-and-refund

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The cutover import is this season's forward book, not all of Xola's history

**Completed:**
- Cleared PR #727's CI (transient Google Fonts fetch failure in `next/font/google`, not the diff —
  same branch green two hours earlier, `main` green, local `verify` green on the identical commit).
  Re-run passed; #616 merged. Filed **issue #731** to self-host IBM Plex, since every CI *and*
  production build currently depends on `fonts.gstatic.com` being reachable.
- `docs/decisions/DEC-126-*.md` §1 narrowed from "full import of ALL Xola reservations" to this
  season's forward book (~47 records); its `amends_spec` on SPEC §4 rewritten so the read-only
  archive posture stands for pre-2026. **issue #728 closed** as not-planned; **issues #467 / #468**
  commented with the narrowed scope. issue #729 explicitly NOT affected — a range problem, not a
  volume problem, and still a possible blocker on #467.

**Shipped by hand — `/kill-this` was not run for this one** (operator's call, docs-only), so this
block was written retroactively during Task 2's `/kill-this`. `@code-review` therefore never read
the diff. Recorded here because a shipped PR with no session block is exactly issue #661.

**I wrote this as a new decision first (DEC-154) and was wrong to.** The operator's objection was
that it spread one decision across three files — DEC-154, DEC-126's generated banner, the index row.
The repo has two mechanisms and the discriminator is written nowhere except inside the two existing
in-body corrections: *"a defect, not a change of mind"* (DEC-082). This was a change of mind, which
is nominally the new-file case — but **nothing is built against DEC-126**, so there was no shipped
rationale for an append-only record to protect. Editing in place was right and DEC-154 was deleted.
The append-only argument earns its cost once a decision governs shipped code, not before.

**Then I compounded it.** Asked "if I change my mind again, do you add DEC-159?", I led the reply
with the bare word "Yes" — literal answer to a rhetorical question — then wrote paragraphs arguing I
hadn't meant yes. The position had been consistent; the framing inverted it, and defending the
framing was worse than the original error.

**Code review:** not run — shipped by hand, docs only.
**PR:** [PR #733](https://github.com/mobiustripper42/muster/pull/733)
**Points:** 2
**Branch:** task/dec-126-import-scope
**Opened at:** 2026-08-11T13:05:00Z

## Task 2: The balance is due before your trip, not charged before it (issue #617)

**Completed:**
- `app/reservations/manage/page.tsx` and `app/(public)/book/checkout/checkout-form.tsx` — the
  balance label no longer promises an automatic charge. New e2e in `e2e/book-manage.spec.ts:52`,
  written first and **observed failing on both widths** for the intended reason;
  `e2e/book-checkout.spec.ts:61` had been pinning the false copy and now pins the true one.
- `payment.deposit_mode = full` set in **production** (operator) and local dev. That is issue #617's
  actual acceptance criterion — the posture is *set*, not inherited from `PAYMENT_CONFIG_DEFAULTS`
  (25% deposit), which is what production would otherwise have gone live on.
- `npm run verify` green: 2072 unit tests / 148 files, all three doc gates, both typechecks, lint,
  build. 28 e2e passed across the two touched specs, desktop + 375px.

**The false claim was in two places, and issue #617 only named one.** The checkout summary said it
too — before the customer commits, which is the worse place to promise it. Found by grepping the
string rather than trusting the issue's file list.

**The operator's deposit is $100 flat, and the model cannot express it.** `payment-config.ts` holds
an integer percent. Recorded at `docs/FUTURE_IDEAS.md:240` as the go-live requirement ($100/booking
beyond 30 days, auto-collect at 7 days) and carried by issue #712. Deferred to spring on the
operator's own timing: go-live ~Sept 1, season ends Oct 15, so a deposit buys no float in a
six-week window and would mean manual balance-chasing through the busiest weeks.

**The manage-page label has no by-hand verification step and the PR says so.** `/reservations/manage`
needs an HMAC capability link and there is no way to mint one — that is issue #686 exactly. The e2e
mints its own; the PR states the gap rather than writing an unrunnable step.

**Code review:** Clean — 0 findings. It confirmed the new e2e isn't vacuous (the sibling test proves
the $588.80 balance row actually renders) and that the checkout spec swap didn't weaken an assertion.
**Security review:** not run — no blast-radius trigger; UI-only work is an explicit non-trigger in
`.claude/CLAUDE-context.md`.
**PR:** [PR #734](https://github.com/mobiustripper42/muster/pull/734)
**Points:** 2
**Branch:** task/617-launch-money-posture
**Opened at:** 2026-08-11T14:40:00Z

**Next Steps:**

**Context:**
