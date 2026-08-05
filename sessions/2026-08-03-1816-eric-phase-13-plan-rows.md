---
session: 77
dev: eric
slug: phase-13-plan-rows
branch: task/phase-13-plan-rows
started: 2026-08-03T18:16:06Z
ended: 2026-08-05T03:02:38Z
points: 8
pr_numbers: [652, 656, 657, 658]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/89b01c17-af5f-481b-87c3-81f73b7c0b74.jsonl
---

# Session 77 — phase-13-plan-rows

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The hours report names the shift nobody punched (#638)

**Completed:**
- `src/admin/payroll.ts` — `PayrollRow.days`, the vessel-local dates behind each estimate row.
  `src/admin/time-clock-report.ts` — `TimeClockRow.days`, bucketed on `vesselDateOf(inAt)`, open
  punches included. `src/admin/payroll-reconcile.ts` — the set difference as `missingDays` per
  row + `missingCount` overall; `exportBlocked` deliberately unchanged. `/admin/payroll` gains a
  `warn` notice linking each missing day to `?day=`. SPEC §2.9.6 + §2.9.7, `db:seed:timeclock`
  gains Gil, +8 unit tests, +1 e2e.

**The issue's own sketch was the wrong structure, and following it would have duplicated the
rules.** #638 said derive `missingCount` inside `buildTimeClockReport` beside `openCount`. That
module reads punches and crew only; doing it there makes it read shifts and seats and
re-implement the paid-seat filter — required + Confirmed + assigned, skip Cancelled, skip
event-less, dedupe the operator double-seat backstop. Four rules and a subtlety, in a second
copy. `payroll-reconcile.ts:21` already states the boundary ("the estimate's seat rules, the
clock's bucketing and the tip split each stay in one place"), so each module returns its own
`days` and the join happens in the one module that already reads both.

**The no-block decision got independent evidence I didn't plan for.** Gating `exportBlocked` on
`missingCount` as a negative control reddened the new test AND a pre-existing one about tips with
no hours — so the asymmetry was already load-bearing elsewhere before this task named it.

**Test-first bought almost nothing here and the negative controls did all the work.** The first
failure was `missingDays` undefined, which proves the field is absent and nothing about whether
any rule bites. Five controls, each reddening the test that names it and nothing else: UTC
bucketing → the DEC-032 test; counting only closed punches as days → the open-punch case;
dropping the required/supernumerary filter → 3; removing the Cancelled skip → 4.

**Two self-inflicted costs worth remembering.** `git checkout <file>` to revert a negative control
discarded the uncommitted implementation in that file — controls on uncommitted work need a file
copy, not git. And the first e2e locator asserted the date link globally; it matched three
elements because several people share that missing day, so it would have passed on someone else's
link and kept passing if Quint's own vanished. Scoped to his entry.

**Code review:** clean bill of health. The reviewer independently confirmed the hours
accumulation is byte-identical (`payroll.ts:72` is the only change inside the loop), the SPEC
prose and §2.9.7 criterion agree with the code, and `exportBlocked` is still `openCount > 0`.
No blast-radius trigger fired — the money-path list is the reservations/Stripe surface — though
this does edit the two modules that compute payroll hours, additively.
**PR:** [#652](https://github.com/mobiustripper42/muster/pull/652) — closes #638, based on
`feature/time-clock` (which took #649 as a merge commit, so this adds exactly one commit).
**Points:** 3 (filed as 2)
**Branch:** task/638-missing-punches
**Opened at:** 2026-08-04T02:45:00Z

## Task 2: Nav groups closed themselves out from under an iPhone tap (#655)

**Completed:**
- `components/admin/admin-nav.tsx` — `onFocusOut` narrowed to `if (!next) return;`. `playwright.config.ts`
  gains an `iphone` project (WebKit, iPhone 13, touch) scoped to `admin-nav.spec.ts`; `ci.yml:91`
  installs webkit. `e2e/admin-nav.spec.ts` +3 tests and two navigation-race fixes.

**The operator's own bug report was the diagnosis.** iPhone failed, Android worked, ungrouped links
worked. That split says it is not a dead link — the group is closing out from under the tap.
`onFocusOut` closed every open group when focus left and landed NOWHERE, and Safari on iOS does not
focus a link on tap, so `relatedTarget` is null, the panel closes, and the link leaves the layout
before the click resolves. One line.

**The WebKit project cost 218 system packages and does NOT catch this bug.** I proposed it implying
it would. The real-tap test passes with the fix reverted — Playwright's Linux WebKit is Safari's
engine but not its platform, and it focuses a link on tap the way Chromium does. The synthetic
`focusout` test is the only guard. Kept the tap test, relabelled with the negative-control result
written in, because shipping it under its original comment would have laundered a false claim.

**What WebKit did find, immediately:** session cookies do not persist under it in a local prod-mode
run — `NODE_ENV=production` makes the cookie `Secure` (`app/lib/auth.ts:48`), the e2e server is
plain http, and WebKit refuses that where Chromium special-cases localhost. It does not error: the
URL looks right and every page renders signed-out with zero cookies. Plus two navigation races.

**Three ways the test lied before it was right.** `dispatchEvent` does not carry `relatedTarget`, so
the keyboard test was silently re-running the null case; `clickHydrated` on a `<summary>` waits on
nothing (native toggle) while the ASSERTION does need React attached, or a pass means no handler
ran; and selecting `<details>` by visibility matched nothing at desktop width — the same locator
mistake as Task 1's first e2e.

**Code review (retroactive — this shipped without one):** 3 findings. The real one is that the
fixture race is live in **CI**, not just local dev (CI runs `next dev`, the mode that loses it), and
**eleven other specs share the pattern unguarded** — filed as #659. Also: the WebKit test's TITLE
does not carry the smoke-test caveat its comment does, and CI summaries show only titles. And
`!next` also fires when focus leaves the document entirely, a latent edge no current admin page hits.
**PR:** [#656](https://github.com/mobiustripper42/muster/pull/656) — closes #655, based on `main`
(the bug was on `main`, not the feature branch). **Merged.**
**Points:** 2
**Branch:** task/655-ios-nav-group
**Opened at:** 2026-08-04T16:49:43Z

## Task 3: Two punches on one person, one minute, thirteen paid hours for nine (#645)

**Completed:**
- `src/admin/time-clock-report.ts` — `overlappingDays` + `overlapDays`/`overlapCount`.
  `src/admin/payroll-reconcile.ts` — pass-through, the gate, and a reason-specific
  `exportBlockedMessage()` replacing the deleted `EXPORT_BLOCKED_MESSAGE`. A blocking notice on
  `/admin/payroll`, SPEC §2.9.6/§2.9.7, `db:seed:timeclock` gains Hal, +8 unit tests, +1 e2e.

**Filed as a write guard, shipped as a report condition, and the precedent decided it.** Muster had
already answered this for open punches: not refused at the keystroke, they block the export. The
chokepoint for incomplete time data is the file, not the edit. That also catches the rows already in
the table, which a write guard structurally cannot.

**It BLOCKS, and that completed a rule rather than adding a third special case.** Block when a
guaranteed action clears the condition — closing an open punch, deciding which of two punches is
wrong. Warn when the state may be legitimate: a missing day may simply be true. Written into SPEC as
the rule, not just its three outcomes.

**The obvious implementation is wrong twice.** Bucketing by day before comparing misses the overnight
pair entirely (different `inAt` days, never compared) — that is the version I nearly shipped, so it
got a negative control rather than a comment. And half-open `[in, out)`, or a legal split shift gets
refused to catch the pathological case.

**I corrected my own spec mid-task.** I had claimed adjacent-pair comparison misses containment. For
the DAY-level answer that is false — if any two punches overlap, some adjacent pair does. The running
maximum is kept for a possible future pair count, and the docstring says so instead of implying a
test proves it.

**The e2e drove the admin bench rather than seeding rows** — hand entry is the only door this state
comes through — and it caught what the unit tests could not: the 409 route still returned the old
constant while `gustoPayrollCsv` had moved on.

**Code review (retroactive — this shipped without one, and it is now in production):** one real
finding on the money path. `listTimePunchesBetween` filters on `inAt` only, so an overlapping pair
straddling a **pay-period boundary** is never loaded into one call and the gate passes it in BOTH
periods. #645 fixed the day seam and stopped there; my docstring's "across the WHOLE window"
overstates it (the window is one period). Filed as #660. Reviewer independently cleared the thing
that mattered most — no false-positive path, which would stop payroll for the whole crew — plus
missing/overlap mutual exclusion, no silently-invisible block, and hours arithmetic untouched.
**PR:** [#657](https://github.com/mobiustripper42/muster/pull/657) — closes #645. **Merged**, then
reached `main` in the phase merge [#658](https://github.com/mobiustripper42/muster/pull/658).
**Points:** 3
**Branch:** task/645-overlapping-punches
**Opened at:** 2026-08-04T19:38:03Z

**Next Steps:**
- **Send the crew email** (operator, sending 2026-08-05). Drafted in this session's transcript, never
  committed anywhere — two blanks: the date, and how crew actually get into Muster. It says the
  clocking moves to Muster and **Gusto stays** as the payroll processor, deliberately: the export is
  a Gusto CSV, so "we're not using Gusto anymore" would send the first person needing a pay stub
  straight to the phone.
- **#660 first of the three follow-ups** — it is the money path and it is live: overlapping punches
  straddling a pay-period boundary go undetected, and the export gate passes them in BOTH periods.
  Decide widen-the-fetch vs document-the-seam before writing code; option 1 touches the hours path.
- **#659** (e2e sign-in fixture race — live in CI, 11 specs exposed) and **#661** (`/its-dead` should
  refuse to close silently when shipped work was never logged; seeds-managed, backports).
- **#634** — pay-period cadence is an env var plus a hardcoded 14. Payroll-adjacent, unlabelled for
  any phase, and the next thing that bites this area.
- **Phase 12 retro is still pending** — 23 open issues; the operator closes it when reservations
  ships. Phase 11 was never retro'd either.

**Context:**
- **Phase 13 is live in production.** `TIME_CLOCK=1` is set; the operator hand-verified all three
  report states (open blocks, overlap blocks, missing warns) before the flip. `main` is at **v1.1.0**
  (the phase-close tag), `production` at **v1.0.21** — that gap is expected and correct; the minor
  only reaches production at the next `/promote-production`.
- **`Closes #a, #b, #c` closes only the first issue.** GitHub's parser needs the keyword before each
  number. PR #658 used a comma list and left six issues open after the phase merged; they were closed
  by hand at retro, so their `closedAt` is 2026-08-05 and is NOT a ship date. Real ship dates are in
  the PROJECT_PLAN Phase 13 section.
- **"375px" in this repo means Chromium**, not a phone — `playwright.config.ts`'s `mobile` project is
  `devices["Desktop Chrome"]` at 375px. The new `iphone` project is the only WebKit anywhere, scoped
  to `admin-nav.spec.ts`. **Locally it needs `E2E_PROD=0`**: `next start` sets NODE_ENV=production,
  which makes the session cookie `Secure`, and WebKit refuses Secure cookies over the plain-http e2e
  server where Chromium special-cases localhost. It does not error — every page renders signed-out
  with zero cookies. CI is unaffected (`E2E_PROD` defaults to `!CI`).
- **The Phase 13 PROJECT_PLAN section was authored at retro**, not ticked — its rows were written
  2026-07-31 and never merged (PR #650, closed as stale). Original intent survives on
  `task/phase-13-plan-rows` and `claude/muster-time-clock-d61kju`; neither branch is deleted.
- **`git checkout <file>` to revert a negative control destroys uncommitted work in that file.** Cost
  a redo of the #638 implementation mid-session. Use a file copy for controls on uncommitted code.
- Wall clock on this session reads ~32h and spans two overnights — elapsed, not desk time.

**Context:**
- Picks up directly from Session 76, which ended by window loss rather than a normal close.
- Open at session start: **PR #649** (`task/628-hours-report` → `feature/time-clock`, the hours report
  + Gusto CSV) with `/code-review ultra` running against it; **PR #650**
  (`task/phase-13-plan-rows` → `main`, the Phase 13 plan rows re-homed off the orphan
  `claude/muster-time-clock-d61kju`).
- The checkout at `/home/eric/muster` is shared with the operator's own terminal this session.
