---
session: 93
dev: eric
slug: 801-login-window-gate-order
branch: task/801-login-window-gate-order
started: 2026-08-22T12:31:58Z
ended: 2026-08-23T15:33:49Z
points: 5
pr_numbers: [814]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/2c08003d-2556-538b-b7a0-c5fa904705af.jsonl
---

# Session 93 — 801-login-window-gate-order

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: A refused save keeps your work on six more surfaces (issue #780)

**Completed:**
- `app/lib/form-draft.ts` — the surface key is the **route path** now, not a bare name.
  `draftCookiePath` / `draftCookieName` exported and unit-tested (`app/lib/form-draft.test.ts`,
  new, 5 cases).
- Re-keyed with no behaviour change: `admin/{vessels,locations,offerings,add-ons}` — 12 call
  sites, rewritten by a script asserting the match count per file.
- Newly wired: `admin/time-clock` (edit form), `admin/blocks` (+ `block-editor.tsx`),
  `admin/time-off`, `admin/calendar/[reservationId]` (+ `reservation-detail-pane.tsx`),
  `crew/time`, `crew/time-off`.
- `e2e/admin-form-error.spec.ts` extended, `e2e/crew-form-error.spec.ts` new — 7 new cases.

**Five things the issue didn't know, each of which changed the work:**

1. **The cookie `Path` was hardcoded to `/admin/<surface>`.** Two of the six surfaces are
   `/crew/*`, where that path is never sent back (RFC 6265 §5.1.4) — stash succeeds, read finds
   nothing, every call site reads as correct. The bare name *also* collided: `/admin/time-off`
   and `/crew/time-off` were both `"time-off"`. Both impossible by construction now.
2. **These forms are per-row.** A surface-keyed draft repopulates *every* punch card with one
   row's values — #699's "shows you another record" arriving through the mechanism built to
   prevent it, on the surface that decides pay. Keyed on `punchId`/`reservationId`.
3. **`/admin/blocks` dropped `?sel=` on refusal**, so the edit panel became a create form and
   its hidden `id` emptied — correcting the error and saving again filed a **second block**.
4. **`/admin/time-clock`'s add form was already fixed** by an older `?a*=` param mechanism. Only
   the edit form was exposed, so the issue's "8 fields" is really 3.
5. **The calendar pane never sets `?err=`** (three actions, three params), so a draft gated on
   `err` would be written on every refusal there and read on none.

**Re-estimated 3 → 5 before starting, and said why.** The six surfaces are the 3; the shared-file
re-key touching four already-shipped surfaces, the calendar's different refusal contract, and
the per-row keying are not in that number. Not written onto the issue's `points:` label — asked,
unanswered.

**Deliberately not fixed:** `/crew/time-off`'s weekday-checkbox form. One cookie can't serve two
forms on one page without a marker field — an all-unticked save posts no `days`, so "no days"
and "no draft" are identical bytes — and its only refusal is an infra throw, so it can't be
exercised end-to-end either. It clears the draft instead, which keeps the invariant that the
cookie always belongs to the last refused add.

**Three tests passed before they were worth anything.** The first time-clock case asserted an
out-time the stored record also held, so it would have passed against no fix at all; both
time-off cases had the same shape. Caught by reading the *failure*, not the pass — each was
re-run against a value the record cannot produce before the fix went in.

**Code review:** 2 findings, both fixed. The real one: `cancelBooking` never stashed the
**override** amount on the cancel confirm, though `startRefund` stashes the byte-identical check
four lines away. It matters *more* there — the cancel commits before the amount is parsed, so
the screen it was typed on is gone, and the standalone refund box it lands in prefills. Losing
it showed `538.80`, a plausible wrong number on a money field, rather than a blank. Now e2e
covered, watched failing on exactly that value.
**Security review:** ran on the `app/(admin)/admin/time-clock/**` (Money computed) trigger.
**0 findings at confidence ≥ 8**, traced from source: cookie-Path widening (`/admin/calendar`
does prefix-match every `/admin/calendar/<id>` — guarded; `/crew/time` does *not* match
`/crew/time-off`, the boundary char is `-`), draft→privileged-decision flow, cross-record and
crew↔admin carry, auth ordering on all 12 call sites, injection surfaces, and whether
`draftCookieName` ever sees user input. It also caught a non-security gap, fixed: the
`provider_error` exit cleared nothing, so a stale draft prefilled the box after a **partial**
refund — that path now clears rather than stashes, because re-offering the typed figure is what
that screen's own copy warns against.

**Not done: the surface check.** I don't start his server, so nobody has looked at these six
forms at 375px. The e2e runs a mobile project, which proves they render, not that a restored
form reads right. Seven literal hand steps are in the PR body.

**PR:** [PR #814](https://github.com/mobiustripper42/muster/pull/814)
**Points:** 5
**Branch:** task/780-form-draft-six-more-surfaces
**Opened at:** 2026-08-23T02:28:48Z

**Next Steps:**

- **PR #814 is open and unreviewed by a human.** Its hand-test section is the point: nobody has
  looked at any of the six restored forms at 375px. Step 6 of that plan (can you reach the error,
  tap the inputs, get back out) is the one a green suite cannot answer, and #699's own history
  says the restore-looks-fine-but-isn't case is real.
- **issue #780's `points:` label still says 3.** Re-estimated to 5 at spec time with the reasons
  written down; asked twice whether to relabel, never answered. Left alone rather than changed
  unilaterally — but the label is what `/retro` reads for velocity, so a 3 there understates the
  phase.
- **`lane:a` / `lane:b` labels now exist** — 16 and 19 open issues. Created this session from the
  operator's own lane tables, reconciled against GitHub (5 rows of Lane A and 5 of Lane B had
  already closed; 18 issues filed since 2026-08-19 were in neither). Go-live/cutover work sits at
  the bottom of both, per the operator: *"that should always be last, it might change between now
  and then. it's only a priority if we have an actual product to release ... which we do not."*
- **66 open issues carry no lane.** The crew-engine backlog plus CI infra. Sweeping them in, or a
  third lane, is an open question.
- **Next in `lane:a` is issue #780's siblings** — #783 and #781, the rest of the form-draft-loss
  family, both on `app/lib/form-draft.ts` and the same admin surfaces this PR just touched.
  Cheapest possible follow-on while the mechanism is fresh.
- **`lane:b` rows 1–4 must not run against each other.** #807 (shipped, PR #813), #793, #806 and
  #800 all touch `src/ports/repository.ts` / `app/lib/repo.ts` / both adapters. Sequence inside
  the lane; #793 first shrinks what #806 and #800 have to touch.

**Context:**

- **The wall clock reads ~27h and that is an overnight gap, not work.** Started 12:31Z on the
  22nd, closed 15:33Z on the 23rd. `/retro`'s break inference will cut it; the real figure is a
  few hours.
- **Two windows ran concurrently all session.** Session 94 lives in `/home/eric/muster-s91` on
  `task/807-pi-idempotency-key` and was still OPEN when this one closed — its `ended:` is not
  knowable from here and was left blank deliberately. Both share this one `.sessions-worktree`;
  `/kill-this` and `/its-dead` were run in each and did not collide, because each re-synced
  (`fetch` + `reset --hard`) immediately before writing. That habit is what made it safe, not luck.
- **Issue #807 was found as orphaned work at session open** — one commit pushed to
  `task/807-pi-idempotency-key`, no PR, session 91 closed without it. Surfaced by `/its-alive`'s
  Orphan-without-PR scan. Dealt with in the other window (PR #813). This is exactly the class
  issue #661 describes.
- **The anchor branch was stale from the start.** `task/801-login-window-gate-order` had already
  merged as PR #810, so the session file is named for work that shipped before it opened. Third
  session running in a row with this shape. `/its-alive` Step 3 derives the slug from whatever
  branch the checkout happens to sit on, which is a fact about the shell, not about the session.
- **Three of this task's seven new e2e cases passed before they proved anything** — each asserted
  a value the stored record also held, so they would have been green against no fix at all. Caught
  by reading the *failure output* rather than the pass. The general rule, worth keeping: on a
  restore test, assert a value the record **cannot** produce.
- **A review verifies the diff, not your framing — unless you ask it to.** `@code-review` was told
  explicitly to re-derive the claims from source rather than accept the summary, and it found the
  one real bug on the money surface (the cancel-confirm's override amount) sitting four lines from
  a nearly identical line that was already correct. Same lesson session 92 recorded; it paid out
  again here.
- **`/security-review` reads the shell's cwd**, so it must be run from inside the worktree whose
  branch is under review (session 89's note). Ran correctly here — this session's shell and code
  are the same checkout, which is DEC-S048 working as intended.
- **Drift vs seeds was clean at open** (`seeds-version` 5 both sides; only three one-time
  migration scripts absent). The five session-skill drifts session 92 recorded are gone.
