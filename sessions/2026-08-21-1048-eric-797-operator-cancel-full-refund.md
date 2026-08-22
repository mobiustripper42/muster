---
session: 92
dev: eric
slug: 797-operator-cancel-full-refund
branch: task/724-cancel-reason
started: 2026-08-21T10:48:33Z
ended: 2026-08-22T02:59:09Z
points: 6
pr_numbers: [805, 809, 811]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/ad732f7c-4a21-5916-8cd9-6e3016d9ae4b.jsonl
---

# Session 92 — 797-operator-cancel-full-refund

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: A full refund is the whole payment, not the fare (issue #797)

**Session file:** `2026-08-21-1048-eric-797-operator-cancel-full-refund.md` (session 92) — this window
opened it; session 91 was the other open candidate and is concurrent in `/home/eric/muster-s91`.

**Completed:**
- `src/reservations/cancel-reservation.ts` — `refundableCents` deleted. Both policies compute from
  `refundableTotalFor`, the same base the refund cap already enforced, so on the operator branch the
  quote and the Stripe ceiling are one number.
- `src/reservations/refund-terms.ts`, `refund-payment.ts` — three docstrings that described the
  carve-out, including `operatorCancelRefundCents`'s, which was correct about the policy while
  describing an input it never received.
- `src/reservations/cancel-reservation.test.ts` — the test asserting the carve-out deleted; both rule
  tests re-fixtured onto a payment carrying a tip and a fee.
- `src/reservations/seed-reservation.ts` + `db/seed-reservation-dev.ts` — the seed's **season** starts
  today (the window, bookings and block fixtures are unchanged), so a booking can be made inside the
  14-day cancellation window at all.
- `docs/decisions/DEC-153` — amendment. `.claude/CLAUDE-context.md` — two paths added to the
  money-moving blast-radius row.

**The thing worth remembering:** the operator's answer to a design question was not a preference. Four
exchanges went into whether the tip was crew money and whether the service fee was defensible to keep
— and the published policy already said, in one sentence, that a full refund is a full refund. The
carve-out was never a decision anyone made about the operator branch; it was a decision about the
customer branch that leaked. Reading the policy text *first* would have skipped every one of those
turns, and the operator said so directly.

**DEC-153 was wrong when written, not narrowed by this change.** Nine lines below the carve-out
bullet it records `operatorCancelRefundCents` as "everything, at any notice", and SPEC.md §3.3 step 2
agrees. The two could never both be true of one screen, and `refundableCents` was the faithful
implementation of the wrong one. Amended in place — no new id, and no SPEC edit, because every refund
mention in SPEC already matched the three rules.

**Why the test never caught it:** the fixture `payment()` carries no `gratuityCents` and no
`serviceFeeCents`, so a test titled *"an OPERATOR cancellation refunds everything"* was structurally
unable to tell a full refund from a fare-only one. It passed for months. The two new tests were
watched failing first — the operator case returned **62098**, the reported $620.98 to the cent.

**Deliberate breakage, tracked:** widening the season costs `/book`'s default month its emptiness,
which `e2e/book-availability.spec.ts:233` builds its forward-paging test on. Filed as issue #804 and
marked in the file, **left failing rather than skipped** — `npm run verify` does not run e2e, so a
skip would have made it nobody's problem. `@code-review` caught that it had no tracking issue when it
existed only as a code comment.

**Code review:** 2 findings, both fixed — a stale e2e header, and the untracked break above.
**Security review:** ran on the money-moving trigger. **0 findings at confidence ≥ 8.** Traced and
ruled out: the blank-box path exceeding the refund cap (the operator quote *is* the cap, recomputed
under the lease), the `expectedRefunded` CAS, confirm-screen/server divergence, status handling in
`refundableTotalFor` vs the deleted function, and the dev seed's local-DB guard.

**Also this task:** filed issue #803 — a cancelled booking still shows the guest "Balance · due before
your trip $575.32", because `balanceOwedCents` has no idea the trip was cancelled and the row is gated
only on `> 0`. Found by the operator reviewing this fix. Display-only, no CTA, so no money can move.

**PR:** [PR #805](https://github.com/mobiustripper42/muster/pull/805)
**Points:** 3
**Branch:** task/797-operator-cancel-full-refund
**Opened at:** 2026-08-21T16:31:00Z

## Task 2: A cancelled booking owes nothing (issue #803)

**Completed:**
- `src/reservations/payment-config.ts` — `balanceDueCents`: `balanceOwedCents`, except a non-`booked`
  reservation returns 0.
- `src/reservations/calendar-detail.ts` — the shared money composer switches to it, which fixes the
  admin pane and, via `buildManageView`, the guest page in one place.
- `src/reservations/purchases-view.ts` — stops the "$X due" chip on a cancelled row.
- `src/reservations/manage-view.ts` — `paidInFull` also requires `paidCents > 0` (review finding).
- Three test files; the admin pane got a comment correction only.

**Found by the operator reviewing Task 1**, on the guest page he was checking the refund fix on.

**The seam was the interesting decision.** `balanceOwedCents` does NOT learn about status. Both
non-presentation callers already refuse a cancelled reservation before reaching it, so folding it in
would be dead code — and one of them is the webhook's overpay guard, a caller that wants the raw
arithmetic and nothing else. My first commit message claimed a zero there would suppress a live
alert; `@code-review` established that branch is unreachable, and the docstring was corrected to the
reason that survives being checked. Worth remembering as a shape: the rationale was *directionally*
right and *factually* wrong, and it would have been shipped as a durable comment.

**The review earned its keep on the second thing, which it wasn't asked for.** Verifying the change,
it traced the render path and found the trap the fix opened: a fully refunded payment row is
`refunded`, which `countsAsPaid` excludes, so `paidCents` is 0 — and with the balance now also 0 the
guest page's headline read **"Paid in full $0.00"** above "Refunded −$758.49". That is the ordinary
end state of an operator cancel (Task 1's own path), not an edge case. Neither my three failing tests
nor the operator's approval of the "Paid in full" label would have caught it, because both were
reasoning about the *partially* refunded case.

**Code review:** 1 filed finding (a fixture stubbed wholesale instead of spread), fixed — plus the
`$0.00` defect above, found while verifying.
**Security review:** ran on the money-moving trigger (`payment-config.ts`). **0 findings at
confidence ≥ 8.** Traced and ruled out: no writer or charge path reads the zeroed balance
(`createBalanceCheckout` and the webhook both still call `balanceOwedCents` and both still refuse
non-`booked`); `paidInFull` gates copy only, and every capability on `/b/<code>` is gated elsewhere;
no aggregate on `/admin/purchases` that a zeroed row could launder.

**Left for the operator's eye, not guessed at:** the fully-refunded case now reads "Paid so far
$0.00", which is accurate but not lovely. Different copy for that state would be its own issue.

**PR:** [PR #809](https://github.com/mobiustripper42/muster/pull/809)
**Points:** 2
**Branch:** task/803-cancelled-owes-nothing
**Opened at:** 2026-08-21T19:35:00Z

## Task 3: The paging test was never broken (issue #804)

**Completed:**
- `e2e/book-availability.spec.ts` — removed the `KNOWN BROKEN` block Task 1 added; kept the true
  half of the header note (season ≠ window).
- `src/reservations/seed-reservation.ts` and its drift test — the same false claim, twice more.
- Issue #804 closed as not-planned, with the explanation in a comment.
- Comments only: no assertion, no fixture value, no behaviour.

**This task exists because Task 1 shipped a confident, wrong claim to `main`.** I asserted the
season widening broke `/book`'s forward-paging e2e, marked the test KNOWN BROKEN, filed an issue for
it, and repeated it in two more comments. The test asserts a prompt gated on **no date selected**
(`app/(public)/book/page.tsx:490`, the else-branch of the slot list) and a month **label** one page
ahead — neither depends on the current month being empty. `e2e` was green on the very branch that
widened the season (PR #805, 25m47s).

**The mechanism, worth remembering:** I read the test's *title and comments* — "an empty month
prompts a date pick" — and never read the line that does the asserting or the component behind it.
Everything downstream inherited it: a code comment, a filed issue, a PR body, a session-file entry,
and the operator's expectation. Cheap to check, and I did not check.

**It also survived a review.** Task 1's `@code-review` flagged that the break had no tracking issue —
treating the break as real, because I had asserted it. A review verifies the diff against what you
tell it; it does not re-derive the premise unless asked. Task 3's review was asked explicitly to
distrust my framing, and re-derived every claim from source.

**Code review:** 2 findings, both fixed — issue #804 still open carrying the disproven diagnosis, and
an unfalsifiable clause ("the only way to get this wrong") sitting among checkable ones, replaced
with the CI run it rests on.
**Security review:** not run — no blast-radius trigger (an e2e spec and a dev-seed builder).

**Also this task:** merged PR #809 after CI went green (squash, 19:56Z), closing issue #803.

**One process note:** I wrote "PR #810" into the issue comment before creating the PR, which came
back #811. Corrected. Same class as the memory that says never to pre-reserve a number.

**PR:** [PR #811](https://github.com/mobiustripper42/muster/pull/811)
**Points:** 1
**Branch:** task/804-paging-test-not-broken
**Opened at:** 2026-08-21T20:04:00Z

**Next Steps:**

- **issue #800** — `/b/find` recovery throttle keyed on attacker-chosen text; two full-table reads
  per request (5 pts, high). **Specced but not started, and it has a fork that needs a prod answer
  before a line is written.** SQL should narrow by contact; `matchBookingForRecovery`'s name check,
  cancelled-vs-live preference and soonest-upcoming ordering all stay in JS over a small candidate
  set — nothing about no-enumeration moves.
  - Email path is easy: index on `lower(email)`, one indexed lookup.
  - **Phone path is the fork.** `reservations.phone` is stored raw and both sides get canonicalized
    in JS, so no plain index serves it. **(A)** route through `customers` — `customers.phone_e164`
    is already UNIQUE-indexed and IS the identity key (DEC-132), `reservations.customer_id` is
    indexed, so it's two indexed lookups with no new normalization logic to keep in sync with
    `canonicalizePhone`. **(B)** a canonical phone column on `reservations`, backfilled and indexed.
  - **The gate between them:** `select count(*) from reservations where source='muster' and
    customer_id is null` **against prod**. Zero ⇒ (A). Non-zero ⇒ (A) silently makes those bookings
    unrecoverable by phone, so (B).
  - Unconditional either way: `recovery_throttle (cooldown_until)` index, and the three false
    comments the issue names — including `recover-booking-link.ts:64-68`, "taking a thunk makes it
    true," which is the same shape of wrong claim Task 3 spent a PR removing.
  - **Merge dependency:** it adds port methods, so it touches `src/ports/repository.ts`, both
    adapters and `repository-contract.ts` — the same four files PR #810 did. That merged, so a
    branch off `main` is now clean.
- **issue #773** — checkout fails silently; a thrown server action re-enables Pay and tells the
  customer nothing (3 pts, high). The best independent customer-facing one; cold start.
- **A copy question left open, deliberately:** a fully refunded cancelled booking now reads "Paid
  so far $0.00" on `/b/<code>`. Accurate, not lovely. Its own issue if it bothers anyone.

**Context:**
- **Concurrent with session 91**, which is live in the linked worktree `/home/eric/muster-s91` on
  `task/713-prune-checkout-holds` (PR #798 open). This session holds the main checkout
  `/home/eric/muster`. Both share the one `.sessions-worktree`, and `/kill-this` and `/its-dead`
  `reset --hard` it — the two windows must not run either at the same moment.
- **Session 90 was closed from this window** at 2026-08-21T10:51:34Z, not from its own; it had
  ended without running `/its-dead`. 15 points, PRs #782/#786/#787/#796 all merged.
- **Anchor branch is stale.** `task/724-cancel-reason` is session 90's Task 3 branch, already merged
  as PR #787. It is where the checkout happened to sit, not a working branch. The issue #797 branch
  gets cut from a freshly pulled `main`, which no worktree currently holds.
- **`slug` is named for the task, not the anchor branch** (`/its-alive` Step 3 would have derived
  `724-cancel-reason`), because a session file named after a merged task reads as that task's log at
  retro time. Same correction session 91 made by hand.
- **Uncommitted in the main checkout at open:** `.claude/skills/kill-this/SKILL.md`, +39/−3 — a
  rewrite of the multi-open-session guard plus a new `/security-review` wrong-tree warning. Origin
  unknown to this window; seeds-managed, so per DEC-S039/S040 it is not fixed here. Untouched.
- **Four PRs from session 90's window belong to no session file** and so never passed `@code-review`:
  #784 (`task/adopt-step0-fix`), #789 (`task/adopt-kill-this-204`), #790
  (`task/no-open-pr-ceiling`), #792 (`task/adopt-dec-s048`). All seeds-adoption branches, all
  already merged. Recorded, not actioned.
- Drift vs seeds at open: 5 `logic`-class files differ (the five session skills); `seeds-version` 5
  on both sides. Not acted on.
- `transcript:` is `/its-alive` Step 5's newest-file guess. A second JSONL in the same project dir
  (`8bcf9ecc…`) was written to one minute before this session opened, so the guess is weaker than
  usual here.

### Recorded at close

- **The session's own lesson, across two tasks: read the assertion, not the title.** Task 1 declared
  an e2e broken from its name and comments; Task 3 existed only to undo that. The same habit had
  already produced the defect Task 1 was fixing — a test called "an OPERATOR cancellation refunds
  everything" that could not tell a full refund from a fare-only one, because its fixture carried no
  tip. Both cost more than the read would have.
- **Reviews verify the diff, not the premise.** Task 1's `@code-review` saw the false "known broken"
  claim and filed a finding that it *lacked a tracking issue* — treating it as real, because it was
  asserted. Task 3's review was told explicitly to distrust the framing and re-derived everything
  from source. Ask for that when the claim is load-bearing.
- **The operator's answer was in the published policy the whole time.** #797 took four exchanges
  about whether the tip was crew money and whether the service fee was defensible to keep, and the
  operator's terms already said "a full refund" in one sentence. Read the source text before
  reasoning about the design.
- **Two windows shared this checkout.** `/home/eric/muster` moved between branches under this
  session more than once, and `/home/eric/muster-s91` ended up holding `task/803-…`. Nothing was
  lost, but the "changed on disk" notices were branch switches, not edits, and cost time to
  reconcile twice.
- Session-open scan flagged an uncommitted `.claude/skills/kill-this/SKILL.md` (+39/−3) that had
  vanished by the first branch switch. Never explained. Not mine.
