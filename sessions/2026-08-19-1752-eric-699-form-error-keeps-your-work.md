---
session: 90
dev: eric
slug: 699-form-error-keeps-your-work
branch: task/699-form-error-keeps-your-work
started: 2026-08-19T17:52:38Z
ended:
points:
pr_numbers: [782, 786]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/37b3191d-57cf-52a8-ab48-c68f70f9c8ad.jsonl
---

# Session 90 — 699-form-error-keeps-your-work

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: A refused save keeps the operator's work (issue #699)

**Completed:**
- `app/lib/form-draft.ts` (new) — stash the submitted `FormData` on the refusal path in a
  short-lived `httpOnly` path-scoped cookie; the page reads it back as its defaults source when
  `?err=` is present. Self-limiting three ways: `?err=`-gated, 60s expiry, cleared on success.
- `app/(admin)/admin/{add-ons,locations,offerings,vessels}/actions.ts` — stash on refusal, clear
  on success, and select `new` after a refused create instead of an id minted for a record that
  was never written.
- The four matching `page.tsx` + `offering-sections.tsx` — draft-first defaults across every
  control type; `?sel=` naming nothing now says so rather than falling through `?? list[0]` to an
  unrelated record.
- `e2e/admin-form-error.spec.ts` — rewritten and grown to 6 tests. The five inherited from
  session 88 were rebuilt against the real mechanism (they had been written for the abandoned
  controlled-state approach and their comments asserted things that were no longer true), and
  gained the missing **select** and **radio** assertions.
- `docs/decisions/DEC-147` — amendment: rule 4, plus why the client fix is impossible.
- Filed issue #780 (same defect, six more surfaces) and issue #781 (navigation guard).

**The thing worth remembering:** the answer came from reading `react-dom@19.2.7` rather than
reasoning about React. `startHostTransition` calls `HTMLFormElement.reset()` unconditionally
before the action runs, and there is no opt-out — the exported `requestFormReset` is the same
function the automatic path calls. Controlled `value` survives only because React mirrors it into
`defaultValue` on update; `checked`/`selected` are never mirrored. That single asymmetry is why
session 88's controlled-state work fixed text fields and silently broke every checkbox, and why
two prior sessions declared offerings fixed when it wasn't.

**Code review:** `@code-review` found a real one — `jar.delete("name")` omits the `path` the
cookie was set with (`@edge-runtime/cookies` re-sets with no `Path`, which then defaults to the
request URI's directory per RFC 6265 §5.1.4), so "cleared on a successful save" was a no-op
resting on the 60s TTL. Fixed in `7021871` with a test written first and watched failing. Two
advisory findings flagged in the PR, not fixed: an unchecked `as PriceVariation[]` cast, and the
silent drop of drafts over ~3.5KB. No blast-radius trigger, so no `/security-review`.

**Also learned, and it is not in any issue yet:** re-typing into the restored form before React
finishes reconciling it loses the correction and posts the ORIGINAL value again. Machine-speed
only — Playwright wins that race every time, a person cannot — so the test waits for hydration
and says why. Same family as issue #776.

**PR:** [PR #782](https://github.com/mobiustripper42/muster/pull/782)
**Points:** 5
**Branch:** task/699-form-error-keeps-your-work
**Opened at:** 2026-08-19T21:53:11Z

## Task 2: Concurrent offerings share the calendar column (issue #702)

**Completed:**
- `src/reservations/calendar-grid.ts` — `assignLanes`: cluster-scoped lane packing on half-open
  intervals, returning placements parallel to the input. 10 tests written first and watched
  failing (`src/reservations/calendar-grid.test.ts`).
- `app/(admin)/admin/calendar/calendar-view.tsx` — lane geometry per card, computed over the cards
  the current filter *draws* (over all slots it would leave a gap where a hidden card's lane was).
  One lane keeps the original inset byte-for-byte, so ordinary days are unchanged.
- `db/seed-concurrent-dev.ts` + `npm run db:seed:concurrent` — nothing in the repo produced this
  state; the e2e reservation world has exactly one offering. Two extra LIVE offerings on Brew 3
  only, one of them at 14:00 so it *partially* overlaps the 13:30 rather than matching it.
- `e2e/calendar.spec.ts` — two cases asserting geometry (pairwise non-overlap; single-offering
  columns keep near-full width), not card count.

**The thing worth remembering:** overlap here is an interval question, not an equal-start-time
one. A 14:00 departure starting inside a 13:30 trip collides exactly as a second 13:30 does, and a
check keyed on matching times finds one and misses the other *while looking correct* — the
leftover overlap then reads as a rendering glitch rather than a missing rule. The fixture carries
that case deliberately for the same reason.

**Screenshots drove the review.** Captured before/after at both viewports via a throwaway spec
(deleted before commit) into `/tmp/muster-702/`, sent to the operator over `tailscale file cp
<files> <node>:`. That loop — build, screenshot, send, adjust — is worth repeating on any visual
change; it caught the design question (three lanes at 375px is legible but tight) that no
assertion would have raised.

**Code review:** clean, 0 findings. It traced the sweep by hand and confirmed neither e2e case can
pass vacuously. Named one piece of standing debt not from this diff: `calendar-view.tsx` was
already 855 lines mixing filter logic, geometry and three card-render branches.

**Open, operator's call:** three lanes at 375px wraps the label to two lines. Ship as-is, bare-time
it at 3+ lanes, or lane only above a breakpoint. Deferred deliberately, not forgotten.

**PR:** [PR #786](https://github.com/mobiustripper42/muster/pull/786)
**Points:** 3
**Branch:** task/702-calendar-lanes
**Opened at:** 2026-08-20T01:25:03Z

**Next Steps:**

**Context:**
- **Main development session**, running in the primary checkout `/home/eric/muster`. Session 89
  (`2026-08-19-0219-eric-main.md`) stays open concurrently as the secondary, in the linked worktree
  `/home/eric/muster-s89`.
- Anchored on `task/699-form-error-keeps-your-work` rather than `main` because `main` is checked out
  in the s89 worktree and git will not check it out twice. The branch holds one commit (`08033bb`,
  five failing e2e tests for issue #699) and is **not pushed**.
- Drift vs seeds at open: 11 `logic`-class files differ (six skills, four scripts, the `CLAUDE.md`
  shell); `seeds-version` matches at 5. Not acted on.
- PR #778 (adopt-seeds) merged at 17:45Z; `origin/main` is at `cff8cf7`.
