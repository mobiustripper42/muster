# Muster — Project Plan

**Start date:** 2026-06-03
**V1 target:** TBD (the vertical slice running one real BrewBoat weekend de-risks the rest)
**Critical path:** import a real weekend → auto-form shifts → ask crew → crew tap in → crew open a
shift card with call time + per-event manifest. That slice proves the scary assumption (does
autonomous grouping-and-asking work on real bookings?).

---

## Estimation Method

Fibonacci scale (2, 3, 5, 8, 13). See `VELOCITY_AND_POKER_GUIDE.md` for definitions.
All estimates from planning poker between Eric and Claude. Tests are baked into every task estimate
— no separate testing tasks. Disagreements logged at the bottom.

**Velocity baseline:** Phase 1 is the first clean read — **0.145 h/pt active** (active = wall −
inferred breaks) across 55 pts / 3 sessions. That's the forecast number. Phase 0 (0.176 ⚠) carries
an S1 break-heuristic artifact + an unreadable S2 transcript — don't lean on it. **Wall-clock h/pt is
not a velocity** (it's inflated by overnight gaps); forecast on active. The low active-per-point is
the AI-assisted signature — human keyboard time is small relative to output.

| Phase | Sessions | Points | Wall (h) | Breaks (h) | Active (h) | h/pt (active) |
|-------|----------|--------|----------|------------|------------|---------------|
| 0     | 3        | 9      | 6.33     | 4.75       | 1.58       | 0.176 ⚠       |
| 1     | 3        | 55     | 60.31    | 52.31      | 8.00       | 0.145         |
| 2     | 2        | 16     | 31.59    | 29.52      | 2.08       | 0.130         |

**Build strategy — vertical, not horizontal** (build plan §1): build a thin sliver through every
layer so one real thing works end-to-end, then fatten it. The spine doesn't change as it thickens;
every thickening pass is additive, not a rewrite.

---

## Phase 0: Setup & domain foundation

Seeds scaffold + planning docs + the **stack-agnostic domain skeleton**. Just enough to start M0
without choosing a web stack (DEC-013). No user-facing value yet.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 0.1 | Scaffold seeds template into muster (agents, skills, reference docs, CLAUDE.md, `.claude/` config) | 3 | Done 2026-06-03. `ui-reviewer` omitted (webapp-only). |
| 0.2 | Translate locked spec → `docs/SPEC.md`; author `docs/DECISIONS.md` (DEC-001–014) + `docs/FUTURE_IDEAS.md` | 5 | Done 2026-06-03. SPEC placed as-is (it *is* the contract). |
| 0.3 | Minimal TS/Node runtime + test harness (`package.json`, tsconfig, test runner) — no web framework, no hosted DB | 2 | **[x]** Vitest picked; SQLite/in-memory behind the port. [#1](https://github.com/mobiustripper42/muster/issues/1) · PR #3 |
| 0.4 | Domain skeleton — SPEC §2 entity types + **repository port** + **reliability-event log** + reserved `Held`/`Ask.type`/`Ask.decisionBy` fields | 5 | **[x]** Stack-agnostic spine, 11 tests. Reliability events logged day one (DEC-008). DEC-ROLE-1 (roles-as-config) folded into the same PR. [#2](https://github.com/mobiustripper42/muster/issues/2) · PR #5 |
| — | Messaging REV 2 (channel port, DEC-MSG-1/2/3) + stage UI design reference | 2 | **[x]** `Added during P0 retro` — mid-phase docs work, no issue. PR #4 |

**Phase 0 total: 15 pts planned** (0.1 + 0.2 = 8 pts completed as pre-ritual setup, untracked by
issue/PR/session). **Tracked & shipped: 9 pts across PRs #3/#4/#5.**

**Ejection point:** the data model + repository port + reliability-event log exist and are tested,
with no web framework or DB chosen. Every later milestone fattens this spine.
**Demo:** run the test suite green; construct the BrewBoat vessel + a crew member + a logged
reliability event in a unit test.

---

## Phase 1: Vertical slice (M0–M5)

The spine end-to-end. Each task = one build-plan milestone with its own acceptance gate (build plan
§3). **The deferred infrastructure decision lands here at task 1.5a.**

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 1.1 | **M0** Foundation — Vessel + CrewMember (+MMC credential) thin admin; seed 4–6 real crew | 5 | **[x]** SPEC §2.1. [#6](https://github.com/mobiustripper42/muster/issues/6) · PR #14 |
| 1.2 | **M1** Import a weekend — Xola CSV → Events + Reservations; browse | 5 | **[x]** SPEC §2.2. **Verified: export carries guest name+phone (DEC-015/017)** → fed 1.6 manifest; write-back sheet not needed. [#7](https://github.com/mobiustripper42/muster/issues/7) · PR #17 |
| 1.3 | **M2** Auto-form + lock — same-boat-same-day grouping, derive seats from COI, state machine births, lock | 8 | **[x]** SPEC §2.3, §1.1, DEC-005. [#8](https://github.com/mobiustripper42/muster/issues/8) · PR #18 |
| 1.4a | **M3** Oracle eligible-pool + reliability-event logging | 5 | **[x]** SPEC §1.3 (composite satisfiability — DEC-003), §1.4 logging. [#9](https://github.com/mobiustripper42/muster/issues/9) · PR #19 |
| 1.4b | **M3** Tier-1 ask/confirm loop + assignment view (thin) | 5 | **[x]** SPEC §2.4, §1.2 (Tier 1). Seat Open→Asked→Claimed→Confirmed; DEC-019 bail. [#10](https://github.com/mobiustripper42/muster/issues/10) · PR #21 |
| 1.5a | **M4** Infrastructure / stack standup — pick + wire framework, DB, host, auth (magic-link), SMS+push | 5→13 | **[x]** **DEC-020** (Next.js/Vercel, Postgres-behind-port, self-rolled magic-link). Re-est 5→13, split 3 PRs. [#11](https://github.com/mobiustripper42/muster/issues/11) · PRs #22, #24, #25 |
| 1.5b | **M4** Crew tap-in — the ask (push/SMS, two buttons, no login), my-shifts list, magic-link landing | 5 (~8 actual) | **[x]** SPEC §2.6.1–2.6.2, §3.1–3.2. Tailwind+session layer pushed it past 5 (DEC-021). [#12](https://github.com/mobiustripper42/muster/issues/12) · PR #28 |
| 1.6 | **M5** Manifest on the card (the hinge) — call vs departure time, dock pin, per-event manifest | 5 | **[x]** SPEC §2.6.3, DEC-012. `Event.dock`; flat 45-min call lead (DEC-021 / FUTURE_IDEAS). [#13](https://github.com/mobiustripper42/muster/issues/13) · PR #29 |

**Phase 1 total: 43 pts**

**Ejection point / slice done-definition:** one real BrewBoat weekend runs import → auto-form →
lock → asks → crew tap in → crew open a card showing call time + their per-event guest manifest. The
scary assumption is de-risked.

---

## Phase 2: Pass A — Reliability ranking

Turn the logged events into a score; order the eligible pool by it; add the manual boost/floor
effect and crew-facing own-standing. *Trigger: a few weeks of real logged events to tune against.*
(SPEC §1.4, §2.4 ranking, §2.6.2.) **Trigger caveat:** the scorer ships with default/flat weights now
(DEC-008 "flat v1"); *tuning* waits on weeks of real logged events.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 2.1 | **Reliability scorer** — blended per-crew score from logged events (rolling window; decline-neutral, only `ask_ignored` penalized, bail-lateness-weighted — DEC-008); default weights, cold-start neutral | 5 | **[x]** SPEC §1.4. Count-based window (seasonal — not calendar). [#30](https://github.com/mobiustripper42/muster/issues/30) · PR #33 |
| 2.2 | **Rank the eligible pool** by score + manual boost/floor — wire `rankPool` + `solveShift` ordering; `manualBoost`/`manualFloor` resolve cold-start | 3 | **[x]** SPEC §2.4, DEC-007/008. First-yes-wins stays; ranked union scored once (no per-seat N+1). [#31](https://github.com/mobiustripper42/muster/issues/31) · PR #34 |
| 2.3 | **Crew own-standing** — real score + reasons in `buildCrewAppView`, individual/non-comparative, no leaderboard | 3 | **[x]** SPEC §2.6.2, BRAND. Quiet subline; closes #31 display-vs-ranking divergence. [#32](https://github.com/mobiustripper42/muster/issues/32) · PR #35 |
| 2.4 | **Builder reconciliation** — manning-shrink seat prune + all-cancelled→Cancelled | 3→5 | **[x]** SPEC §2.3. Re-est 3→5 (new `removeSeat` port + 2 adapters). all-cancelled handled at `formShifts` (lifecycle), no horizon clock needed; surface-don't-strand. [#20](https://github.com/mobiustripper42/muster/issues/20) · PR #38 |

> **Not in Phase 2 (flagged at the boundary):** the **staffing-horizon clock** (Pending→Filling birth,
> Filling-vs-AtRisk split, "fills by" countdown, magic-token reaper) is a foundational, data-independent
> unblocker the At-Risk board (P3), Tier 2, and #20's all-cancelled half all depend on. Not a named
> phase yet — slot it deliberately when P3 forces it, or pull it forward.

## Phase 3: Pass B — Tier 2 + At-Risk board

Autonomous escalation (widen, nudge) and the cross-shift triage board with the lean/reschedule
decision surface and escalation transparency. *Trigger: you stop watching every shift.* (SPEC §1.2
Tier 2, §2.5.)

Decomposed 2026-06-08. **Staffing-horizon clock (3.1) is the foundational unblocker — built first**
(deferred at the P2 boundary; At-Risk, Tier 2, and #20's all-cancelled half all depend on a time
dimension the deriver has been clockless about). **Decision surface scoped to *lean* only (3.5)** —
reschedule/cancel cascade into refunds + customer comms, which are parked for 2026 (payments out of
build, Drew); they wait for the payments phase rather than ship as half-built non-cascading stubs.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 3.1 | **Staffing-horizon clock** — horizon-based shift birth (Pending→Filling), Filling-vs-AtRisk split driven by time + pool, "fills by" countdown/deadline, magic-token reaper | 8 | SPEC §1.1. Foundational, data-independent; built first. Unblocks 3.2/3.3/3.4 + #20's all-cancelled refinement. Injected `now`, no clock reads in the core. [#39](https://github.com/mobiustripper42/muster/issues/39) |
| 3.2 | **Tier 2 escalation** — widen the eligible pool + direct-nudge high-reliability crew + escalation logging (asked / declined / silent / widened / nudged) | 5 | SPEC §1.2 Tier 2. Still `Filling`, still no Spink. Builds on the ask loop + 3.1. Depends on 3.1. [#40](https://github.com/mobiustripper42/muster/issues/40) |
| 3.3 | **At-Risk derivation** — which shifts land on the board (At-Risk core, late-bail **regression** rocket-to-top, **credential-lapse** on assigned crew before trip) + urgency sort (time-to-trip · gap-severity · fillability) | 5 | SPEC §2.5 states/urgency. Pure deriver over shifts + escalation log + credentials. Depends on 3.1. [#41](https://github.com/mobiustripper42/muster/issues/41) |
| 3.4 | **At-Risk board surface** — admin triage worklist: what's-missing, deadline, escalation-transparency string, who's-still-available; empty-as-success; push ping | 5 | SPEC §2.5. Reads 3.3. Keep the bar to land high (no anxiety dashboard). Depends on 3.3. [#42](https://github.com/mobiustripper42/muster/issues/42) |
| 3.5 | **Decision surface: lean** — first-class "lean" (manual Tier-2 direct nudge) from a board row | 3 | SPEC §2.5. Lean = an ask, no payment fallout. Reschedule/cancel deferred to the payments phase. Depends on 3.4. [#43](https://github.com/mobiustripper42/muster/issues/43) |

**Phase 3 total: 26 pts planned**

## Phase 4: Pass C — Fast-follows

Bail flow, credential nudges, live-card pings, "changed since reviewed" nudge, split/merge, bulk
weekend-lock, the warming view. *Trigger: friction shows up in real use.* (SPEC §2.3–2.6 deferred
bits.)

## Phase 5: Pass D — Progressive commitment (soft-hold + staged horizons)

The anxiety-reducer: bank crew willingness weeks out via a `Held` seat tier and earlier *soft*
horizons converging on the hard confirm. Rides existing rails (data fields reserved in Phase 0/1).
*Trigger: the single-horizon slice has run a real weekend.* (SPEC §1.1, §1.3, §4 + Xola-trap
guardrail.)

> **Not V1 (parked — SPEC §4 + the 2027 line):** payments (cancel cascade, disputes), customer
> portal, live booking feed replacing CSV. Out of the 2026 build entirely. See `docs/SPEC.md` §4
> and `docs/FUTURE_IDEAS.md`.

---

## Velocity Table

Updated at end of each phase. Used by @pm to project remaining time.

| Phase | Actual Hours | Effort Points | Hrs/Pt | Notes |
|-------|-------------|---------------|--------|-------|
| 0 | — | 15 | — | |
| 1 | — | 43 | — | |

**Lifetime velocity:** — hrs/pt

---

## Estimation Poker — Standing Disagreements

Phase 0 + Phase 1 pokered 2026-06-03. Contested estimates resolved in session:

| Task | Claude said | Resolved | Note |
|------|------------|----------|------|
| 0.2 | 3 → 5 | **5** | DECISIONS (14 entries) + PROJECT_PLAN are authoring, not copying. |
| 1.3 | 8 | **8** | Grouping + nested state machine + seat derivation + lock — held at 8. |
| 1.4 (M3) | 8 whole | **split 5+5** | 1.4a oracle+logging / 1.4b Tier-1 ask+assignment. |
| 1.5 (M4) | 8 whole | **split 5+5** | 1.5a infra/stack standup / 1.5b crew tap-in. Infra decision gets its own gate. |

No unresolved disagreements.

---

## Phase Boundary Checklist

At the end of every phase:
1. All tests green (the runner chosen at 0.3; UI/integration tests join at M4).
2. @pm phase retrospective — velocity check, timeline update.
3. Write retrospective entry in `docs/RETROSPECTIVES.md` (velocity, scope changes, process notes,
   forecast update) — `/retro` does this.
4. Version bumps via `/retro` (patch per merged PR + minor at close) once `package.json` exists.
5. Review docs against intent; `/doc-consistency-check` if multiple docs moved.

---

## Cuttable Tasks (if behind)

The slice's milestones each stub aggressively (build plan §3 "stubbed/out"), so the cut surface is
the **thickening passes**, not the slice. Reference before any scope-cut conversation.

| Task | Why it's cuttable | Defer to |
|------|------------------|---------|
| Pass D (Phase 5) | Soft-hold is an anxiety-reducer, not load-bearing; the single-horizon slice works without it | post-slice, only after a real weekend |
| Pass C bits (split/merge, bulk lock, warming view) | Single-item versions cover the pilot | when friction appears |
| Write-back sheet (DEC-011) | Unnecessary if the CSV export carries guest detail (decide at M1) | skip unless M1 says otherwise |
