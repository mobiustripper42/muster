---
session: 82
dev: eric
slug: 616-cancel-and-refund
branch: task/616-cancel-and-refund
started: 2026-08-11T01:27:14Z
ended: 2026-08-14T03:33:28Z
points: 10
pr_numbers: [733, 734, 735, 737]
status: closed
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

## Task 3: The Xola passenger report mails itself every morning

**Completed:**
- `db/xola-report-email.ts` + `db/xola-report-email.test.ts` (new, 26 cases) + `db:xola:report:email`.
  Spawns the existing report unchanged, captures both streams SEPARATELY (merging as they arrive
  makes section order depend on how the OS interleaves two pipes), hoists `OVER CAPACITY` and
  `DECLARED ≠ PAID` above the diagnostics, sends via Resend. Cron line on mill-dev at 11:00.
- `db/xola-report.ts` — one-line fix to its own flagged count.
- `npm run verify` green (2098 tests / 149 files). Run live against Xola at every step; three real
  sends to eric@brewcle.com only. Deliberately temporary — dies at the DEC-126 cutover.

**Three counting bugs, all the same shape: technically true, practically noise.** The report
counted `flags !== "cancelled"` — a string compare asking whether a row's ONLY flag was the word
cancelled — so a cancelled row carrying a second flag sat in the headline while every section
excluded it (17 → 16 live, and 16 now reconciles with the sections). My wrapper then scraped
`N event(s) STILL have no boat` and called them unaudited ROWS; events and rows differ by exactly
the cancelled trips whose events are gone BECAUSE they were cancelled, so it put a red ⚠ on three
trips nobody is sailing. And the subject said `17 flagged of 49` on a morning whose only real item
was one payment to chase — 15 of the 17 were guests who had paid and fit the boat.

**The operator caught all three, and none of them by reading code.** *"why does it say 17 flagged
of 49?"* and *"how can I find out what those 3 rows are?"* — the second question is what exposed
that the three unaudited events were all status-700 cancellations. The report's own source comment
had said so all along; I had not read it before writing the warning.

**He also corrected my framing of issue #729.** I wrote a header line implying the report only
covers a 3-week window. It pulls orders across two years — only the bulk `/events` boat-join call
is narrow, and the script already routes around it with individual fetches. The residual damage is
a handful of 404s, not the coverage. The misleading sentence is gone; #729's own issue text carries
the same overstatement and should be re-scoped.

**`@code-review` found the fourth, and it was mine:** the ⚠ went into the body but never into the
subject, so an unresolved-boat morning with nothing else would read "nothing to act on" on a locked
phone — the exact failure the file exists to prevent. Its sharper finding was structural: the
section titles are a string contract across two files, `db/` is in no typecheck or lint, and a
FIXTURE CANNOT CATCH A DRIFT — reword the title, update the fixture, still green. The test now reads
the real source.

**Code review:** 3 findings (1 bug, 1 missing-guard, 1 consistency), all fixed before the PR.
**Security review:** not run — no blast-radius trigger; a read-only `db/` script, no money path, no
auth, no migration.
**PR:** [PR #735](https://github.com/mobiustripper42/muster/pull/735)
**Points:** 3
**Branch:** task/xola-daily-report-email
**Opened at:** 2026-08-11T23:55:00Z

## Task 4: The resend says which channels it reached, and dev gets a copyable manage link (issue #686)

**Completed:**
- `src/reservations/resend-booking-link.ts` (new, 10 tests, test-first) — per-channel resend with
  `sent` / `failed` / `absent` kept apart; `app/lib/booking-confirmation.ts` gains
  `resendReservationLink`; the pane action maps outcomes to redirect codes and `actionMessage`
  renders them.
- `app/lib/manage-link.ts` (new, 6 tests) — the off-production gate on a **Copy manage link**
  control, plus the block in the detail pane.
- `vitest.config.ts` gains the `@core` alias `tsconfig.json` already has.
- `npm run verify` green (2124 tests / 152 files); `e2e/calendar.spec.ts` 42 passed, both widths.

**Half the issue had already shipped and the issue did not know.** `resendConfirmation` landed with
issue #616 — button, codes, Xola/cancelled refusals. Built as written, this would have added a
SECOND button doing the same job. Found by reading the pane before writing, not after; the core
module was already written by then, and it wired into the existing action instead.

**The suite had been printing a lie every run since #616.** The e2e blanks Twilio and the seed
booking is phone-only, so `resent=1` → "Confirmation and manage link sent again." over a deployment
that sent nothing. `sendReservationConfirmation` returns `void` — correct inside the Stripe webhook,
where a throw makes Stripe retry the event, and wrong behind a button someone is standing at.

**My first cut reproduced the bug in a new place** — both channels `absent` still read "Link sent
again." The new e2e caught it on its first run. Nothing out is never a success.

**I cited DEC-026 for "codes not prose", twice, in a file whose DEC banner says ~34 comments make
exactly that mistake and asks for correction as files are touched.** Caught by `@code-review`. It is
DEC-147. A cited fact that is wrong is worse than an uncited one.

**Playwright's strict mode caught a real ambiguity**, not just a test collision: two buttons in one
pane both labelled "Copy link", carrying a Stripe checkout URL and a capability token. Renamed.

**The copy link's gate cannot be e2e'd and the PR says so.** `E2E_PROD` defaults to `!CI`, so the
suite is production-like locally and dev-like in CI — a spec asserting either direction passes in
one place and fails in the other. Unit-tested pure function instead, the same route
`app/lib/time-clock-gate.test.ts` took for its own gate. The PR's hand section carries the
`next start` step no automated test here can perform.

**Code review:** 4 findings (1 bug — the only unguarded core call in the file; 1 wrong DEC citation;
1 half-truthful `absent`; 1 test-convention cleanup), all fixed in `fb04c77`.
**Security review:** run — capability-URL token minting is a blast-radius trigger by the generic
test even though no project path matches literally. 0 findings at confidence ≥ 8; it verified the
gate returns before the token is derived, the URL never reaches a redirect param or a referrer, and
the refusals still short-circuit.
**PR:** [PR #737](https://github.com/mobiustripper42/muster/pull/737)
**Points:** 3
**Branch:** task/686-resend-and-copy-link
**Opened at:** 2026-08-12T03:35:00Z

**Next Steps:**
- **Everything merged** — PRs #733, #734, #735, #737, #739 (plus #732 and #738 from other windows).
  Nothing left open.
- **issue #741 is time-boxed and should go before go-live (~Sept 1).** Booking links become a
  14-character short code instead of a 129-character HMAC URL. It is free *right now* because
  `RESERVATION_LINK_SECRET` is not set in production, so not one link exists in any customer's
  inbox. After go-live it needs dual verification and a reissue path. Entropy decided at 14
  Crockford base32 chars (~70 bits) — recorded in the issue with the guessing table, not open to
  re-litigation downward.
- **issue #740** — the "your shift changed" SMS says nothing about what changed, and the diff that
  triggered it is discarded at `src/builder/form-shifts.ts:448`. First move is keeping the diff.
- **issue #742** — two flaky e2e specs, sighted on two unrelated branches.
- **issue #731** — self-host IBM Plex; every CI *and* production build currently depends on
  `fonts.gstatic.com` being reachable. It already cost one red build this session.
- Remaining go-live prep: **issue #623** (runbook), **issue #545** (audit the live Vercel env — now
  has something to audit against), **issue #544** (verify the Stripe endpoint subscribes to
  `payment_intent.succeeded`, and add `charge.refunded` while in there — both fail silently).
- **PR #739 shipped without `/kill-this`**, so `@code-review` never read it and it has no `## Task`
  block. Operator's call, recorded here so the gap is visible rather than inferred (issue #661).

**Context:**
- **The daily Xola report is live on cron** — 11:00 on mill-dev, `db:xola:report:email`. Temporary;
  dies at the DEC-126 cutover. The box never sleeps, so there is no uptime gap.
- **An unterminated quote in an env file is not a syntax error.** Node's parser swallows the rest of
  the file into the value. That is how the first real cron morning failed: `XOLA_REPORT_TO` became
  one 397-character "address" carrying `STRIPE_SECRET_KEY`, and Resend rejected the whole send. The
  test-mode key is exposed in `/home/eric/muster-xola-report.log`; operator may rotate.
- **`.env.example` is now `env.example`** (PR #738) so each tool's deny list can be a blanket
  `.env*`. Side effect: the template is readable to tooling again, so the next change to it does not
  have to go through the operator.
- **A number that is technically true and practically noise is a bug.** Four of them this session,
  same shape: `17 flagged of 49` on a morning with one real item; a ⚠ on three cancelled trips; a
  cancelled row counted in a headline and excluded from every section; a green "sent again" over a
  deployment that sent nothing. Each one trains someone to stop reading the thing.
- **Assert the property, not the copy of whichever branch your machine takes.** The one genuine CI
  failure this session was an e2e pinning an exact string that differs by deployment config — passed
  locally, failed in CI. `APP_BASE_URL= npm run test:e2e` reproduces CI's env shape locally.
- **The operator caught three defects by reading output, not code** — the "17 flagged" question, "how
  do I find those 3 rows", and the link length. Two of the three exposed real bugs underneath.
- **Verify a live-state claim in the same turn, even from a well-written issue.** issue #618 said
  `grep -ci stripe docs/DEPLOY.md` → 0; it was 10. issue #686 described building a resend that had
  already shipped with #616. Both issues were right when filed.
- **Prettier was considered and declined.** The case for it rested on a citation-invalidation cost
  that turned out not to exist (12 live line-number citations, not ~875 — the rest are in a dated
  audit snapshot) and on a format-drift claim that was never measured. Do not re-litigate without a
  churn number from `prettier --check` at a matched `printWidth`.
- **`npx` auto-installs.** A prior session ran `npx prettier --write` bundled into a typecheck
  command — no deliberation, a package pulled off the network, a file rewritten. The permissions gap
  that allowed it is closed (PR #732).
