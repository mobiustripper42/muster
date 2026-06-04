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

**Velocity baseline:** Establishing — Phase 0 below. Dev/pt is the headline forecast number, but
P0's is a method artifact (see retro): S1's active dev time was largely misclassified as idle by the
break heuristic. Forecast against `wall − breaks` until a clean phase lands.

| Phase | Sessions | Points | Wall (h) | Dev (h) | Review (h) | hrs/pt (dev) |
|-------|----------|--------|----------|---------|------------|--------------|
| 0     | 3        | 9      | 6.29     | 0.80    | 0.75       | 0.09 ⚠       |

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
| 1.1 | **M0** Foundation — Vessel + CrewMember (+MMC credential) thin admin; seed 4–6 real crew | 5 | SPEC §2.1. [#6](https://github.com/mobiustripper42/muster/issues/6) |
| 1.2 | **M1** Import a weekend — Xola CSV → Events + Reservations; browse | 5 | SPEC §2.2. **At desk: does the export carry guest name+phone per reservation?** Drives 1.6 + write-back sheet (DEC-011/012). [#7](https://github.com/mobiustripper42/muster/issues/7) |
| 1.3 | **M2** Auto-form + lock — same-boat-same-day grouping, derive seats from COI, state machine births, lock | 8 | SPEC §2.3, §1.1, DEC-005. [#8](https://github.com/mobiustripper42/muster/issues/8) |
| 1.4a | **M3** Oracle eligible-pool + reliability-event logging | 5 | SPEC §1.3 (composite satisfiability — DEC-003), §1.4 logging. Ranking can be arbitrary here. [#9](https://github.com/mobiustripper42/muster/issues/9) |
| 1.4b | **M3** Tier-1 ask/confirm loop + assignment view (thin) | 5 | SPEC §2.4, §1.2 (Tier 1). Seat Open→Asked→Claimed→Confirmed; manual override. [#10](https://github.com/mobiustripper42/muster/issues/10) |
| 1.5a | **M4** Infrastructure / stack standup — pick + wire framework, DB, host, auth (magic-link), SMS+push | 5 | **The DEC-013 decision.** Consult @architect. Flip `project-type` → `webapp`; `/pull-seeds` the webapp tooling. [#11](https://github.com/mobiustripper42/muster/issues/11) |
| 1.5b | **M4** Crew tap-in — the ask (push/SMS, two buttons, no login), my-shifts list, magic-link landing | 5 | SPEC §2.6.1–2.6.2, §3.1–3.2. [#12](https://github.com/mobiustripper42/muster/issues/12) |
| 1.6 | **M5** Manifest on the card (the hinge) — call vs departure time, dock pin, per-event manifest | 5 | SPEC §2.6.3, DEC-012. [#13](https://github.com/mobiustripper42/muster/issues/13) |

**Phase 1 total: 43 pts**

**Ejection point / slice done-definition:** one real BrewBoat weekend runs import → auto-form →
lock → asks → crew tap in → crew open a card showing call time + their per-event guest manifest. The
scary assumption is de-risked.

---

## Phase 2: Pass A — Reliability ranking

Turn the logged events into a score; order the eligible pool by it; add the manual boost/floor
effect and crew-facing own-standing. *Trigger: a few weeks of real logged events to tune against.*
(SPEC §1.4, §2.4 ranking, §2.6.2.) Tasks filled by `/start-phase` at the boundary.

## Phase 3: Pass B — Tier 2 + At-Risk board

Autonomous escalation (widen, nudge) and the cross-shift triage board with the lean/reschedule
decision surface and escalation transparency. *Trigger: you stop watching every shift.* (SPEC §1.2
Tier 2, §2.5.)

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
