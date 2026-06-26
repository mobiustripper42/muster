---
session: 28
dev: eric
slug: reset-pilot-absent-tables
branch: task/reset-pilot-absent-tables
started: 2026-06-26T11:51:52Z
ended:
points:
pr_numbers: [155, 156, 159, 162]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/948be534-0713-4f32-aa75-82dd87d6f9e4.jsonl
---

# Session 28 — reset-pilot-absent-tables

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: At-Risk board shows every uncrewed shift within 48h (DEC-065)

**Completed:**
- Operator-reported pilot bug (post DB-reset + unpause): near-term uncrewed shifts invisible on `/admin/at-risk`; nudging a candidate *removed* a shift from the board. Root-caused to route (b)'s willingness-exhaustion gate (`trail.asked > 0 && trail.pending === 0`) — a live/ghosted ask keeps `pending > 0` (worse, `expireAsks` is unwired, #151), so the shift stayed hidden as "actively worked."
- `src/admin/at-risk-board.ts` — **deleted the gate.** New rule: uncrewed required seat + trip within `FILL_DEADLINE_HOURS` (48h) → boards, regardless of in-flight asks. Route (a) eligibility-exhaustion (boards however far out) / regression / credential-lapse untouched. Module doc + comment sweep (`willingness-exhaustion` → `imminence / route (b)`).
- `src/builder/tick.ts` — `board_landed` ping (DEC-026) now fires for near-term uncrewed shifts (intended — operator wants the ping); stale comment fixed. `src/builder/derive.ts` — comment sweep.
- Tests: 3 flipped (live-ask-now-boards, never-asked-now-boards, tick worked-shift-now-lands) + new `Claimed`-seat boundary case (gapSeats is the sole over-board guard now). Full `vitest` **555 pass**, typecheck + build clean.
- `docs/DECISIONS.md` **DEC-065** (supersedes the willingness-exhaustion membership rule; decouples board visibility from #151). Swept stale hide-while-working copy across SPEC §2.5, OPERATOR_MANUAL FAQ, E2E walkthrough (2.4/2.7/7.2/7.3), and the board page subhead.

**Code review:** `@code-review` — logic correct, **no blockers**; confirmed safe in every edge case. All findings (4 stale-copy surfaces + comment drift + missing `Claimed` test) addressed in a follow-up commit. Flagged `board_landed` ping volume rises at pilot scale (deduped, not spam) — recorded in DEC-065 "Revisit if."
**PR:** [#155](https://github.com/mobiustripper42/muster/pull/155)
**Points:** 2
**Branch:** task/at-risk-show-uncrewed-48h
**Opened at:** 2026-06-26T12:50:50Z

## Task 2: Captains are never asked for mate seats (#148, DEC-066)

**Completed:**
- Operator-reported pilot bug: the engine kept asking him (a captain) for mate shifts. Captains are rated `[captain, mate]` (downward eligibility); the auto-ask had no precedence keeping them out of mate pools. Operator wanted it dead simple: captains **never asked** for mate seats, but still **manually assignable**.
- `src/asks/ask-loop.ts` — filter `rankedEligible` (the one askable pool every ask/suggest path reads) by a new `isAskableFor`: drop crew **over-ranked** for the seat. So a captain is never *asked* for a mate seat anywhere (auto-ask, drip, re-ask, lean, guarded assign, assignment-view, escalate, board lean list). The cockpit override seats by `isRatedFor` (DEC-064) and does NOT read this pool → manual placement unaffected.
- `src/oracle/eligibility.ts` — `isAskableFor(ratings, role)`: rating gate + "holds no role ranked above the seat." An **ask-routing preference**, not an eligibility gate (oracle/`solveShift` unchanged → satisfiability/AtRisk unaffected) and not a domain hierarchy (DEC-ROLE-1's flat roles stand).
- `src/config/tenant.ts` — `ROLE_PRECEDENCE` (`[captain, mate]`, most-senior-first tenant data). No schema/migration. Role ids match the live pilot seed + Xola import map (verified by review — won't no-op in prod).
- Tests: 8 new (4 `isAskableFor` unit + 4 broadcast/`rankedEligible`, incl. the mate-seat-with-only-captains terminal state). `docs/DECISIONS.md` **DEC-066**.

**Verification:** full `vitest` **563 pass** (8 new); typecheck + build clean; **full Playwright e2e 15/15 local** (ask-routing change — ran the whole suite, not just units).

**Code review:** `@code-review` — **no bugs, no security issues.** Verified oracle/override paths untouched + prod role-id parity. Folded in both advisory cleanups: documented the 3 extra `rankedEligible` consumers + added the 2 edge tests. Deferred (noted in DEC-066 tradeoff): a board copy hint for the "mate seat, only captains → 0 available" edge.
**PR:** [#156](https://github.com/mobiustripper42/muster/pull/156)
**Points:** 3
**Branch:** task/148-captains-not-asked-for-mate
**Opened at:** 2026-06-26T14:56:58Z

## Task 3: Wire expireAsks into the tick + idempotent recordResponse (#151, #145, DEC-067)

**Completed:**
- **#151** — `expireAsks` shipped clockless (DEC-MSG-3) with no prod caller, so ghosted asks sat `pending` forever: the engine stalled on the first non-responder (seat never reopened, drip stuck, no escalate, no reliability ding). `src/builder/tick.ts` now sweeps each **`Asked`** required seat through `expireAsks` before state-resolution + drip; timeout = new env knob `ASK_SILENT_TIMEOUT_MINUTES` (`src/builder/derive.ts`, `envPositiveInt`, default **120/2h**). A ghoster → silent (`ask_ignored`), seat reopens, same tick widens to the next candidate / escalates.
- **#145** — `src/asks/ask-loop.ts`: `recordResponse` no-ops on an already-answered ask (guards `respondedAt`) → no double-logged `ask_accepted` on a re-tap. New `already_answered` outcome reason; outbox copy reads "already answered," not "you lost the seat."
- **Review-caught bug (fixed before merge):** the sweep first ran on *every* required seat → a filled seat's losing broadcast siblings got dinged `ask_ignored`. Gated to `seat.state === "Asked"`. Regression test + the reopen→widen headline test added.
- `docs/DECISIONS.md` **DEC-067** (incl. the `Asked`-only gate rationale).

**Verification:** full `vitest` **568 pass** (5 new); typecheck + build clean; **full Playwright e2e 15/15 local**.

**Code review:** `@code-review` — found one real bug (unconditional sweep dinging broadcast losers on filled seats), **fixed + regression-tested**. Other findings folded in (outbox copy, reopen→widen test). Deferred (noted): crew flipping their own prior answer via a stale link is a silent no-op — a mind-change path is a separate product call.
**PR:** [#159](https://github.com/mobiustripper42/muster/pull/159)
**Points:** 3
**Branch:** task/151-145-ask-hardening
**Opened at:** 2026-06-26T16:05:59Z

## Task 4: Outbox dismiss-without-send + document engine env knobs (#158, #157)

**Completed:**
- **#158** — outbox **Dismiss** button (`components/outbox/outbox-card.tsx`, relay/sent cards only): clears a card from the worklist without sending. New `dismissOutboxEntry` action (`app/(admin)/admin/outbox/actions.ts`) deletes the outbox **entry** (`removeOutboxEntry`, channel-adapter state, DEC-030) but leaves the **ask live** — it rides to its silent-timeout (#151/DEC-067) and the seat self-resolves. The operator's chosen semantics (issue option b), now safe because #151 bounds the previously-unbounded "pending forever." Confirmation notice on `page.tsx`; `OPERATOR_MANUAL.md` explains the follow-up-card-is-the-engine-working subtlety.
- **#157** — `STAFFING_HORIZON_LEAD_DAYS` was already env-overridable (DEC-062 — issue premise stale). Documented it + `ASK_DRIP_INTERVAL_MINUTES` + `ASK_SILENT_TIMEOUT_MINUTES` in `.env.example` + `docs/DEPLOY.md`. (Decimal-days idea declined; `envPositiveInt`'s guard beats `Number()||7`.)
- **#145** — already shipped in #159; closed the issue separately.
- Test: `src/admin/outbox-view.test.ts` — dismiss hides the card, ask untouched.

**Verification:** full `vitest` **569 pass** (1 new); typecheck + build clean; full Playwright e2e **15/15** local.

**Code review:** `@code-review` — no blockers; auth/redirect/DEC-030 guardrail respected, docs match constants, a dismissed card can't resurrect (`obx-${askId}` + `widenAsk` mints fresh ids). **Real fix folded in:** Dismiss was rendering on `self` cards → would log `ask_ignored` against the operator; gated off. Accepted gap: server-action wrapper not e2e-tested (no outbox e2e exists; unit test covers the domain effect).
**PR:** [#162](https://github.com/mobiustripper42/muster/pull/162)
**Points:** 3
**Branch:** task/outbox-dismiss-env-docs
**Opened at:** 2026-06-26T16:37:14Z

**Next Steps:**

**Context:**
