---
session: 67
dev: eric
slug: chore-forward-merge-main-2
branch: chore/forward-merge-main-2
started: 2026-07-25T03:58:29Z
ended: 2026-07-25T11:16:48Z
points: 3
pr_numbers: [528]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/ba891caa-0d79-48ad-b8e3-140bc0c5d73b.jsonl
---

# Session 67 — chore-forward-merge-main-2

<!-- No /kill-this ran this session — task blocks written by hand, as in S66. -->

## Task 1 — Resolve and merge #528 (the third DEC-number collision on the same content)
Points: 1
PR: #528 (merged, `5a2790e`)

`claude/sailbook-ui-redesign-dh9chf` had sat unmerged with five doc commits and no PR until
Eric opened one this session. It conflicted because its two DECs had been **double-allocated
three times**: authored as DEC-126/127, renumbered to 131/132, and both of those were taken on
`main` in the meantime (131 = constraint posture, 132 = `Customer`).

Resolved by taking main's DEC-126–135 block whole and re-appending the branch's two as
**DEC-138** (embeddable booking widget) and **DEC-139** (Stripe card only, no wallets).
**136/137 deliberately skipped** — they're reserved for `feature/reservations`, which renumbered
main's 134/135 into them and carries that back at its merge.

Also fixed: the DEC-105 umbrella cross-ref, the "made moot by" note inside DEC-138, DEC-139's two
back-refs, `the-booking-1.md` §8, and the **missing index entries** — DEC-127 requires every new
DEC to update the index and this branch never did. Corrected a pre-existing wrong citation on
main while there: `the-booking-1.md` §8 cited DEC-126 for the embed decision, but main's DEC-126
is the Xola cutover; the embed DEC had never landed, so the reference pointed at nothing.

## Task 2 — First-ever doc consistency sweep (#525 part 1) + triage
Points: 2
No PR — report-only by design. Output filed as issues.

Ran `/doc-consistency-check`. It fanned out as four sweeps; **three returned, one did not.**
**46 confirmed findings**, each with a `file:line`, each checked against code rather than against
another doc. Full report posted as a comment on **#525**.

Triaged into four buckets and filed the code defects separately so they don't wait behind a docs
rewrite:

- **#529** — `/api/cron/xola-pull` exists as a route but is **not in `vercel.json`**. Xola only
  syncs when an operator presses the button on `/admin/import`. The code comment
  (`src/import/xola-pull.ts:5`) claims it runs hourly.
- **#530** — a fresh machine **cannot sign in** following `RUNNING.md`: code-login is flag-off by
  default so no email form renders, and `dev-link?admin=spink` 400s because no seed writes an
  `admins` row. This is the concrete cause of S66's setup friction.
- **#531** — `logShiftAcknowledged` has **zero call sites** but is weighted `shift_acknowledged: 1`
  in the reliability score.

**Next Steps:**
- **Bucket D is the blocker on #525 part 2 (SPEC rewrite) and needs an operator decision, not
  code.** Six SPEC items were *specified and never built* — the unified oracle (`SPEC.md:239`),
  the `Verdict`/`deferred` vocabulary (`:293-302`), the Xola write-back sheet (`:1110-1112`),
  the `recordReply` port method (`:1040`), shift Notes (`:926`), and first-class Cancel/Reschedule
  (`:855-861`, both rendered `disabled`). "Correct the description" does not cover these — either
  they become tracked gaps or the baseline moves to v1.1. **Decide this before any SPEC editing.**
- **Re-run the DECISIONS-internal sweep.** It's the one of four that never returned, and it's the
  evidence #525 part 3 (the ACTIVE/archive split) was supposed to rest on. Part 3 is currently
  unjustified by data.
- **#525 part 4 — consolidation, recommended addition.** The import procedure is documented in
  four docs in three mutually inconsistent versions. Single-ownership-per-fact before rewriting,
  or the same drift returns by Phase 13.
- **Task B (#512 integer-cents) is scoped and unstarted.** Fold integer-cents into DEC-131
  (`DECISIONS.md:3733` — right home, it already governs storage posture), then repoint the
  citations. **Needs a one-PR-or-two call:** only `0023_reservations_source_partition.sql` is on
  `main`; the other four DEC-112 citers (`payments`, `reservation_catalog_tables`, `add_ons_entity`,
  `vessel_included_guest_count`) exist **only on `feature/reservations`**. One PR on main leaves
  #512's first acceptance criterion unmet.
- **#522 (three scoped code-review sweeps) untouched.** Unblocked — #521 merged.
- Phase 12 / reservations dev is **paused by operator decision** until #525, #522, #512 are done.

**Context:**
- **Docs work is happening on `main` by operator decision**, against my recommendation.
  `feature/reservations` carries ~114 divergent lines in `DECISIONS.md` (DECs 134–137). Anything
  that restructures that file on `main` needs hand-reconciling at the reservations merge-back.
  Task 1's edit was small enough not to hurt; **#525 part 3 will not be.**
- **`BRAND.md` is the most stale file in the repo, not `DECISIONS.md`.** #525's premise was that
  DECISIONS had drifted; in both findings where it appears it is the **authority**. `BRAND.md:36`
  still says *"No web UI exists"* against 37 route files, and `:37` is a literal unfilled
  *"When chosen, fill in: style preset, light/dark default, font, border radius, color approach"* —
  all five decided in code and recorded in DEC-021.
- **`CLAUDE.md:64` documents the retired velocity model** (active h/pt) that three other docs say
  was retired across DEC-S013 → S015 → S024. It's a **seeds-managed file** — the fix probably
  belongs upstream via `/push-seeds`, not here.
- **The doc-consistency agent silently loses delegated sub-sweeps.** It reported "four sweeps
  running", returned nothing, and had to be resumed via SendMessage to produce a report — which
  then declared all four unreturned. Two arrived later as independent task notifications; one
  never did. **Do not trust its first return as complete.** Worth a `/read-the-tape` look.
- **Several findings are unverifiable from the repo**: whether prod sets `CREW_SELF_SERVE`,
  `MESSAGING`, `TWILIO_*`, `XOLA_*`; the Vercel Production Branch and plan tier. The Vercel MCP
  server is **unauthorized in this session** and needs connecting before those can be closed.
- **`docs/design/*.md` was not swept** — it's a subdirectory, outside the `docs/*.md` glob. But
  `DESIGN-REFERENCE.md` is cited by DEC-021 as binding on UI work, so it arguably belongs in
  scope next time.
- **`PROJECT_PLAN.md` phase point arithmetic has never been summed and checked** — flagged by the
  sweep as unverified, not clean.
- Squash commit `5a2790e` is titled *"…and DEC-131 (embeddable widget)"* — the PR title was never
  updated after the renumber. Git history says 131 for what is DEC-138. The docs are correct and
  DEC-138 carries a numbering note explaining all three collisions; the commit title can't be fixed.
