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

**Velocity baseline:** three clean reads and a steady trend — **0.145 → 0.130 → 0.122 h/pt active**
(active = wall − inferred breaks); lifetime (P1–P3) **0.136 h/pt** was the forecast number **through P3 only — retired at DEC-S026** (see next paragraph). Phase 0
(0.176 ⚠) carries an S1 break-heuristic artifact + an unreadable S2 transcript — don't lean on it.
**Wall-clock h/pt is not a velocity** (it's inflated by overnight gaps); forecast on active. The low
active-per-point is the AI-assisted signature — human keyboard time is small relative to output.

**P4 onward: throughput, not h/pt (DEC-S026).** Velocity is now **points per calendar week** from
GitHub issue `closedAt` + `points:N` labels, plus an estimate-calibration tally — the transcript-based
`active = wall − breaks` model is retired (its `breaks=0 → active=wall` fallback was the bug). The
P0–P3 rows below are that retired metric, left as written (don't blend with throughput). Most solo
phases are *burst-shaped* (clear inside a calendar week), so a per-week rate isn't quoted for them.

| Phase | Sessions | Points | Wall (h) | Breaks (h) | Active (h) | h/pt (active) |
|-------|----------|--------|----------|------------|------------|---------------|
| 0     | 3        | 9      | 6.33     | 4.75       | 1.58       | 0.176 ⚠       |
| 1     | 3        | 55     | 60.31    | 52.31      | 8.00       | 0.145         |
| 2     | 2        | 16     | 31.59    | 29.52      | 2.08       | 0.130         |
| 3     | 3        | 28     | 37.84    | 34.33      | 3.42       | 0.122         |
| 4     | 3        | 28     | — (DEC-S026) | — | — | **burst** — 28 pts in ~1.8d; re-est'd 2, drift +4 |
| 5     | 8        | 28     | — (DEC-S026) | — | — | **24.5 pts/wk** — 28 pts over 8d (06-11→06-19); re-est'd 0, drift 0 |
| 6     | 10       | 43     | — (DEC-S026) | — | — | **~38 pts/wk** — 43 pts over 8d (06-21→06-29, work landed 06-28); re-est'd 1, drift +7 (6.6 split a/b, 6.1b added); 6.9 deferred |
| 7     | 2        | 20     | — (DEC-S026) | — | — | **burst** — 20 pts in ~1.1d (06-29→06-30); re-est'd 1, drift 0 (7.0 split a/b); +2 follow-ups shipped (#186, #196) |
| 8     | 2        | 19     | — (DEC-S026) | — | — | **burst** — 19 pts over ~2d (07-01→07-03); re-est'd 3, drift −2 (8.2b lock + 8.6 cut; 8.4 3→5) |
| 9     | 5        | 55     | — (DEC-S026) | — | — | **burst** — 55 pts over ~4.3d (07-01→07-06); re-est'd 1, drift 0 (9.12 collapsed 5→~2 via @architect gate, label held); ~32 PRs, closed at v0.11.0; #247 → P10 |
| 12    | 47*      | 208    | — (DEC-S026) | — | — | **30.6 pts/wk** — 208 pts over 47.6d (07-18→09-03); re-est'd **0**, drift **0** — every planned task closed at its pokered value; **49 issues added mid-phase (135 pts, 65% of delivery)**; 12.13–12.15 → `phase:cutover`; 9 closed issues unpointed. Reservations **not built** at close |
| 13    | 2        | 30     | — (DEC-S026) | — | — | **burst** — 30 pts shipped over 4d (07-31→08-04) against 24 pointed; re-est'd 2, drift **+6** (13.4 filed 3 → shipped 8; #638 2→3); 3 tasks added mid-phase (#635, #638, #645); 16 PRs, closed at v1.1.0, production v1.0.21 |

`*` Phase 12's session and PR counts are **window** counts, not the phase's: Phase 13 completed
inside the same span (2026-08-04) and lanes A and B ran concurrently. 47 session files and 237
merged PRs fall in the window; neither number feeds the rate.

> **Rows 10 and 11 are absent, not lost.** Phase 10's retro exists in `RETROSPECTIVES.md` but its row
> was never appended here; Phase 11 has not been retro'd at all. Phase 13 ran beside 11 and 12 on
> `feature/time-clock` (DEC-059), which is why it closed out of order — and why Phase 12's row above
> carries the window caveat.

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

**Phase 0 total: 17 pts planned** (0.1 + 0.2 = 8 pts completed as pre-ritual setup, untracked by
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
| 3.1a | **Staffing-horizon clock** — horizon-based shift birth (Pending→Filling), Filling-vs-AtRisk split driven by time + pool, "fills by" countdown/deadline | 5 | **[x]** SPEC §1.1. Foundational, built first. **DEC-022** (derived, not stored; `resolveShiftState` layer) + **DEC-023** (explicit `tick`, no scheduler v1). Unblocks 3.2/3.3/3.4 + #20's all-cancelled refinement. Injected `now`. [#39](https://github.com/mobiustripper42/muster/issues/39) · PR #45 |
| 3.1b | **Magic-token reaper** — sweep expired `MagicToken` rows | 2 | **[x]** Split from 3.1 per @architect (different aggregate, not the shift machine). `listAllMagicTokens` already on the port. [#44](https://github.com/mobiustripper42/muster/issues/44) · PR #46 |
| 3.2a | **Escalation substrate + trail** — `nudged`/`pool_widened` events + `escalationTrailFor` projection (the derived read-model 3.3 reads) | 3 | **[x]** SPEC §1.2/§2.5. Pure, additive; no new aggregate/port/DDL. **DEC-024.** Unblocks 3.3. [#40](https://github.com/mobiustripper42/muster/issues/40) · PR #48 |
| 3.2b | **Tier 2 escalation mechanism** — stall detection in `tick` + `escalate()` (widen-stub + direct-nudge); still `Filling`, no Spink | 5 | **[x]** SPEC §1.2 Tier 2. Builds on the ask loop + 3.1a + 3.2a. **DEC-024.** [#47](https://github.com/mobiustripper42/muster/issues/47) · PR #49 |
| 3.3 | **At-Risk derivation** — which shifts land on the board (At-Risk core, late-bail **regression** rocket-to-top, **credential-lapse** on assigned crew before trip) + urgency sort (time-to-trip · gap-severity · fillability) | 5 | **[x]** SPEC §2.5 states/urgency. Pure deriver over shifts + escalation log + credentials. Depends on 3.1. [#41](https://github.com/mobiustripper42/muster/issues/41) · PR #51 |
| 3.4 | **At-Risk board surface** — admin triage worklist: what's-missing, deadline, escalation-transparency string, who's-still-available; empty-as-success; push ping | 5 | **[x]** SPEC §2.5. Reads 3.3. Keep the bar to land high (no anxiety dashboard). Depends on 3.3. [#42](https://github.com/mobiustripper42/muster/issues/42) · PR #52 |
| 3.5 | **Decision surface: lean** — first-class "lean" (manual Tier-2 direct nudge) from a board row | 3 | **[x]** SPEC §2.5. Lean = an ask, no payment fallout. Reschedule/cancel deferred to the payments phase. Depends on 3.4. [#43](https://github.com/mobiustripper42/muster/issues/43) · PR #52 |

**Phase 3 total: 28 pts planned** (3.1 split 8 → 3.1a 5 + 3.1b 2; 3.2 split 8 → 3.2a 3 + 3.2b 5 — both @architect passes, 2026-06-09)

## Phase 4: Pass C — Fast-follows

Bail flow, credential nudges, live-card pings, "changed since reviewed" nudge, split/merge, bulk
weekend-lock, the warming view. *Trigger: friction shows up in real use.* (SPEC §2.3–2.6 deferred
bits.)

Decomposed 2026-06-10 (P3 retro + start-phase). **Ordering logic:** the path to "run a real
weekend" runs through the pilot channel (4.1) and the cockpit (4.2), not builder conveniences —
**split/merge (5), bulk weekend-lock (2), live-card pings (2) deliberately deferred** until real
use demands them. The **hosted deploy** stays out; it pairs with 4.1 (the "go live" moment) and
gets pulled in when the channel is picked. **4.1 floats** — ask Eric at each session start whether
he's ready (web-link vs Telegram decided at 4.1 start); everything else proceeds without it.
**PR grouping** (issues = tracking grain, PRs = coherence grain): A=4.8 alone first · B=4.2+4.3
one run · C=4.4+4.5 one run · D=4.7 alone (decision-bearing) · E=4.6 alone.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 4.1 | **Pilot channel adapter (DEC-MSG-3)** — wire one real adapter (web-link or Telegram) for crew asks + the admin board ping (DEC-026 delivery half) | 5 | **[x]** Web-link relay + operator outbox (DEC-030). Was blocked on operator pick → picked web-link; shipped as an 8-pt unit (planned 5). [#53](https://github.com/mobiustripper42/muster/issues/53) · PR #69 |
| 4.2 | **Assignment cockpit (§2.4)** — upgrade the thin click-through: seat-card actions (assign from ranked pool, nudge, manual override, confirm), fills-by countdown, calm monitor posture; fixes the P3 Bailed-seat-pool gap | 8 | **[x]** One PR with 4.3 (Unit B). @architect pre-pass on the action set. [#54](https://github.com/mobiustripper42/muster/issues/54) · PR #62 |
| 4.3 | **Warming view (§2.4)** — trending-toward-risk inside the cockpit, opened deliberately; never on the board | 3 | **[x]** Rides Unit B. [#55](https://github.com/mobiustripper42/muster/issues/55) · PR #62 |
| 4.4 | **Crew bail flow (§2.6)** — "can't make it" from the shift card → existing `bail()` rails (DEC-019), admin fallout visible | 3 | **[x]** One PR with 4.5 (Unit C). [#56](https://github.com/mobiustripper42/muster/issues/56) · PR #64 |
| 4.5 | **Crew credential nudge (§2.6)** — expiring-credential line in the crew app (reads credential-health) | 2 | **[x]** Rides Unit C (+1 admin-reporter add absorbed). [#57](https://github.com/mobiustripper42/muster/issues/57) · PR #64 |
| 4.6 | **Builder: changed-since-reviewed nudge (§2.3)** — late booking on a locked shift raises it | 3 | **[x]** Scope caution held — domain derivation + minimal render (DEC-029). [#58](https://github.com/mobiustripper42/muster/issues/58) · PR #67 |
| 4.7 | **Board polish: "fills by" deadline** — real fill-deadline concept on `AtRiskRow` + multi-trip times (P3 review follow-up) | 3 | **[x]** Decision-bearing (@architect → **DEC-031**, not 027 as guessed); solo PR. [#59](https://github.com/mobiustripper42/muster/issues/59) · PR #71 |
| 4.8 | **UI chassis** — extract shared `components/ui` Shell/Notice (toned variant as superset) | 1 | **[x]** **Built first** — or 4.2 mints a fourth copy. [#60](https://github.com/mobiustripper42/muster/issues/60) · PR #61 |

**Phase 4 total: 24 pts originally planned → 28 shipped, all 8 tasks `[x]`** (closed 2026-06-12; split/merge, bulk
lock, live-card pings + hosted deploy still deferred — see above). Estimate calibration: 2 re-pointed
(4.1 pilot 5→8; Unit C +1) — net +4 pts, i.e. the original estimate was 4 under.
(The task table below carries the re-pointed values, so it sums to 28.) Closed at **v0.6.0**.

## Phase 5: Pilot-readiness / go-live

Get the build-complete slice to a **real-crew weekend** (2 mates + 2 captains on BrewBoat): hosted
deploy, a production auth path, vessel-local time, and a real Xola-import surface. *Trigger: Phase 4
done — the slice is build-complete but crew-untested.* (Decomposed 2026-06-12, @architect pass.)
**This phase produces the "real weekend" that triggers the post-pilot phases (6 messaging, then 7
crew self-serve — the slot that was Pass D).** It resolves 2 of #70's 4
prod-readiness tells (auth + timezone); Twilio + the single-operator constant stay deferred — the
deployed app is a **hosted pilot, not production**.

**Ordering / smoke path:** 5.3 (no infra dep) ∥ 5.1→5.2 → *live app on synthetic seeds, poke from a
real phone* → 5.4 (real data, needs 5.3) → 5.R last; 5.5 anywhere, first to cut.

**Pilot sequencing (live since 2026-06-15 — `muster-sigma.vercel.app`):** 5.1 + 5.3 done and
**deployed**. Remaining order, decided with operator:
1. **5.2 (auth, #76)** — next; the live app has no front door until the operator can mint a prod
   sign-in link (`/crew/dev-link` 404s in prod).
2. **Pre-crew shakedown on DEMO SEEDS** — run `docs/E2E-PILOT-WALKTHROUGH.md` *(deleted 2026-07-25 —
   pilot-era; the Playwright suite in `e2e/` is the live equivalent)* (the **manual**
   walkthrough, mostly local on `mill-dev`, some on the live deploy). This is the gate before crew —
   **NOT** task 5.5. *Seeds, not real import* (they deterministically hit every branch real data
   wouldn't). The walkthrough's sign-in steps need swapping to 5.2's mint-script for the prod run.
3. **5.4 (import, #73)** — *after* the shakedown passes; swaps demo data for real BrewBoat
   reservations. The import is for the real crew weekend, never before the shakedown.
4. **Crew weekend** → triggers the post-pilot phases (6 messaging, then 7 crew self-serve).
- **5.5 (#65) is the automated Playwright harness — regression insurance, separate from the manual
  shakedown above, optional, first to cut.** Don't conflate the two.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 5.1 | **Hosted deploy + `tick` cron + `production` branch** — Vercel; CRON_SECRET-guarded tick route; production branch + /promote-production; hosted PG provider | 5 | **[x]** **DEC-033** — provider resolved (Neon). Fires DEC-020/023/S022. [#75](https://github.com/mobiustripper42/muster/issues/75) · PR #80 |
| 5.2 | **Production auth path** — prod-minted operator magic link; /crew/dev-link stays 404; crew via DEC-030 relay | 3 | **[x]** **DEC-034**; resolves the auth half of #70. Email provider rejected. [#76](https://github.com/mobiustripper42/muster/issues/76) · PR #82 |
| 5.3 | **Vessel-local time** — one-seam wall-clock→instant via tenant IANA tz + `Intl`; localize render | 5 | **[x]** **DEC-032** (revises DEC-022). No DDL/dep. Resolved the timezone half of #70. Store-instants rejected. [#77](https://github.com/mobiustripper42/muster/issues/77) · PR #79 |
| 5.4 | **Xola import surface** `/admin/import` — upload→preview/validate→importReservations+formShifts→board live | 8 | **[x]** **DEC-035/037**; xlsx upload (5.4a) + live-API pull (5.4b, DEC-036/040). [#73](https://github.com/mobiustripper42/muster/issues/73) · PRs #83, #89, #91 |
| 5.R | **Pilot weekend runbook** — one page seed→import→tick→outbox→triage + pilot-only warning | 2 | **[x]** `docs/PILOT_RUNBOOK.md`; carries #70's pilot-only warning verbatim → closed #70. #68 full manual also shipped this phase (added scope). [#78](https://github.com/mobiustripper42/muster/issues/78) · PR #104 |
| 5.5 | **e2e harness** — Playwright over crew+admin flows | 5 | **[x]** Playwright on :3100 over `muster_test`; CI `e2e` job (non-required). Not cut after all. [#65](https://github.com/mobiustripper42/muster/issues/65) · PR #102 |

**Phase 5 total: 28 pts** (gating for the weekend: 5.1–5.4 + 5.R = 23 pts; 5.5 e2e is the fast-follow/cut
surface). #68 (full operator manual) + #70's Twilio / single-operator tells stay open past this phase
by design. New decisions: **DEC-032** (timezone), **DEC-033** (deploy/provider), **DEC-034** (auth),
**DEC-035** (import) — all proposed 2026-06-12, confirmed at build.

## Phase 6: Messaging & the Smart Doorbell

The crew-app's group-messaging organ + the **Smart Doorbell** (the notify-the-phone engine).
Builds the day-cohort thread the locked spec parked (SPEC §2.6.3 → §4) plus full-mesh threads
(cohort / shift / all-staff / DM) and a generic notification rule engine deciding **when a phone
actually rings**. Net-new scope → folds into a deliberate **SPEC v1.1 unlock** (DEC-014); does not
modify the locked v1.0 crew engine (may enhance it per the artifact §13 — parked). *Inserted ahead
of Pass D per the artifact's priority note (post-pilot, ships with the live crew app).* Source:
`messaging-smart-doorbell.md` (13th artifact); @architect pass 2026-06-21 (Opus — Fable unavailable).

**Load-bearing decisions (operator-confirmed 2026-06-21):**
- **No realtime vendor for v1.** Instant live chat is deferred; v1 ships **refresh-to-see-new**.
  Presence (the doorbell's "is this person looking" signal) rides a **light activity signal behind a
  swap-later seam** (`PresencePort`) — a hosted realtime service (or self-host) drops in later *only*
  if instant chat is wanted. Vercel-fit, zero new dependency. Crew is **20–25** (corrected from the
  old "6"): the doorbell's batch/suppress value is real at that size, but 25 connections is still
  trivial — no infra forcing.
- **The batch/cancel-window interval is a researched, config-tunable default** (task 6.3), *not* the
  artifact's placeholder "~1 min" — chosen deliberately, then tuned on real use ("dumb default, tune"
  posture).
- **DMs are operator-visible for v1** (the §14 privacy question, resolved to ship; private-DM later).

*Trigger: the pilot is live (Phase 5); this is the near-term build that ships with the live crew app.
10DLC registration is in motion (owner-driven) — the real SMS doorbell number (6.9) rides it but
stays off the critical path (DEC-MSG-1 posture).*

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 6.1 | **Message store** — threads (cohort/shift/all-staff/DM) + participants + messages; membership **derived** for cohort/shift/all-staff, only DM persisted (DEC-009-spirit anti-stale); pure core + in-mem adapter + plain DDL | 5 | **[x]** **DEC-051** — derived membership, no snapshot. [#111](https://github.com/mobiustripper42/muster/issues/111) · PR #134 |
| 6.1b | **Canonical messaging subject model** — converge `senderKind` on a `Subject` | 2 | **[x]** **DEC-058**. `Added during P6 (+2)`. [#141](https://github.com/mobiustripper42/muster/issues/141) · PR #142 |
| 6.2 | **Presence / activity signal** — light "is-active" tracking behind a `PresencePort`; realtime-vendor swap deferred | 3 | **[x]** coarse observed signal, swap-later seam. [#112](https://github.com/mobiustripper42/muster/issues/112) · PR #143 |
| 6.3 | **Notification-interval research spike** — pick a sensible default batch/cancel window (read + reason + document); feeds 6.4. Config-tunable | 2 | **[x]** **DEC-060** — batch/cancel 90s, presence 5min. [#113](https://github.com/mobiustripper42/muster/issues/113) · PR #144 |
| 6.4 | **The doorbell decider (pure fn)** — presence-suppression, batch/cancel window, first-only-until-read, priority jump, short-notice-as-text, in-app-toast vs SMS | 8 | **[x]** **DEC-068** — coherent 8, not split. [#114](https://github.com/mobiustripper42/muster/issues/114) · PR #165 |
| 6.5 | **★ Human-drivable doorbell harness** — simulate multiple crew, who's-present-in-which-thread, advance the clock, observe who-rings-vs-silent; extends the fake adapter + `tick-dev.ts` | 5 | **[x]** the decider's observable-behavior spec. [#115](https://github.com/mobiustripper42/muster/issues/115) · PR #166 |
| 6.6a | **Doorbell storage + `sendNotification` port** (substrate) — split from 6.6 | 5 | **[x]** **DEC-069** — two single-writer tables. [#116](https://github.com/mobiustripper42/muster/issues/116) · PR #168 |
| 6.6b | **Doorbell tick + cron + ring relay** (the loop) — split from 6.6 | 5 | **[x]** **DEC-070/073** — separate cron + operator-outbox ring relay. `6.6 split a/b during P6 (+5)`. [#167](https://github.com/mobiustripper42/muster/issues/167) · PRs #169, #175 |
| 6.7 | **Crew messaging UI** — thread list, view + compose, start-DM-from-shift-card, in-app badge/toast (§7.6); **refresh-to-see-new** (instant deferred) | 5 | **[x]** **DEC-071** — read+presence beacon, refresh-to-see-new. [#117](https://github.com/mobiustripper42/muster/issues/117) · PR #171 |
| 6.8 | **Operator messaging surface** — post to cohort / all-staff, cross-thread visibility (§10) | 3 | **[x]** **DEC-072** — cross-visibility + operator ring-exclusion. [#118](https://github.com/mobiustripper42/muster/issues/118) · PR #172 |
| 6.9 | **Second sender number / phone-thread separation** (§5) — scheduling vs doorbell number, both on the crew campaign; the real SMS doorbell adapter | 3 | **[~]** **deferred at P6 retro** — 10DLC-gated, indefinite (weeks+); cut off-phase, manual operator relay ships in its place. [#119](https://github.com/mobiustripper42/muster/issues/119) (open) |

**Phase 6: planned 39 pts; shipped 43 pts** (6.1–6.8 + the 6.1b subject model added mid-phase + the
6.6 split into 6.6a/6.6b; net drift +7). **6.9 deferred** (#119, 10DLC-gated, cut off-phase at retro)
and the #173 DM-visibility disclosure deferred — the messaging core shipped behind a **manual
operator ring-relay**, with Twilio automation the parked final swap. The whole stack landed on `main`
via the DEC-059 `feature/messaging` integration (**PR #179**). **Build order ran as planned
(de-risk first):** 6.1 → 6.2 → 6.3 → **6.4 + 6.5 together** → 6.6 → 6.7 — the harness proved the
invisible doorbell logic before chat UI rode on top.

**Deferred to later fast-follows:** instant live chat (the hosted-realtime swap behind 6.2's seam);
customer-side messaging (§11 — waits on reservations, Tier 4); native push (DEC-MSG-2); read
receipts / typing.

**DECs to pin (drafted with this phase):** v1.1 messaging unlock (DEC-014 batch; absorbs FUTURE_IDEAS
"two-way/multi-party messaging" + part of "keep-warm touch") · presence **observed-only, never
crew-curated** (DEC-009 guard) · **no-realtime-vendor / activity-signal behind `PresencePort`**
(realtime a deferred adapter swap) · doorbell is a **pure core decider** (DEC-001 / DEC-DATA-1) · the
**doorbell tick** (separate cron) · channel port widens with a **`sendNotification` sibling** to
`sendAsk` · **membership derived, not snapshotted** · **DMs operator-visible** v1 · **two sender
numbers** on the crew 10DLC campaign · *(flag)* short-notice-as-text SMS content / TCPA posture —
owner + 10DLC.

---

## Phase 7: Crew Self-Serve — "Pick your shifts"

**Restoration, not a new bet.** Two years ago crew grabbed posted shifts by text — *mates gone in
minutes* — until the chase forced crewing push-only (the ask cascade). A crew member asked to pick
shifts again "because they really liked it." This brings back self-serve picking for the people who
always loved it (mates) and keeps the cascade as the backstop for the ones who never self-served
(captains). Adds (a) a crew-facing **pull** surface to claim an Open seat, and (b) the affordance that
a claim means the **whole vessel-day**. Source: the *Crew Self-Serve* design handoff (2026-06-29);
operator pre-decided, Drew cleared the ops-policy change. New surface → SPEC **§2.7**.

**Key architectural finding (grounds the build):** a `shift` is already `shift-{vessel}-{date}` — one
per vessel per day — with seats attached to the **shift**, not the event, and `formShifts` is idempotent
(a later reservation folds into the same shift's `eventIds`; **Confirmed seats are never reset**). So
"another reservation either side, same crew" is *already built* at day granularity. This feature does
**not** add elastic absorption — it adds a crew pull surface plus the whole-vessel-day affordance.

**Load-bearing decisions (operator-confirmed 2026-06-29 — DEC-074…DEC-079):**
- **A 4th crew surface, recorded as a knowing exception** to BRAND's "three surfaces" (DEC-074). Pull,
  opt-in, anti-anxiety — inherits DEC-042's guardrails verbatim (today default, `[today, today+45d]`
  clamp, no auto-refresh / no live counts, neutral ink). **Not** the parked availability calendar.
- **Self-claim is auto-lock** `Open → Confirmed`, bypassing `Asked` (DEC-075). Operator-confirm-required
  is a **dormant `app_settings` seam** (`self_claim_requires_confirmation`, absent ⇒ auto-lock) — branch
  on the flag now, do **not** build the `Held` tier / confirm queue (that's the parked Pass D primitive).
- **Two eligibility doors** (DEC-076): self-claim = **native role only** (`nativeRole`, captain>mate
  precedence, derived, no migration); operator-assign stays **ratings-inclusive** (the dual-rating
  last-minute fill hack, admin-only). Multi-role is an explicit **NON-GOAL**.
- **Day-granularity commitment** (DEC-077): claiming = crewing every trip that day incl. ones added
  later. Sub-day "watches" are pre-scoped but **deferred**.
- **Guarded transition + one-shift-per-date conflict guard + self-release via the existing bail edge**
  (DEC-078), reliability lead-time-weighted; the claim itself emits no reliability event.

> **Pass D (progressive commitment / soft-hold) is deferred,** not built here. It survives as the
> DEC-075 `self_claim_requires_confirmation` seam and the reserved `Held` tier (SPEC §1.1, §4) — flip
> the flag later, no re-architecture. This phase repurposes the Phase 7 slot from soft-hold to
> self-serve per the handoff.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 7.0 | **Crew front door — sign-in + sign-out** — wire existing `endSession()` to a sign-out button; signed-out `/crew` landing with phone-entry → roster lookup (generic non-enumerating response) → rate-limited `magic_tokens` mint → deliver. MVP delivery = operator-relay-once + 14-day session + **email fallback**; automated SMS deferred (10DLC). Reuses `app/lib/auth.ts` + magic-link core — **no migration** | 5 | **[x]** DEC-079. Shipped split as **7.0a** ([#180](https://github.com/mobiustripper42/muster/issues/180) · PR #190, 3 pts) + **7.0b** ([#189](https://github.com/mobiustripper42/muster/issues/189) · PR #191, 2 pts) — pts preserved (3+2=5). |
| 7.1 | **`nativeRole` + two-door eligibility** — derive `nativeRole(crew)` (captain>mate); add `claimableSeatsFor(crewId, window)` (eligible-pool + native-role + `Pending`/`Filling` + Open + required + `[today, today+45d]`). Operator-assign keeps full-`ratings`. Contract tests both doors incl. dual-rated | 3 | **[x]** DEC-076. Pure domain, no schema. [#181](https://github.com/mobiustripper42/muster/issues/181) · PR #192 |
| 7.2 | **Claim service (`Open → Confirmed`, guarded)** — `claimSeat`: guarded CAS, one-shift-per-date conflict guard, reads `self_claim_requires_confirmation` (default false ⇒ auto-lock; true branch → reserved tier, **stub only**). `releaseSelfClaim`: `Confirmed→Open` via the bail edge + lead-time-weighted reliability event. Race + conflict + reliability tests | 5 | **[x]** DEC-075/078. Reuses bail/CAS/reliability edges. [#182](https://github.com/mobiustripper42/muster/issues/182) · PR #194 |
| 7.3 | **`/crew/open` surface** — the list (§2.7.1) + confirm sheet (§2.7.2, DEC-077 copy with live trip count + call/back window) + "just taken" / "already have a shift that day" handling. DEC-042 guardrails. My-shifts already reflects the new Confirmed seat — **verify, don't rebuild** | 5 | **[x]** DEC-074. Crew app + magic-link auth (§3.2). [#183](https://github.com/mobiustripper42/muster/issues/183) · PR #197 |
| 7.4 | **Cascade coexistence** — confirm the horizon/ask loop skips already-Confirmed seats and a self-released seat re-enters the cascade. **No new code expected** — test + any glue | 2 | **[x]** DEC-078 §2.7.5. [#184](https://github.com/mobiustripper42/muster/issues/184) · PR #199 |

**Phase 7 total: 20 pts.** **Build order: 7.0 → 7.1 → 7.2 → 7.3 → 7.4** (7.0 first; the surface is
unreachable without the front door, DEC-079).

**Fast-follows (NOT Phase 7):** social-proof on half-crewed shifts ("Jake's on this — captain needed");
an active "trip added to your day" push (the live card already shows it on open). **Deferred (DEC'd
non-goals):** sub-day watches (DEC-077); operator-confirm mode / `Held` tier — the old Pass D (DEC-075,
§4); genuine multi-role (DEC-076, §4).

**The one data-model note:** Phase 7 needs **no migration**. `nativeRole` is derived; the
confirm-required flag uses the existing `app_settings` KV. A column (`primary_role` / `role_types.rank`)
is owed only when multi-role graduates from non-goal to feature.

> **Not V1 (parked — SPEC §4 + the 2027 line):** payments (cancel cascade, disputes), customer
> portal, live booking feed replacing CSV. Out of the 2026 build entirely. See `docs/SPEC.md` §4
> and `docs/FUTURE_IDEAS.md`.

---

## Phase 8: Shift Builder — review, edit & gap-aware grouping

Completes the **locked-spec §2.3 Shift Builder** as a production-grade surface: the actionable
**build → review** surface (proposed shifts grouped boat→day, plus the gap/span **split-suggestion**
the time-blind grouper is missing, #203), and the deferred §2.3 edit actions (split / merge /
seat-manning override) Phase 4 cut to its defer list — folding in the **"Shift editor"** FUTURE_IDEA (its one net-new sub-piece, *retime*, stays
parked as Event-Admin §2.2 territory: retiming re-keys `eventId`). **Posture shift (2026-07-01):
the vertical slice is over and the pilot is healthy — from here interfaces ship *fully baked*, not
thin click-throughs.** This surface **sunsets the read-only All-Shifts list** (`/admin/shifts`,
DEC-042's pre-authorized deletion trigger): the Builder absorbs its full-visibility read job, with
the @architect gate preserving DEC-042's anti-anxiety guardrails in the merged surface. Source:
SPEC §2.3 + `shiftboard.jsx` / `shiftdetail.jsx` mockups; #203; FUTURE_IDEAS "Shift editor" (HIGH).
@architect pass 2026-07-01.

**Load-bearing decisions (confirm at build):**
- **Flag, don't auto-split (#203).** `formShifts` stays one-candidate-shift-per-vessel-day; a large
  inter-trip **dead-gap** or a long **total-span** raises a non-destructive "split this?" suggestion
  (thresholds as env knobs, the `derive.ts` tune-later pattern). Auto-splitting would break the
  deterministic-`shift-{vessel}-{date}`-id + idempotency contract.
- **Manual split/merge must survive re-derivation** — the @architect + **new DEC** question (8.3):
  how does a human grouping decision persist when `formShifts` re-derives the vessel-day group? Plus
  the `automationPaused` question (editing a shift carrying a live ask — the Shift-editor writeup's
  own trigger).
- **Builder View mode** (DEC-042 sunset; refined 2026-07-01 from real pilot need — the operator needs upcoming-shift visibility *now*). The calm full-visibility read — **7-day default** + weekend/range presets, neutral ink, tap-through — *absorbing* All-Shifts. Anti-anxiety guardrails intact. Calendar *grid* stays parked (Phase 9); View mode ships as a 7-day **list**. *(The old "Edit mode = per-shift lock" half was **cut** — **DEC-082**: locking is meaningless when Xola owns truth + pushes changes. The Edit affordances are the crew-native actions 8.3–8.5; the View/Edit toggle rides in with 8.3.)*

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 8.1 | **Gap/span split-suggestion detector** (engine) — pure fn, two triggers (inter-trip dead-gap + total-span) over a shift's scheduled trips using the trip-window constants; thresholds as env knobs; expose the flag in the shift read model. Vitest-first, no schema | 3 | **[x]** [#204](https://github.com/mobiustripper42/muster/issues/204) · SPEC §2.3 auto-group · #203 Slice 1 |
| 8.2 | **Builder View mode** (View-only; the Edit=lock half **cut** — DEC-082). Calm full read on `/admin/shifts`: 7-day default + weekend/range presets, neutral ink, tap-through — reuses `deriveAllShifts`, **absorbs `/admin/shifts`** (DEC-042 sunset) + renders the 8.1 split cue | 3 | **[x]** [#205](https://github.com/mobiustripper42/muster/issues/205) · [PR #213](https://github.com/mobiustripper42/muster/pull/213) · SPEC §2.3 · absorbs #100 |
| 8.3 | **Manual Split** — split a vessel-day shift into two; re-derive seats each side. **Introduces the View/Edit toggle** (the Edit-mode shell, ex-8.2b). **@architect + new DEC**: re-derivation survival — sharpened by DEC-082, a manual split must survive the importer re-forming the vessel-day from Xola — + automationPaused | 5 | **[x]** [#206](https://github.com/mobiustripper42/muster/issues/206) · SPEC §2.3 action · Shift editor · #203 Slice 2 |
| 8.4 | **Manual Merge** — merge two proposed shifts on the same vessel-day; inverse of split, rides 8.3's DEC + reconciliation rails. **Carries the crew assignment-change notice subsystem (DEC-084)** — freed side-B crew get a "you're off" relay — so re-estimated 3→5 (@architect). | 5 | **[x]** [#207](https://github.com/mobiustripper42/muster/issues/207) · SPEC §2.3 action · Shift editor · DEC-084 |
| 8.5 | **Seat/manning override** — add a required working hand (gates `Crewed`) / add a supernumerary-trainee seat (non-gating, consumes a pax slot vs COI max); remove an added seat. Reuses `kind: required\|supernumerary` + the `removeSeat` port | 3 | **[x]** [#208](https://github.com/mobiustripper42/muster/issues/208) · SPEC §2.3 · shiftdetail.jsx |
| ~~8.6~~ | ~~Bulk "lock the weekend"~~ — **CUT (DEC-082, locking removed)**. Issue [#209](https://github.com/mobiustripper42/muster/issues/209) closed won't-do | — | — |

**Phase 8 total: 19 pts shipped** (24 planned → 17 after 8.2b Edit=lock + 8.6 bulk-lock cut → 19 as 8.4 grew 3→5. DEC-082: locking is
meaningless when Xola owns truth + changes). Build order: 8.1 ✅ → 8.2 View mode ✅ ([#213](https://github.com/mobiustripper42/muster/pull/213))
→ 8.3 (introduces the View/Edit toggle) → 8.4 → 8.5. **Quality bar: fully-baked surfaces — all states
handled, no thin stubs (2026-07-01 posture).**

**Gates:** @architect light-touch on 8.2 (All-Shifts merge posture); @architect + new DEC before 8.3
(split/merge persistence vs `formShifts` re-derivation; automationPaused).

**Not folded (stay parked — anti-shiny-object, post-slice):** *retime* (Event-Admin §2.2, re-keys
`eventId`); the calendar **grid** rendering (8.2 View mode ships a 7-day **list**; the grid is
FUTURE_IDEAS "Calendar view", Phase 9); Weekend heatmap, **Filter-by-crew** (distinct crew-centric
read surfaces — Phase 9, more valuable as All-Shifts sunsets); per-vessel qualification gate
(oracle); richer call-time model.

---

## Phase 9: Finish the production build — Shift Builder reconciliation + deferred fast-follows

Take the healthy-pilot slice to a **fully-baked production interface**. Two threads: (a) the deferred
Phase-8 fast-follows (#215/#224/#225/#226), and (b) the **design reconciliation + polish of both interfaces** — the admin Shift Builder
+ cockpit (a two-lens adopt/supersede punch-list, `docs/design/BUILDER-RECONCILIATION.md`, ruled on 2026-07-03),
**the crew app** (its own reconciliation, 9.11), and real **navigation** for both (9.12). Headline builds: a **responsive dual-form-factor** builder (a real
desktop-app AND a real mobile-app over one no-JS core — **DEC-085**), a **vessel/role identity palette**
(color that encodes information — **DEC-086**), and the **civil send window** (a pre-launch ask-timing
fix pulled from FUTURE_IDEAS). Wire the **MCP fast-fix loop** first (9.0) — it accelerates the phase.
Source: `docs/design/BUILDER-RECONCILIATION.md`; DEC-085/086; FUTURE_IDEAS (civil-send). @architect gates
on 9.5 (two-pane architecture) and the 9.6 palette.

**Load-bearing decisions (Eric, 2026-07-03):**
- **Two native experiences, one core (DEC-085).** Desktop = multi-pane master-detail (board + shift
  detail side-by-side, `?sel=<id>`); mobile = drill-in / full-screen. Same functions, equal priority,
  **not** a responsive squish. Shared server-rendered cockpit component; CSS picks the panes. No-JS held.
- **Color encodes information (DEC-086).** A calm per-vessel identity hue (same-brand fleet legibility)
  + the existing role hues, added to the DEC-021 locked palette because they carry a *value*, not
  decoration. Identity ≠ risk (DEC-042 neutral-ink intact).
- **Day-grouping blessed** (supersedes SPEC §2.3 "boat then day") — a weekend scans day-by-day (#122);
  recorded in DEC-085 so it's decided, not drift.
- **Civil send window is required before real crews** — asks must not fire at antisocial hours.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 9.0 | **MCP fast-fix loop** — wire Neon MCP (read/diagnose the DB directly; prod writes stay gated behind migrations + out-of-band apply) + Vercel MCP (build logs / deploy status / env / preview URLs). Mostly operator config + a verify pass | 2 | [x] [#230](https://github.com/mobiustripper42/muster/issues/230) · Unblocks the phase; MCP is the sanctioned path around the no-outbound-HTTP limit |
| 9.1 | **#215 retire lock scaffolding** — `lockShift`/`changedSinceReviewed` (`src/builder/lock.ts`), the cockpit "changed since reviewed" nudge, seed scenario-G lock; optional `Shift.lockedAt` prune migration | 3 | [x] [#215](https://github.com/mobiustripper42/muster/issues/215) · DEC-082 cleanup; the cockpit-half was confirmed still-shipping in the reconciliation |
| 9.2 | **#226 split-side collapse notify** — DEC-084 fast-follow: notify crew dropped when a split side collapses (the per-side path merge's survivor-netting can't cover) | 3 | [x] [#226](https://github.com/mobiustripper42/muster/issues/226) · engine + test |
| 9.3 | **#224 trainee → supernumerary seat** — staff a crew member into an added supernumerary seat from the cockpit | 3 | [x] [#224](https://github.com/mobiustripper42/muster/issues/224) · engine + cockpit action |
| 9.4 | **#225 Twilio SMS adapter** — the real SMS class implementing the ask/ring/notice ports (DEC-MSG-1 swap); Drew's test number + env/secrets; 10DLC campaign number later | 5 | [x] [#225](https://github.com/mobiustripper42/muster/issues/225) · notice subsystem already exists; operator wires secrets |
| 9.5 | **Two-pane responsive builder (DEC-085)** — extract the cockpit body into a shared server component; render it as both the `/admin/shift/[shiftId]` route and the desktop right pane; `?sel=` selection; mobile drill-in. **@architect gate**; likely splits 9.5a (extract + shell) / 9.5b (panes + mobile) | 8 | [x] [#231](https://github.com/mobiustripper42/muster/issues/231) · the long pole; the interesting bit is two native form factors over one no-JS core |
| 9.6 | **Board bundle** — trip-line fix (multi-trip run-on, High), neutral-ink seat pips (per-role filled/open + dashed-+ trainee), vessel identity dot + palette (**DEC-086**, @architect), day-grouping bless | 5 | [x] [#232](https://github.com/mobiustripper42/muster/issues/232) · requires an `AllShiftsRow`/`deriveAllShifts` extension for pips |
| 9.7 | **Cockpit / a11y bundle** — manning role `<select>` accessible name (WCAG, High), sub-target tap affordances, entry-aware/dropped back-link, `ok` token contrast (confirm ≥4.5:1) | 3 | [x] [#233](https://github.com/mobiustripper42/muster/issues/233) · all reconciliation "cheap-Med" items |
| 9.8 | **Low polish bundle** — seat-card role glyph (uses the DEC-086 tokens), `aria-hidden` on admin decorative glyphs, unified content width (3xl), `text-faint` tertiary tier, whole-card click target, consistent section-header scale, Crewed-gate summary line, tenant+date in nav | 3 | [x] [#234](https://github.com/mobiustripper42/muster/issues/234) · the reconciliation Low tier, folded in (owner: finish it properly) |
| 9.9 | **Civil send window** — split the staffing horizon into a **runway** (eligibility opens at trip−leadDays) and a tenant **civil send window** (e.g. 08:00–20:00) outside which asks don't fire; eligibility can open any hour, the ask fires at the next in-window moment. Supersedes #157's bare-number tuning. **@architect** (ask-timing change) | 5 | [x] [#235](https://github.com/mobiustripper42/muster/issues/235) · required-before-launch; per-crew learned timing stays a parked LOW stretch |
| 9.10 | **Freshly-spawned-shift cue** — *(owner fork, decide at task start)* a muted "new in the last pull" line (DEC-083 import-diff idiom) **or** formally supersede the SPEC §2.3 "new block needing review" text | 2 | [x] [#236](https://github.com/mobiustripper42/muster/issues/236) · park-or-build |
| 9.11 | **Crew app reconciliation + polish** — the crew counterpart to the Builder pass (an admin-only blind spot): same two-lens (frontend-design + ui-review) reconciliation on the crew surfaces (ask card, my-shifts, `/crew/open`, shift card, threads) vs the crew mockups (`crewapp.jsx`, `Crew App.html`, `assignmobile.jsx`, `mobile*`) → adopt/supersede punch-list → build. The mobile-first surface real crew live in; never reconciled. | 8 | [x] [#237](https://github.com/mobiustripper42/muster/issues/237) · may split at its reconciliation gate; DEC-085 dual-form-factor applies |
| 9.12 | **Navigation** — a coherent **crew IA/nav** (brand-bound: minimal, no dashboard, "insultingly small" intact — **@architect gate**, it's in real tension with BRAND; crew has *no* nav today, 5 surfaces reached by ad-hoc inline links) + finish the **admin nav** (`admin-nav.tsx` is a flat 4-link bar missing `/admin/messages`) | 5 | [x] [#238](https://github.com/mobiustripper42/muster/issues/238) · both form factors |

**Phase 9 total: ~55 pts** (pokered 2026-07-03; **+9.11/9.12** added — crew UI + nav were an admin-only blind spot. Owner: *"55 is fine, just a grind; splitting it would only be window dressing."* 9.5 + 9.11 expected to split at their gates). Suggested
build order: **9.0 → 9.1 → 9.6/9.7/9.8 (admin design bundles) → 9.11 (crew) → 9.12 (nav) → 9.2/9.3 → 9.9 → 9.5 → 9.4**; 9.10 anywhere or cut.
**Gates:** @architect before 9.5 (two-pane architecture), on the 9.6 palette (DEC-086 vs DEC-021), and on 9.12 crew nav (BRAND "insultingly small" tension).
**Quality bar: fully-baked, both form factors first-class (no responsive squish).**

**Not in Phase 9 (parked — production-need scan, 2026-07-03):** per-vessel qualification gate (no
boat-checkouts for BrewBoat), re-import capacity-stomp override (Xola is truth for now). Both stay in
FUTURE_IDEAS.

---

## Phase 10: Production Ops & Onboarding — ✅ COMPLETE 2026-07-08 (shipped at **v1.0.0**)

> **Closed at Phase 10 retro (2026-07-08):** 24/24 pts, 2-day burst, 0 estimate drift. Shipped to
> production at **v1.0.0**. Left open as post-1.0 backlog: #301, #293, #285, #247. Full write-up in
> [`RETROSPECTIVES.md`](RETROSPECTIVES.md).

Everything between "the build is done" and "real crews are on it." Rollout safety, the multi-admin auth
gap, a **full security audit**, support, crew onboarding, and end-user docs. Outline captured
2026-07-03; **pokered formally at `/start-phase` Phase 10** (rough estimates below). Two items are hard
**required-before-launch**: the admin entity (10.2) and the security audit (10.3).

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 10.1 | **Migration↔deploy safety** — resolve the **Neon preview→prod backdoor** (`main` deploys hit the prod DB) + a **pre-promote migration-ledger guardrail** (block `/promote-production` when prod's applied-migration set is behind the repo) | ~5 | [#282](https://github.com/mobiustripper42/muster/issues/282) · FUTURE_IDEAS "Migration↔deploy decoupling"; rollout safety blocker |
| 10.2 | **Admin entity — deprovision + roles** *(required)* — a real admin entity (add/remove individuals), granular roles (full / read-only / scoped), **per-person revoke** (today the only lever is rotating `SESSION_SECRET`, which kills everyone). **@architect + revises DEC-020** "no admin entity" | ~5 | [#283](https://github.com/mobiustripper42/muster/issues/283) · FUTURE_IDEAS HIGH; required once a 2nd admin (Drew) exists |
| 10.3 | **Security audit** *(required)* — full pre-production review: magic-link/session auth, the admin gate + new roles, input handling on all server actions, secrets/env, PII exposure (crew phones, the DM operator-visibility gap), rate-limits, the Neon backdoor | ~5 | [#284](https://github.com/mobiustripper42/muster/issues/284) · pre-launch gate; `/security-review` + a manual pass |
| 10.4 | **Staged rollout + rollback runbook** — who goes live first, the promote sequence, migration ordering (DEC-S009), a tested rollback | ~3 | [#285](https://github.com/mobiustripper42/muster/issues/285) · |
| 10.5 | **Support channel + report path** — a crew/operator-facing "something's wrong" path + a triage cadence (bug→issue flow already exists for the dev side) | ~3 | [#286](https://github.com/mobiustripper42/muster/issues/286) · |
| 10.6 | **Crew onboarding / intro message** — first-contact when a crew member is added (magic link + a plain "what is Muster / how to answer an ask"), plus the **durable re-entry interim** (session-aware root redirect + add-to-home-screen so crew get back to My Shifts) | ~3 | [#287](https://github.com/mobiustripper42/muster/issues/287) · FUTURE_IDEAS "living link" interim |
| 10.7 | **Operator cheatsheet + crew quick-start** — end-user docs (distinct from the dev `CHEATSHEET.md`); = **#68** operator manual | ~3 | [#288](https://github.com/mobiustripper42/muster/issues/288) · ties to the counterintuitive-behavior explainer |

**Phase 10 total: 27 pts (rough — poker at start).** **Required-before-launch:** 10.2 + 10.3 (+ 10.1
if real crews touch preview links).

> **Post-launch priority #1 (VERY HIGH, not a launch gate):** the **reliability loop** — a shift
> `Completed` transition + "did they show — 8/8" attendance capture (DEC-008 is where reliability data
> is born). Without it, the ranked pool stays flat at cold-start forever. Owner: build first *after*
> launch (seeds a later phase — reservations took the P11/P12 slots). FUTURE_IDEAS "Post-shift state".

---

## Phase 11: Reservations — service layer + coexistence (throwaway-thin UI)

**DEC-105–111 (2026-07-11).** Reopens the parked customer-portal / 2027 scope: Muster starts taking real,
paid reservations for a subset of inventory it owns end-to-end, **running alongside Xola** (permanent
coexistence, **not** a cutover, **no** data migration — DEC-105).

**The frame is NOT "thin slice to prove it."** The crew engine was built extra-thin because it was a *bet* —
unproven, so no UI investment until it worked. A reservation system is not a bet; it's known-to-work and
known-to-be-needed. So Phase 11 builds the **service layer properly and tests it adequately**, behind a
**throwaway-thin UI** that exists only to drive one real paid booking end-to-end. **The real customer-facing
UI is Phase 12** (mockup-first). No design investment in Phase 11 — its UI gets thrown away.

**Prime directive:** the crew engine shipped 4 days ago and is exceeding expectations. **Nothing in Phase
11 touches the `xola-pull` cron, the ask `tick`, or the shift/seat state machine.** All work rides
`feature/reservations` behind a `RESERVATIONS` flag (DEC-111); the only shared change — the `source`
discriminator (DEC-106) — is inert (backfills `'xola'`) until a vessel-day is marked Muster-owned. Rollback
is a single flag flip (DEC-108): worst case, ~5 bookings deleted and hand-keyed into Xola.

**Exit gate — one real paid reservation, end to end:** seed one Muster-owned event → availability read →
throwaway booking form → Stripe (deposit) → webhook writes the reservation atomically → it appears on the
vessel-day shift's per-event manifest, with the confirmation link emitted. Proven in Stripe test-mode, then
a single live payment. Correctness and tests are the deliverable here — not looks.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 11.0 | **Partition + `source` discriminator (+ per-event price)** — migration (`Event.source`, `Reservation.source`, backfill `'xola'`, **+ nullable `Event.price`** — DEC-112); importer guard: skip + itemize a Xola event on a Muster-owned vessel-day; Muster-owned-vessel-day config. Contract tests both adapters | 5 | **DEC-106/112** · lands on `main` (inert until a vessel-day is Muster-owned) · @architect gate |
| 11.1 | **Availability read model — whole-boat mutex** — an event is bookable iff it carries **no active `source='muster'` reservation** AND party ≤ `Event.capacity` (remaining = `capacity`-or-`0`, **NOT** `COI − Σ party sizes` — DEC-108/109 amended for whole-boat-private); surface `Event.price` (DEC-112). Pure deriver, **distinct from the crew-eligibility oracle** + tests | 3 | additive, safe on `main` |
| 11.2 | **Stripe charge/refund/deposit service** — `stripe` dep; **lift + audit charge + refund from the sibling `sailbook` project** (deposit + balance-link is the net-new piece); create-session server action, success/cancel routes, env/secrets (Drew's keys). Service-layer + adapter-tested | 8 | **DEC-107** · may be more complex than sized · requires `sailbook` in session scope · @architect gate · likely splits 11.2a lift/audit / 11.2b deposit+balance-link |
| 11.3 | **Booking write + atomic whole-boat claim** — signature-verified idempotent `checkout.session.completed` webhook → writes Muster-native Event(if new)+Reservation under an **atomic whole-boat mutex** (claim iff the event is unclaimed by any active `source='muster'` reservation — DEC-109 amended; same CAS mechanism, **no DB unique constraint**); contract-tested both adapters | 5 | **DEC-109** (REQ-CLAIM-1 sibling) · the correctness task · @architect gate; split webhook-infra vs capacity-guard only if the diff balloons |
| 11.4 | **Booking-link generation + confirmation emit** — generate the DEC-020 capability-URL for the reservation; emit confirmation with the link over email + SMS. Service-layer (copy polish + the manage *page* are P12) | 3 | **DEC-108** · the customer half of the capability-URL ("living link") family — internal name only, never in customer/crew copy |
| 11.5 | **Waiver consent field (pilot)** — checkbox + linked terms + consent timestamp on the reservation | 2 | **DEC-110** · Drew/Spink legal-sufficiency flag · real provider integration is P12 · do **not** build a waiver subsystem |
| 11.6 | **Throwaway booking harness** — the extremely-thin, unstyled `app/(public)` form + availability list that exercises the whole service layer to put one real booking through. **Explicitly disposable — replaced wholesale in P12** | 3 | not customer-quality; just enough to drive the exit gate |
| 11.7 | **Manifest hinge verification** — confirm Muster-native reservations surface on the shift card per-event manifest with no write-back sheet (§2.6.3 / DEC-012 already source-agnostic) | 2 | **test, don't rebuild** |
| 11.8 | **Go-live hardening + rollback runbook** — one real paid reservation end-to-end on the live boat/slot; flag flip; runbook (refunds-manual-in-Stripe, dispute-watch-in-Stripe, single-flip revert, ~5-booking manual rollback incl. Stripe-held money) | 3 | feature → `main` merge gate |

**Phase 11 total: 34 pts (rough — poker at `/start-phase`).** **Owner-gated before 11.2/11.5** (not
before the phase starts): deposit-%, balance timing, refund policy, **which Stripe account**, waiver
provider + legal sufficiency — all Drew/Spink (DEC-107/103).

**Explicitly deferred out of Phase 11:** the **real customer UI** (all of P12), the **`Offering`/experience
catalog** (P11 seeds a single `Event` directly — `Offering` is a P12 entity, derived-or-deferred; DEC-112),
the **insurance-flag build + split-pay** (recorded DEC-113, but a P12 booking-funnel concern), refund cascade
(§3.3), dispute surfacing (§3.4), customer self-service cancel/reschedule, deposit auto-charge (saved card),
and multi-boat / full-catalog selling.

> **Verified model of record:** `docs/design/reservations-model.md` (whole-boat-private, one reservationist;
> `Offering → Event(one boat, per-event price) → Reservation`; whole-boat mutex not pooled seats; insurance
> as a flag). @architect-verified 2026-07-11. Grounded in `docs/design/the-booking-1.md`,
> `the-living-link-1.md`, and the Xola seller screens (`docs/design/xola *.png`).

---

## Phase 12: Reservations — the real customer UI + flip new sales — ⛔ CLOSED 2026-09-03, not complete

> **Closed, not delivered.** All thirteen planned build tasks shipped at their pokered value and
> reservations is still not built — see `docs/RETROSPECTIVES.md` § Phase 12 and the § Outcome block
> below. The phase is closed so the next one can be planned against the §2.8 audit rather than
> against this table.

*Trigger: Phase 11's service layer proved out. Design is **DONE** (S54–S56): every surface mocked + approved
(`docs/design/mockups/`, `index.html`), and the model settled across **DEC-123** (two surfaces — a
customer-centric reservation calendar beside the crew shift view — plus a net-new catalog and
purchases/customers area), **DEC-124** (gratuity collect-and-expose), **DEC-125** (virtual availability),
**DEC-126** (the cutover), and **DEC-109 amended** (guest-count claim + 15-min hold + permanent pessimistic
backstop). @architect + @ui-reviewer passes are folded in.*

**Build state.** The P11 service layer **is built** on `feature/reservations` (`src/reservations/*`,
Stripe adapter, webhook) — but to the **pre-DEC-125/109 model** (eager events, simple CAS). So P12 is a mix:
some tasks **revise** the service layer to the settled design, the rest **build the real UI** (customer
funnel + admin) and the **cutover**. All code rides `feature/reservations`; it merges to `main` **once**, at
the customer-ready flip.

**Cutover, not drain (DEC-126 — corrects the old "drains naturally" framing).** The flip is pilot
coexistence → a **one-time full Xola import** → Muster owns reservations (money stays in Xola for imported
bookings) → **reversible**. Not the historical-migration bogeyman — a controlled, rollback-able cutover.

**Two mechanism tasks are `@architect`-gated at build** — the **claim + hold** (DEC-109) and the **cutover
import + rollback** (DEC-126). Both want a pass reading **sailbook**'s real payment/hold code, not an inline
design. Design method (mockup-first) is already **complete** for P12; what remains is build.

**Poker one at a time** — `Effort` is `?` until each is pokered. `@architect`-gated tasks get the design pass
at build, not before poker.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 12.0 | **Virtual availability read model (DEC-125)** — replace 11.1's eager deriver with computed open slots `schedule × vessels × dates × muster-owned-days − blocks − bookings`; lazy materialization; the owned-days mask (pilot-only, moot post-cutover) | 5 | **`@architect`** · revises `src/reservations/availability.ts` · [#453](https://github.com/mobiustripper42/muster/issues/453) |
| 12.1 | **Claim + 15-min hold + boat-assignment (DEC-109 amended)** — revise write-booking/webhook: hold-acquire → Stripe → **pessimistic atomic write-claim** on the slot identity `(vessel,date,time,source='muster')`; fit-and-fallback over the departure's boats; **refund-and-notify the loser**. Hold lifted from sailbook | 8 | **`@architect`** · **the correctness hinge** · needs `sailbook` in scope · [#454](https://github.com/mobiustripper42/muster/issues/454) |
| 12.2 | **Pricing composition** — extra-guest price (`Offering`-level) + **ordered** price-variations (first-match, no stacking) over `Event.price`; fare = base + extras + gratuity | 3 | DEC-112 · additive · [#455](https://github.com/mobiustripper42/muster/issues/455) |
| 12.3 | **Gratuity collect + Muster payroll tip report (DEC-124, amended)** — first-class gratuity table (pre/post kind, tax/fee-exempt, routes to crew); **pre-tip required at checkout** + post-trip on the manage link; **Muster generates its OWN Gusto report** — even-split-per-crew + Gusto CSV, **lifted from `xola-tip-extractor`** — for Muster-side tips. **Deferred: the Xola tip reader / union** — during the transition the operator gets two lists (Muster's Gusto report + the extractor's) and adds them by hand, as they did for ~2 years. The full in-Muster Muster+Xola union is a post-P12 / Xola-sunset task, transition TBD. | 5 | P12 = collect + Muster Gusto report (lift split+CSV); union deferred · reuses `/admin/payroll` · amends DEC-124 · [#456](https://github.com/mobiustripper42/muster/issues/456) |
| 12.4 | **Offerings list + availability picker** — the customer browse-and-pick (offering → date → time) reading 12.0; offerings-list dormant at one offering | 5 | replaces the P11 throwaway harness · [#457](https://github.com/mobiustripper42/muster/issues/457) |
| 12.5 | **Booking form + checkout kickoff** — guest count + extras + waiver consent + pre-gratuity → Stripe create-checkout; **customer never picks a boat** | 8 | drives 12.1 · [#458](https://github.com/mobiustripper42/muster/issues/458) |
| 12.6 | **Confirmation + manage page (the booking link, DEC-122)** — "your booking" behind the capability-URL; post-trip gratuity; change-arrival / cancel / refund. Copy: **"your booking link", never "living link"** | 5 | DEC-122 (feature-side) · [#459](https://github.com/mobiustripper42/muster/issues/459) |
| 12.7 | **Link recovery** — public "lost your link?" → email-or-phone + last name → re-send the existing link to the contact on file (never shown from typed input; bearer-token safe) | 3 | exact-match fields to confirm w/ operator · [#460](https://github.com/mobiustripper42/muster/issues/460) |
| 12.8 | **Offering catalog** — create/edit: content, photos, `Location`, vessels, schedule, ordered price-variations, add-ons, gratuity config, extra-guest price; Draft/Live/Hidden | 8 | the largest single build (DEC-123 §catalog) · **split → ~13 if it balloons** (content/schedule vs pricing/add-ons) · [#461](https://github.com/mobiustripper42/muster/issues/461) |
| 12.9 | **Vessel + Location admin** — Vessel (capacity/hue/home; take-out-of-service → block) + Location (pickup + route + map link; block entry point). Small CRUD twins | 5 | Vessel = the crew engine's boat, Xola-sourced today · [#462](https://github.com/mobiustripper42/muster/issues/462) |
| 12.10 | **Blocks surface** — the **single** availability-subtraction registry: location / vessel / hold blocks + calendar-made single-slot blocks, all listed here | 5 | DEC-125 · [#463](https://github.com/mobiustripper42/muster/issues/463) |
| 12.11 | **Reservation calendar (admin, customer-centric)** — day grid, Open/Sold, **sell-from-calendar**, per-reservation detail pane (roster, change arrival, cancel, refund, resend link, message) | 8 | DEC-123 · sell-from-calendar shares the 12.1 claim · **near-certain split** (calendar/grid vs detail-pane actions) · Fable candidate · [#464](https://github.com/mobiustripper42/muster/issues/464) |
| 12.12 | **Purchases & customers** — order list + detail (refund, resends, payment summary, guest roster); customer contact record; **"Message" via the customer sender (#119)**, never the crew line | 5 | DEC-123 · [#465](https://github.com/mobiustripper42/muster/issues/465) |
| 12.13 | **Waiver: decide the provider + approach (DEC-110)** — a **spike** to pick the e-waiver provider and integration shape (per-guest vs per-booking; hosted-form+webhook vs embed). **The actual integration re-pokers once decided.** Waivers are **mandatory** — only the decision is deferred, not the requirement | 3 | owner-gated (Drew/Spink) · integration build is a follow-on task · [#466](https://github.com/mobiustripper42/muster/issues/466) |
| 12.14 | **One-time Xola import + cancel imported reservations in Muster (DEC-126)** — map Xola reservations → Muster `Event`/`Reservation` (reuse DEC-036/040 field work, **one-time not recurring**); the existing **`source` discriminator** (DEC-106) already tells the UI the money lives in Xola — no new flag; **cancel an imported reservation IN MUSTER** (frees the slot) — the thing you can't do today. **No write to Xola** — the operator refunds manually in Xola | 5 | **`@architect`** · amends DEC-126 (manual Xola refund, no write) · [#467](https://github.com/mobiustripper42/muster/issues/467) |
| 12.15 | **Rollback export + flip/broaden (DEC-126)** — the reversible-cutover export (Muster forward-book → Xola re-key) + its credibility window; move new sales to Muster; broaden owned inventory pilot → full catalog | 5 | **`@architect`** · feature → `main` merge gate · [#468](https://github.com/mobiustripper42/muster/issues/468) |

### Outcome — closed at the Phase 12 retro, 2026-09-03

All thirteen planned build tasks shipped at exactly their pokered value — **73/73 pts, zero
re-estimates, zero drift**:

`[x]` 12.0 [#453](https://github.com/mobiustripper42/muster/issues/453) ·
`[x]` 12.1 [#454](https://github.com/mobiustripper42/muster/issues/454) ·
`[x]` 12.2 [#455](https://github.com/mobiustripper42/muster/issues/455) ·
`[x]` 12.3 [#456](https://github.com/mobiustripper42/muster/issues/456) ·
`[x]` 12.4 [#457](https://github.com/mobiustripper42/muster/issues/457) ·
`[x]` 12.5 [#458](https://github.com/mobiustripper42/muster/issues/458) ·
`[x]` 12.6 [#459](https://github.com/mobiustripper42/muster/issues/459) ·
`[x]` 12.7 [#460](https://github.com/mobiustripper42/muster/issues/460) ·
`[x]` 12.8 [#461](https://github.com/mobiustripper42/muster/issues/461) ·
`[x]` 12.9 [#462](https://github.com/mobiustripper42/muster/issues/462) ·
`[x]` 12.10 [#463](https://github.com/mobiustripper42/muster/issues/463) ·
`[x]` 12.11 [#464](https://github.com/mobiustripper42/muster/issues/464) ·
`[x]` 12.12 [#465](https://github.com/mobiustripper42/muster/issues/465)

`[~]` **12.13 / 12.14 / 12.15 moved out** to the `phase:cutover` label (13 pts) —
[#466](https://github.com/mobiustripper42/muster/issues/466),
[#467](https://github.com/mobiustripper42/muster/issues/467),
[#468](https://github.com/mobiustripper42/muster/issues/468). Cutover work waits on reservations
being built; it is not phase work.

**And the phase still ended with reservations not built.** The §2.8 conformance audit
(`docs/audit/2026-08-29-spec-2.8-conformance.md`) verdicted 24 criteria: BUILT 9, BUILT-with-a-gap 2,
PARTIAL 6, UNPROVEN 2, **NOT BUILT 5**.

### Drift reconciliation — 49 issues added during P12, none pokered against this plan

Added mid-phase and closed; **135 pts, 65% of everything the phase delivered.** None of these
existed at the 2026-07-18 poker and none added a row here at the time. Listed at the P12 retro so
the plan matches what happened. A `—` in Points means the issue carries no `points:` label and is
excluded from every total.

| Issue | Title | Points |
|-------|-------|--------|
| [#472](https://github.com/mobiustripper42/muster/issues/472) | Phase 12.1b — Refund-on-loss + DEC-107 amendment (DEC-109) | 5 |
| [#474](https://github.com/mobiustripper42/muster/issues/474) | Balance-due math must include extra-guest charges (deposit mode undercollects) | — |
| [#476](https://github.com/mobiustripper42/muster/issues/476) | Phase 12.3b — Gusto payroll tip report (even-split + CSV, DEC-124) | 3 |
| [#483](https://github.com/mobiustripper42/muster/issues/483) | bail() and vacateSeat() fire asks inline — pre-horizon pool blast, bypassing t | — |
| [#489](https://github.com/mobiustripper42/muster/issues/489) | Importer never reconciles a vanished Xola event — strands a phantom shift | — |
| [#574](https://github.com/mobiustripper42/muster/issues/574) | Deposit-mode balance is repriced from the LIVE tax rate — a completed charge s | — |
| [#575](https://github.com/mobiustripper42/muster/issues/575) | A declined card leaks a second 15-minute hold onto a second boat — retries can | — |
| [#613](https://github.com/mobiustripper42/muster/issues/613) | Paid-but-unbooked path throws on the payments FK — customer charged, no reserv | 3 |
| [#614](https://github.com/mobiustripper42/muster/issues/614) | A Muster-native booking never produces a crewable shift — formShifts' only tri | 3 |
| [#615](https://github.com/mobiustripper42/muster/issues/615) | Imported Xola reservations are invisible to the Muster sell funnel — the doubl | 5 |
| [#616](https://github.com/mobiustripper42/muster/issues/616) | No cancel or refund exists anywhere in the product — and a Stripe-dashboard re | 8 |
| [#617](https://github.com/mobiustripper42/muster/issues/617) | Deposit mode is the default: 75% of revenue depends on the operator manually t | 2 |
| [#618](https://github.com/mobiustripper42/muster/issues/618) | Five env vars required for reservations are documented nowhere — DEPLOY.md has | 2 |
| [#619](https://github.com/mobiustripper42/muster/issues/619) | No cancellation/refund policy exists — refund-terms.ts is cited in code and is | 2 |
| [#620](https://github.com/mobiustripper42/muster/issues/620) | /book advertises slots someone is mid-payment on — holds are never passed to t | 2 |
| [#622](https://github.com/mobiustripper42/muster/issues/622) | Add-ons can be defined and attached but never sold — the booking flow has zero | 3 |
| [#678](https://github.com/mobiustripper42/muster/issues/678) | Create Stripe Customers, keyed to Muster's customer identity | 5 |
| [#679](https://github.com/mobiustripper42/muster/issues/679) | Send our form's contact details to Stripe (billing_details, description, recei | 2 |
| [#685](https://github.com/mobiustripper42/muster/issues/685) | The sold-out refund notice is still UCS-2 — the em-dash fix landed one file ov | 1 |
| [#686](https://github.com/mobiustripper42/muster/issues/686) | The operator cannot give a customer their booking link back — and nobody can g | 3 |
| [#687](https://github.com/mobiustripper42/muster/issues/687) | Every outbound message should land in the outbox automatically — nothing recor | 5 |
| [#688](https://github.com/mobiustripper42/muster/issues/688) | Remove ownership — Muster should sell every day the offering allows, minus blo | 5 |
| [#691](https://github.com/mobiustripper42/muster/issues/691) | The whole-boat mutex is not defeat-proof — two overlapping bookings on one hul | 5 |
| [#693](https://github.com/mobiustripper42/muster/issues/693) | The legacy 11.2 booking path skips the hull-overlap guard — an unguarded fallb | 2 |
| [#696](https://github.com/mobiustripper42/muster/issues/696) | An already-signed-in crew member still has to tap "sign in" on every magic lin | 2 |
| [#699](https://github.com/mobiustripper42/muster/issues/699) | Validation error on a NEW record silently loads an existing one and destroys t | — |
| [#700](https://github.com/mobiustripper42/muster/issues/700) | The operator's calendar shows what Muster could sell, not what the boats are d | 5 |
| [#701](https://github.com/mobiustripper42/muster/issues/701) | The Xola importer creates no customers — 39 imported reservations, 0 linked | 3 |
| [#702](https://github.com/mobiustripper42/muster/issues/702) | Several offerings can sell one boat at one time — the calendar draws their ope | 3 |
| [#703](https://github.com/mobiustripper42/muster/issues/703) | An open slot on the calendar isn't clickable — blocking one departure means go | 3 |
| [#704](https://github.com/mobiustripper42/muster/issues/704) | Imported Xola trips are inert on the calendar — the operator can't open a book | 3 |
| [#705](https://github.com/mobiustripper42/muster/issues/705) | The hull-day advisory lock guards booking but not saveEvent — an import can in | 3 |
| [#709](https://github.com/mobiustripper42/muster/issues/709) | The admin and crew menus should be one thing — account actions at the end, and | 5 |
| [#713](https://github.com/mobiustripper42/muster/issues/713) | checkout_holds is never pruned, and /book now scans all of it on every render | 2 |
| [#715](https://github.com/mobiustripper42/muster/issues/715) | Guest count belongs above the date picker — and availability should filter to  | 5 |
| [#723](https://github.com/mobiustripper42/muster/issues/723) | Stripe disputes and failed payments are still invisible — charge.dispute.* and | — |
| [#724](https://github.com/mobiustripper42/muster/issues/724) | A cancellation records no reason — the refund amount is the only trace of why | — |
| [#726](https://github.com/mobiustripper42/muster/issues/726) | Two simultaneous refunds of different amounts both pay out, and the ledger rec | 3 |
| [#728](https://github.com/mobiustripper42/muster/issues/728) | fetchOrders 404s on page 2 — any Xola pull holding 100+ orders silently stops  | 3 |
| [#731](https://github.com/mobiustripper42/muster/issues/731) | Every CI build depends on fonts.gstatic.com being up — self-host IBM Plex inst | 2 |
| [#736](https://github.com/mobiustripper42/muster/issues/736) | RESERVATIONS tests === "true" while every other flag tests === "1" | 2 |
| [#741](https://github.com/mobiustripper42/muster/issues/741) | Booking links should be a short code, not a 129-character HMAC URL — and doing | 5 |
| [#765](https://github.com/mobiustripper42/muster/issues/765) | A Muster booking that grows a crewed shift notifies nobody — and after the Xol | 3 |
| [#769](https://github.com/mobiustripper42/muster/issues/769) | The crew app should show what changed, dismissible per person — the other half | 5 |
| [#777](https://github.com/mobiustripper42/muster/issues/777) | The admin board alert is 2 SMS segments and should be 1 — three decorative gly | — |
| [#799](https://github.com/mobiustripper42/muster/issues/799) | Unauthenticated scripted requests can park checkout holds and deny the whole b | 5 |
| [#801](https://github.com/mobiustripper42/muster/issues/801) | Login failure window gates ahead of the hash compare — locks out the correct c | 3 |
| [#803](https://github.com/mobiustripper42/muster/issues/803) | A cancelled booking still shows the guest a balance due before a trip that is  | 2 |
| [#804](https://github.com/mobiustripper42/muster/issues/804) | Re-anchor /book's forward-paging e2e — the seed's season no longer leaves an e | 2 |

**Phase 12 total: 16 tasks, 86 points** (pokered 2026-07-18). The three 8s — 12.1 claim, 12.8 catalog,
12.11 calendar — are near-certain splits that push realized points higher; 12.13 is a decision spike whose
integration re-pokers; the tips apparatus-move + Xola-union (DEC-124) is a post-P12 follow-on. The admin
half (12.8–12.12) is confirmed the larger half, as the plan's earlier ⚠️ predicted.

**Watch for** the point where own-booking volume makes an **in-app refund/cancel surface** (§3.3) worth
pulling out of the Stripe dashboard — a candidate Phase 13, not a P12 commitment. **The cutover IS now a
phase** (DEC-126, 12.14–12.15) — a controlled, reversible one; the thing that stays out of scope is a *hard*
historical migration with no rollback.

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

## Phase 13: Time Clock & Payroll Hours — ✅ COMPLETE 2026-08-04 (shipped at **v1.1.0**, production **v1.0.21**)

> **Authored at the Phase 13 retro (2026-08-05), not before it.** This phase ran without a plan
> section: the rows were written on 2026-07-31, never merged (PR #650, closed deliberately), and had
> gone stale — they described 5 tasks and 16 points against a phase that ran 8 tasks and shipped 30.
> What follows is reconstructed from the issues and the shipped code. The original intent survives on
> `task/phase-13-plan-rows` and `claude/muster-time-clock-d61kju`; neither is deleted.

Crew clock in and out on their own phone, and a per-pay-period hours report to hand to payroll. Ran
on **`feature/time-clock`** beside Phase 12 rather than after it (DEC-059) — reservations was running
long and the two share no tables. Task PRs targeted the feature branch; it reached `main` in one merge
(#658) once the whole thing was prod-ready.

**What it replaces.** `/admin/payroll` already reported per-crew hours, but *estimated* from confirmed
seats — `src/admin/payroll.ts` says "not a punch clock" in its own header. Phase 13 makes the real
number exist and puts it **beside** the estimate rather than over it, so the two can disagree visibly.

**The four calls** (operator, 2026-07-31 — DEC-144): a free-standing punch with the shift
auto-matched only when unambiguous; **honor system** (no geofence, no device binding, no photo);
**a missed clock-out is flagged, never auto-closed** — Muster does not invent a time that becomes a
paycheck; **exact minutes, decimal hours**, no rounding policy in the code.

**One rule emerged during the phase that wasn't in the brief.** Three report conditions needed
deciding, and they resolved to a single principle: **block the export when a guaranteed action clears
the condition; warn when the state may be legitimate.** An open punch blocks (close it). An overlap
blocks (decide which punch is wrong). A confirmed seat with no punch only warns — the zero may be
correct, and gating on it would stop payroll for the whole crew over one no-show. Recorded in
SPEC §2.9.6.

| # | Task | Est | Status |
|---|------|-----|--------|
| 13.0 | **Ask vocabulary: In/Out → Yes/No** — the ask card, the ask SMS, the help page, the operator-as-crew buttons. PR'd straight to `main`, not the feature branch | 2 | [x] [#630](https://github.com/mobiustripper42/muster/issues/630) |
| 13.1 | **Time punch domain + persistence** — `TimePunch`, `clockIn`/`clockOut`, shift auto-match, adapters, and the partial unique index making one open punch per person structural | 5 | [x] [#625](https://github.com/mobiustripper42/muster/issues/625) |
| 13.2 | **Crew `/crew/time`** — one card, one button, server-rendered, phone-primary | 3 | [x] [#626](https://github.com/mobiustripper42/muster/issues/626) |
| 13.3 | **Admin `/admin/time-clock`** — the repair bench: add, edit, close, delete; provenance stamped and shown | 3 | [x] [#627](https://github.com/mobiustripper42/muster/issues/627) |
| 13.3.5 | **Crew edit their own punches**, with a reason on the record | 3 | [x] [#635](https://github.com/mobiustripper42/muster/issues/635) · *added mid-phase* |
| 13.4 | **Hours report + reconcile + `gusto.csv`** — one file carrying hours **and** tips | 3 → **8** | [x] [#628](https://github.com/mobiustripper42/muster/issues/628) · *re-estimated* |
| 13.5 | **A Confirmed seat with no punch** is named, linked, and warns — never blocks | 2 → **3** | [x] [#638](https://github.com/mobiustripper42/muster/issues/638) · *added mid-phase, re-estimated* |
| 13.6 | **Overlapping punches** are named, linked, and **block** the export | 3 | [x] [#645](https://github.com/mobiustripper42/muster/issues/645) · *added mid-phase; rewritten from a write guard to a report condition* |

**Phase 13 actual: 8 tasks, 30 points shipped against 24 pointed** — a 4-day burst (07-31 → 08-04),
16 PRs, 2 sessions. The original plan called 5 tasks and 16 points; the three added tasks
(#635, #638, #645) are all operator asks raised while reviewing the task before them, which is the
phase's real shape: each surface, once seen, produced the next one.

**Ships dark.** `TIME_CLOCK` is off by default; with it unset the routes 404, every server action
refuses, and `/admin/payroll` does not query `time_punches` at all. Go-live is a separate deliberate
flip after the deploy.

**Carried out of the phase:** [#659](https://github.com/mobiustripper42/muster/issues/659) (e2e
sign-in fixture race — live in CI, 11 specs exposed) and
[#660](https://github.com/mobiustripper42/muster/issues/660) (overlapping punches straddling a
pay-period boundary go undetected — money path). Both found by code review run *after* the code
shipped, which is the phase's clearest process miss.

---

## Phase Boundary Checklist

At the end of every phase:
1. All tests green (the runner chosen at 0.3; UI/integration tests join at M4).
2. @pm phase retrospective — velocity check, timeline update.
3. Write retrospective entry in `docs/RETROSPECTIVES.md` (velocity, scope changes, process notes,
   forecast update) — `/retro` does this.
4. Version bumps once `package.json` exists — `/retro` minor-bumps at phase close; patches come from `/promote-production` on each ship (this project has a `production` branch, DEC-S022).
5. Review docs against intent; `/doc-consistency-check` if multiple docs moved.

---

## Cuttable Tasks (if behind)

The slice's milestones each stub aggressively (build plan §3 "stubbed/out"), so the cut surface is
the **thickening passes**, not the slice. Reference before any scope-cut conversation.

| Task | Why it's cuttable | Defer to |
|------|------------------|---------|
| Pass D — progressive commitment / soft-hold (deferred; was the Phase 7 slot, now Crew Self-Serve) | Soft-hold is an anxiety-reducer, not load-bearing; the single-horizon slice works without it. Survives as the DEC-075 `self_claim_requires_confirmation` seam | post-self-serve, only if a real weekend asks for it |
| Pass C bits (split/merge, bulk lock, warming view) | Single-item versions cover the pilot | when friction appears |
| Write-back sheet (DEC-011) | Unnecessary if the CSV export carries guest detail (decide at M1) | skip unless M1 says otherwise |
