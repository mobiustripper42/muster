---
session: 92
dev: eric
slug: 797-operator-cancel-full-refund
branch: task/724-cancel-reason
started: 2026-08-21T10:48:33Z
ended:
points:
pr_numbers: [805]
status: open
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

**Next Steps:**

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
