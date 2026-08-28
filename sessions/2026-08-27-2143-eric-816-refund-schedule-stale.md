---
session: 98
dev: eric
slug: 816-refund-schedule-stale
branch: task/816-refund-schedule-stale
started: 2026-08-27T21:43:02Z
ended: 2026-08-28T15:10:11Z
points: 5
pr_numbers: [852, 853]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/c55d0c47-cc80-59b8-ad34-3242473f31a2.jsonl
---

# Session 98 — 816-refund-schedule-stale

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The X Shore boats import as two hulls, crewed by one captain each

**Completed:**
- `src/import/resource-map.ts` — `crew1` (captain only), two X Shore rows at COI 6, exported
  `X_SHORE_1` / `X_SHORE_2`. First boat in the fleet that isn't captain+mate.
- `src/import/resource-map.test.ts` — new, 4 cases, written first and watched fail for the right
  reason (X Shore absent from the map). The map had no test file at all before this.
- `db/seed-fleet.ts` — the console line no longer claims 4 BrewBoats.
- DEC-043 amendment — the fleet is six boats; why `Count 2` had to be split upstream; the stale
  "cited by SPEC §Fleet" pointer retired (there is no §Fleet in SPEC.md).
- Gate green: `npm run verify` exit 0, 2522 tests.

**The actual finding, which was not the new boat.** Xola modelled the operator's two identical
X Shore hulls as **one Resource with `Count 2`** — a quantity Muster cannot express, because the
resource id is the vessel axis and `formShifts` groups on `vesselId|date`. Both hulls run the same
day, so one id meant two boats sharing one shift and **one captain seat**, and `busyIntervalsFor`
would have read either hull's booking as occupying both. Muster cannot recover a distinction the
source does not make; the fix was upstream, in Xola. Operator split it into two Resources.

**A diagnostic that can't answer its own question.** The pull reported "1 unknown boat", which is
counted per unmapped **event** with no dedupe anywhere (`xola-client.ts:195` → `xola-pull.ts:194`
→ `import/page.tsx:145`). Two distinct unknown boats with one trip each also reads as "1 unknown
boat"; two trips on one unknown boat reads as "2". It cannot tell the operator how many boats are
unknown, which is the one thing it exists for. Not fixed here — needs an issue.

**Code review:** clean, 0 findings. Verified the captain-only row needs no code branch —
`deriveSeats` already iterated manning generically and nothing assumes 2 crew. Surfaced one
pre-existing loose end it correctly declined to count: DEC-086 still says "a ~4-boat fleet needs
~4 identity tokens" and `vessel-hue.ts`'s `PINNED` map covers only the BrewBoats (the new vessels
fall through to the hash fallback and render fine).

**PR:** [PR #852](https://github.com/mobiustripper42/muster/pull/852)
**Points:** 2
**Branch:** task/816-xshore-fleet
**Opened at:** 2026-08-27T22:12:00Z

## Task 2: A trip is measured by its own length, on the crew's card as well as the tick's

**Completed:**
- `src/import/resource-map.ts` + `import-reservations.ts` — `FleetVessel.tripLengthMinutes`
  (X Shore declares 120), `vesselTripLength()` mirroring `vesselCapacity()`, stamped onto the
  event. **Key omitted** when a boat declares nothing — no terminal `?? 100`, pinned by a test
  asserting `"durationMinutes" in event === false` for a BrewBoat.
- `src/crewapp/shift-card.ts` — `committedWindow`/`committedMinutes` now take events and
  delegate to `earliestScheduledStart` + `shiftEndFromEvents`, formatted via `vesselClockOf`.
  `plusMinutes`/`minusMinutes` deleted. Four callers updated (shift card, ask card,
  `/crew/open`, payroll). `committedMinutes` is now an instant span, so DST-correct.
- `src/crewapp/committed-window.test.ts` — new, 7 cases. `committedWindow` had **no direct
  test at all** before this; the new ones pin the *agreement* with `shiftEndFromEvents`
  rather than a second copy of the arithmetic.
- Comments corrected where they went false: `entities.ts`, `hull-busy.ts`, `derive.ts`,
  `payroll.test.ts`. Gate green: `npm run verify` exit 0, 2531 tests (up from 2522).

**The half that mattered was the one nobody asked for.** Stamping the event alone would have
been a half-fix: `committedWindow` took `"HH:mm"` strings and could not see
`Event.durationMinutes` at all, so since #570 it had silently disagreed with
`shiftEndFromEvents` — the operator's outbox card and the crew's own ask card rendering
different "back by" times for the same ask. The comment claiming "one computation" kept the
surfaces agreeing was true only among the three clock-string ones. @architect directed
delegation rather than widening the signature, which was the right call: a second
`max(start + duration)` in string form would have recreated the split with a longer fuse.

**Code review caught me misattributing a rationale.** I wrote that "DEC-129 settles the
direction" for the delegation. It doesn't — DEC-129 says `committedWindow` is "deliberately
**not** reused" and ruled on whether *suppression* should use it, never on how it should be
built. I read DEC-129 myself to confirm the reviewer rather than take it on faith, then
rewrote the comment. **This is the third instance of the same failure class this week** and
the first where the invented rationale was a decision citation rather than a code fact.

**Two findings accepted rather than fixed:** DEC-041 needs its amendment (operator is editing
those files by hand — text is in PR #853's body, in a `<details>` block, ready to paste), and
`suggestSplit`'s `occupiedMin` stays flat, now the last place that is. It under-counts a
120-minute trip by 20 min and can suggest a split that isn't there; advisory output, shipped
as a stated limit with a comment rather than a silent one. Fast-follow.

**Code review:** 3 findings — 1 fixed, 2 accepted and disclosed. `/security-review` ran
(payroll is money-computed by the fallback test, though `src/admin/payroll.ts` is not on the
project's trigger path list — worth adding the row): 0 findings.

**PR:** [PR #853](https://github.com/mobiustripper42/muster/pull/853) — stacked on PR #852
**Points:** 3
**Branch:** task/xshore-trip-length
**Opened at:** 2026-08-28T04:20:00Z

**Next Steps:**
- **v1.1.4 is promoted; two prod steps were still outstanding at close.** `npm run db:seed:fleet`
  against prod Neon — without it an X Shore trip resolves to a vessel row that does not exist and
  forms a shift with **zero seats**, silently. And `XOLA_PULL_LEAD_DAYS` in Vercel (default 7;
  the 9/6 booking is 9 days out), then Pull now. Then confirm `<VersionTag />` reads v1.1.4.
- **The DEC-041 amendment is written but not applied.** Full text sits in PR #853's body in a
  `<details>` block, plus see-alsos for DEC-145 and DEC-129. Deliberately not written to disk —
  the operator was editing decision files by hand this session. It also fixes DEC-041 line 19
  ("no `Event.durationMinutes` column — yet"), stale since #570 recorded that clause in DEC-145.
- **`suggestSplit`'s `occupiedMin` is the last flat trip length** (`derive.ts:569`). Under-counts
  a 120-minute trip by 20 min, over-reports the dead gap, can suggest a split that isn't there.
  Advisory output, disclosed in a comment. **No issue filed** — decide whether it wants one.
- **issue #854** — 38 bare `catch {}` blocks across crew and admin pages swallow the cause and
  render "try again in a moment". Filed this session.
- **issue #836** — the crew-change-banner hand review. Operator confirmed done, 2026-08-28;
  the issue was still open at close.
- Carried from Session 97 and untouched: the 432 lines of customer-side design in
  `the-booking-1.md` / `the-living-link-1.md`, the rest of issue #816's queue (service-fee, tips,
  cancellation spec sections), and the nine records still carrying rulings.

**Context:**
- **A missing migration presented as a network blip.** `/crew` rendered "Can't reach the schedule
  right now" with a clean dev-server log; the cause was `relation "shift_changes" does not exist`
  — PR #834's migration unapplied locally. `/admin` worked because nothing there reads that table.
  The bare `catch {}` at `crew/page.tsx:113` discarded the error. **What recovered it** was a
  throwaway script calling `buildCrewAppView` directly and printing what it threw; reading the
  code had produced only plausible theories. When a surface fails and the log is empty, call the
  builder directly rather than reasoning about it — issue #854 exists so the next one is cheaper.
- **Xola can model two hulls as one Resource with `Count 2`**, and Muster has no way to express
  that: the resource id is the vessel axis, `formShifts` groups on `vesselId|date`. Two same-day
  hulls would share one shift and one captain seat, and `hull-busy` would read either booking as
  occupying both. Muster cannot recover a distinction the source does not make — the fix was
  upstream, in Xola. Worth remembering the shape: **an upstream data model that is merely
  compact can be unrepresentable downstream.**
- **The two Xola feeds have different windows, and the diagnostics don't say so.** `/events` is
  unwindowed and now-forward; `/orders` is bounded by `XOLA_PULL_LEAD_DAYS` (default 7, via
  `STAFFING_HORIZON_LEAD_DAYS`). So a trip beyond the window reports as an *unknown boat* while
  its *reservation* never arrives — which reads as "the map is wrong" when the map is fine.
- **"1 unknown boat" counts events, not boats.** `unmapped.push()` fires once per unmapped event
  with no dedupe anywhere in the chain. Two distinct unknown boats with one trip each read as
  "1"; two trips on one boat read as "2". The count cannot answer the question it exists for.
  Operator declined an issue for now.
- **I over-attributed a rationale to DEC-129 and code review caught it.** I wrote that it
  "settles the direction" for the committedWindow delegation; DEC-129 actually says
  `committedWindow` is "deliberately **not** reused" and ruled on whether *suppression* should use
  it. I verified against the record rather than taking the reviewer's word, then corrected. Third
  instance of this failure class in two sessions; the first two were code facts, this one a
  decision citation, which is harder to spot because the id lends it authority.
- **The Neon MCP is unusable for the `/promote-production` ledger check.** Its tool schema
  declares `project_id`; the server rejects the call demanding `projectId`. Both spellings fail
  from here. The documented fallback (operator pastes `select filename from _migrations`) worked
  — 55 in the repo, 55 in prod, zero drift both ways. Worth fixing or the check is manual forever.
- **v1.1.4 shipped 37 PRs across nine days**, larger than v1.1.2's 32. Four migrations were
  applied to prod out-of-band before the promotion. `20260715024322_payments.sql` showed as
  *modified* in the branch diff, which looked like a hand-patched applied migration — it is
  **comment-only**, no DDL change, no CHECK constraint (DEC-131), so nothing was missing from
  prod. Flagged as a blocker, then withdrawn on reading the actual diff.
