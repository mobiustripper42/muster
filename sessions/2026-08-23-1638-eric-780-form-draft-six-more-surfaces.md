---
session: 95
dev: eric
slug: 780-form-draft-six-more-surfaces
branch: task/780-form-draft-six-more-surfaces
started: 2026-08-23T16:38:51Z
ended: 2026-08-23T20:04:03Z
points: 0
pr_numbers: []
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/3a0fc934-8c0b-42c2-b4b1-fb2239c29fc8.jsonl
---

# Session 95 — 780-form-draft-six-more-surfaces

<!-- Task blocks appended by /kill-this, one per task. -->

No `/kill-this` ran — nothing shipped from this window. The session was review, one bug filed,
and one spec written. Points 0 is correct, not a missing tally.

**What happened:**

- **PR #814 (issue #780) reviewed by hand and merged** at 19:54Z (`f626cdf2`). The operator did
  the surface check session 93 recorded as not done.
- **issue #818 filed** from what that check found.
- **issue #783 specced, not started.** Phase A/B split proposed, not yet approved.

**Next Steps:**

- **issue #783 is next, then issue #818** (operator's order, stated this session).
- **issue #783's plan is a two-phase split and is unapproved.** Phase A is measurement only:
  write the failing e2e for correct-in-place resubmit, run it at `E2E_PROD=0`
  (`npm run test:e2e:dev` — locally `E2E_PROD` defaults to `!CI`, i.e. the prod mode that *hides*
  the bug, `playwright.config.ts:6`), then split the hypothesis space with one measurement: does
  the corrected value reach the server at all? Reverted-in-DOM and stale-FormData are different
  bugs with different fixes, and the issue does not distinguish them. Phase B specs the fix once
  A reports a mechanism.
- **issue #783's `points:` label says 3; flagged as 5 for the pair.** Raised once this session,
  unanswered. Not changed unilaterally.
- **issue #780's `points:` label still says 3** after merging. Re-estimated to 5 at spec time in
  session 93, asked twice there and once here, never answered. It is closed now, so this is what
  `/retro` will read (DEC-S026 counts `points:N` on closed issues). Stands at 3 — three asks is
  enough, and the record of the discrepancy is here.
- **`e2e/admin-form-error.spec.ts:320-323` holds a deliberate detour** around issue #783 and its
  comment says to delete it when #783 is fixed.

**Context:**

- **The bug that mattered this session was found by hand, not by any suite.** PR #814 shipped
  green — `verify`, `e2e`, and a security review at confidence ≥ 8 — and the operator's seven
  literal hand steps found a booking being cancelled by a submission that reported only
  *"Enter an amount like 50 or 536.25."* Session 93 recorded "not done: the surface check" as its
  one gap. That gap was the whole yield.
- **issue #818's cause, so the next session doesn't re-derive it.** Two defects compounding:
  (1) `cancelBooking` commits `cancelReservation` at
  `app/(admin)/admin/calendar/[reservationId]/actions.ts:131` and only parses the amount at 189,
  though three of its exits need no I/O and are knowable first — `invalid_amount` (197),
  `stripe_not_configured` (213), `stale` (218); (2) the render picks one outcome, first-match from
  `["cancelErr","refundErr","resendErr","cancelled","refunded","resent"]`
  (`page.tsx:246-250`), so a redirect carrying **both** `cancelled` and `refundErr` drops the
  cancelled half. All six compound exits swallow it.
- **The ordering comment at `actions.ts:166-170` is right and was applied one category too wide.**
  "Don't roll back the cancel when the refund fails" is about a *provider call failing at
  runtime*. It got applied to a string parse and two env reads. The sibling action `startRefund`
  (line 281) already does the save-button shape correctly and its docstring states the principle.
- **The demotion that caused half of issue #818 was itself a fix.** Commit `4b408a5` moved errors
  ahead of successes because a partial refund rendered as a green "Refunded $200.00". Correct for
  that case; `cancelled` became collateral. Worth knowing before anyone reorders that list again —
  the compound machinery exists but was wired for `refunded`+`refundErr` only (`page.tsx:252`).
- **Nothing tested the outcome picker.** `action-message.test.ts` covers the resend copy only; the
  picker lives in `page.tsx` and has no unit test, and no e2e asserts the compound string.
- **Session 94 was still OPEN when this closed** — `/home/eric/muster-s91`, branch
  `task/807-pi-idempotency-key`, started 2026-08-22T13:48Z. Left alone deliberately; its `ended:`
  is not knowable from here. Second session in a row with this shape.
- **The anchor branch was already merged work by the end.** This session opened on
  `task/780-form-draft-six-more-surfaces` and PR #814 merged mid-session, so the session filename
  names shipped work. Fourth session running with a stale-anchor name; `/its-alive` Step 3 derives
  the slug from whatever branch the checkout sits on, which is a fact about the shell.
- **Drift vs seeds at open** (`seeds-version` 5 both sides): `.claude/skills/its-alive/SKILL.md`
  and `CLAUDE.md` both differ from the templates. Not investigated, not reconciled.
