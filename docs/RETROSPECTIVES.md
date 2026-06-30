# Muster — Retrospectives

Phase-end retrospectives. Written by `/retro` at each phase boundary — velocity, scope changes,
process notes, forecast update. One entry per phase, newest at the top.

## Phase 7 — 2026-06-30 — Crew Self-Serve ("Pick your shifts")

**Points:** 20 / 20 planned (100%)
**Span:** ~1.1 days (2026-06-29 13:45 → 06-30 17:01) — burst (<7d)
**Throughput:** burst — 20 pts in ~1.1d (no per-week rate quoted; sub-7-day phase)
**Estimate calibration:** 1 re-estimated (7.0 split into 7.0a/7.0b, points preserved), net drift 0
**Sessions:** 2 (S32, S33)   **PRs merged:** ~13 in window; 7 versioned at this retro (→ v0.8.2–0.8.8), the 7.0a/7.0b/7.1 PRs rolled up in the v0.8.0/v0.8.1 interim release
**Issues:** 6 created, 6 closed, 0 moved

### Phase throughput line
| Phase | Date | Points | Span(d) | Throughput | Re-est'd | Net drift | Sessions | PRs |
|-------|------|--------|---------|------------|----------|-----------|----------|-----|
| 7 | 2026-06-30 | 20 | ~1.1 | burst — 20 pts in ~1.1d | 1 | 0 | 2 | ~13 (7 versioned) |

### What worked
- "Very tight turnaround." (Densest burst the project's logged — 20 pts in ~1.1d across two effectively-continuous sessions.)

### What didn't
- (None raised — retro kept terse.)

### Changes for next phase
- (None raised.)

### Scope changes
- **7.0 split** into 7.0a (#180, sign-out + 6-digit code sign-in, dark/fake delivery, PR #190) + 7.0b (#189, real Resend email, PR #191) — points preserved (3+2=5).
- **+2 follow-ups** pulled in to end out the phase: **#186** (ring-relay: no-phone crew relayable via Web Share, PR #200) and **#196** (seat provenance — the "Added for you" badge fix, migration **0013**, PR #201). #196 closed a loop 7.3's own code review opened.
- **Deferred as designed:** Pass D / Held-tier (DEC-075 seam), genuine multi-role (DEC-076), sub-day watches (DEC-077).
- **Shipped DARK:** `CREW_SELF_SERVE` stays off until the operator's Resend DKIM/DNS + Vercel env steps land (out-of-band, not on the velocity plan). "Phase 7 closed" = code shipped, not crew-self-serve live.

### PM read
**Pace.** 20 points in ~1.1 days is the densest burst this project has logged — tighter than Phase 4's 28-in-1.8d per-day, and the two sessions were effectively continuous (S32 closed 00:50Z, S33 opened 01:02Z — a session rotation, not a rest). It's also the smallest *planned* phase since Phase 2, reading as scoping discipline returning after Phase 6's 43-pt high-water mark: one coherent vertical, not a sprawling arc.

**Scope.** 20/20, net drift 0 — fourth straight phase where variance is *added* scope, not missed estimates. The lone re-estimate (7.0 → 7.0a/7.0b) preserved points. The two follow-ups pulled in to "end out 7" are both healthy: #196 closed a loop *7.3's own review* opened; #186 pulled a Phase 6 tail forward. Deferrals (Pass D, multi-role) stayed parked behind DEC-075/076 as designed.

**Patterns.** Strict layering paid off — read door → write door → surface → verification, with the two doors sharing exported constants so they can't drift. Review earned its keep seven phases running (the 7.1 UTC-vs-vessel-local window bug, the 7.2 cross-seat race, #186's dead-end copy). And the **merge-train DEC collision recurred again** (#188 took DEC-080 → forced DEC-081) — a three-plus-time offender; the "stack DEC-touching PRs" advice is still unheeded.

**On your answer.** "Very tight turnaround" is accurate — but tight was *bought*: by the build order being right so every dependency was already merged, and by review catching the window bug and the race before they hit *real crew*. Small tension worth naming — "tight turnaround" closes fast, but you then pulled in two extra items, the opposite instinct. Both fine; the planned set was tight, the extra scope stretched the calendar. The thing keeping a fast going-live phase safe is the `CREW_SELF_SERVE` dark flag — not the speed.

**Forward.** "Phase 7 closed" = shipped *dark*, not crew-self-serve-live; the flag flip is gated on the operator's Resend/Vercel steps, out-of-band. Two review forward-notes that rot if left in Next-Steps: the cross-seat double-confirm race may want a DEC-078 amendment (decide at a seam, not a comment), and `committedDatesByCrew` is a full scan wanting a durable index before the roster grows.

## Phase 6 — 2026-06-29 — Messaging & the Smart Doorbell

**Points:** 43 / 39 planned (110%) — +4 net (6.1b added +2, 6.6 split +5, 6.9 deferred −3)
**Span:** 8 days (2026-06-21 → 2026-06-29) — work landed 2026-06-28 via the `feature/messaging`→`main` merge; 6 issues bookkeeping-closed the next day
**Throughput:** ~38 pts/calendar-week (43 pts over 8d; ~43/wk to the 06-28 merge)  ← headline (span ≥7d) — read as one big integrated landing, not even drip
**Estimate calibration:** 1 re-estimated (6.6: labelled 5 → split into 6.6a+6.6b, +5), 1 added mid-phase (6.1b subject model, +2); net drift +7. Every other task hit its original estimate exactly.  ← keeps the point unit honest
**Sessions:** 10 in window   **PRs merged:** 30 since the Phase-5 v0.7.0 close
**Issues:** 10 `phase:6` closed; 2 deferred off-phase and left open (#119 Twilio 6.9, #173 DM-visibility disclosure)

### Phase throughput line
| Phase | Date | Points | Span(d) | Throughput | Re-est'd | Net drift | Sessions | PRs |
|-------|------|--------|---------|------------|----------|-----------|----------|-----|
| 6 | 2026-06-29 | 43 | 8 | ~38 pts/wk (work landed 06-28) | 1 | +7 | 10 | 30 |

### What worked
- First use of a feature branch was smooth and establishes a great pattern. Able to throw in a few quick fixes (straight to main) while still developing on the feature branch. *(DEC-059 validated — the stay-promotable trunk let #174/#178 ship mid-feature.)*

### What didn't
- Overall very smooth, nothing to add. *(Friction this phase was operational — the @code-review API 529'ing into a self-review, the Tailscale insecure-context clipboard bug, Next 16's per-dir lock forcing isolated worktrees, the DB dropping mid-task — absorbed without touching the slice; nothing architectural broke.)*

### Changes for next phase
- None.

### Scope changes
- **Added:** 6.1b canonical messaging subject model (#141, +2, DEC-058) mid-phase.
- **Split:** 6.6 (planned 5) → 6.6a substrate (#116) + 6.6b tick/cron/ring-relay (#167), +5 — re-estimated up front, not mid-build.
- **Deferred off-phase (kept open, `phase:6` removed):** 6.9 Twilio second number (#119 — 10DLC-gated, indefinite) and #173 crew DM-visibility disclosure. The messaging core shipped behind a **manual operator ring-relay**; Twilio is the parked final swap.
- **Landing:** the whole stack reached `main` via the DEC-059 `feature/messaging` integration (**PR #179**) — a 7-conflict + 1-ripple reconciliation, verified (typecheck, build, 689 unit, 37 e2e).

### PM read

**Pace.** 43 points across 10 closed issues is the largest planned phase this project has shipped, and at ~38 pts/calendar-week (~43 to the real merge) it clears Phase 5's 24.5 and matches the Phase 4 burst — except this wasn't a burst, it was a sustained multi-session feature build. The 8-day span flatters the calendar: the work compressed into the 06-28 `feature/messaging`→`main` landing, and six of the ten issues got their close stamp the next day as bookkeeping. Read the throughput as one big integrated landing, not eight days of even drip. Either way it's the high-water mark for a planned phase.

**Scope.** +4 over the 39-pt plan, +7 gross drift, and — same as every phase since 3 — none of it is estimates missed. 6.6 was a labelled 5 that was honestly ~13, re-estimated and split into 6.6a/6.6b up front (the rule firing as written); 6.1b (subject model, +2) walked in mid-phase. Every other task hit its original number exactly. The two cuts — 6.9 (Twilio, 10DLC-gated) and #173 (DM-visibility disclosure) — were deferred *off* the phase, not dropped mid-build. The point unit is still honest; the variance is splits-decided-early plus added scope, which is this project's signature, not a smell.

**Patterns.** Two themes from the session files. The architect gate paid for itself again — edge-classified three-state presence so the realtime swap stays decider-neutral (DEC-068), catching that the `NotificationPort` was already decided (DEC-050), separate read/notify tables, the 6.6 split, the own `ring_outbox` table over a union. Decision-before-code is a four-phase habit now. Sharper: the doorbell's presence branches were *dead in the pilot* until 6.7 wired the first `recordRead`/`recordActivity` call-site — built-ahead-of-its-consumer code goes silently inert, and only the architect's call-site audit caught it. The store→decider boundary tests were the right mitigation; keep pinning a substrate to its consumer whenever it lands before its reader. And review kept catching fail-toward-silence bugs the green build was happy with: NaN timestamps silencing rings, `APP_BASE_URL`→localhost dead-linking, the sweep ringing inactive crew, the office able to inject into a private DM. Green-build-ships-real-bugs, intact since Phase 1.

**On your answers.** Agreed on the feature branch, and the record backs it harder than the one-liner: #174 and #178 shipped straight to main mid-feature precisely because the trunk stayed promotable — that's the whole point of DEC-059. But "smooth" earned an asterisk it doesn't mention. The landing was a 7-conflict + 1-ripple reconciliation, and #175's relay-send/outbox-card had to be hand-merged against main's #160 Web Share versions — not a textual auto-merge. It *felt* smooth because the cost was paid upfront: DEC-068+ numbered past main's DEC-067 to dodge a collision, the reconciliation flagged a full session in advance. Keep the pattern; bank that the smoothness was bought, not free. And "nothing to add" on what-didn't is a real signal, not a blank to fill — the friction this phase was all operational (the @code-review API 529'ing twice into a self-review, the Tailscale insecure-context clipboard bug, Next 16's per-dir lock forcing isolated worktrees, the DB dropping mid-task) and you absorbed every bit of it without it touching the slice. Nothing architectural broke. Correct answer.

**Forward.** Phase 7 (Pass D, progressive commitment / soft-hold) is materialized with 5 issues. Carry one thing in clear-eyed: the Smart Doorbell is functionally live but human-in-the-loop — it rings into `/admin/outbox` and the operator texts each one by hand. 6.9 (Twilio, the wire that removes the thumbs) is gated on 10DLC carrier approval, which is weeks out and not on your schedule to move. So the messaging arc closes Phase 6 with an open tail that can't be velocity-planned — fine, but don't let "Phase 6 closed" read as "doorbell done." And #173, the one-line "your DMs are visible to the office" disclosure, is a thin fast-follow on a real trust gap — exactly the kind of item that rots in a Next-Steps list. Pull it into Phase 7's early slack before it ages.

## Phase 5 — 2026-06-19 — Pilot-readiness / go-live

**Points:** 28 / 28 planned (100%)
**Span:** 8 days (2026-06-11 → 2026-06-19)
**Throughput:** 24.5 pts/calendar-week (28 pts over 8d)  ← headline (span ≥7d, so a per-week rate is quoted)
**Estimate calibration:** 0 tasks re-estimated, net drift **0 pts** — the six `phase:5` issues hit their plan estimates exactly (5/3/5/8/2/5)  ← keeps the point unit honest
**Sessions:** 8 in window (S13–S20)   **PRs merged:** ~24 since the Phase-4 v0.6.0 close (Phase-5 features + 3 walkthrough passes + docs)
**Issues:** 6 `phase:5` created, 6 closed, 0 moved — **plus 6 added-scope issues** shipped (see Scope changes)

### Phase throughput line
| Phase | Date | Points | Span(d) | Throughput | Re-est'd | Net drift | Sessions | PRs |
|-------|------|--------|---------|------------|----------|-----------|----------|-----|
| 5 | 2026-06-19 | 28 | 8 | 24.5 pts/wk | 0 | 0 | 8 | ~24 |

### Cross-phase signal
Phase 4 was a 1.8d burst; Phase 5 spread its 28 planned pts over 8 calendar days (24.5 pts/wk) — but that headline understates delivery: ~15 pts of **unplanned** scope also shipped in the window (manual, all-shifts view, walkthrough fast-follows), so real throughput in the window was closer to ~43 pts. Calibration on the *planned* set was perfect (0 drift) — a clean reversal of Phase 4's +4 under-pointing. The signal to watch stays the same: the planned set held its point value; the variance this phase was scope *added*, not estimates *missed*.

### What worked / What didn't / Changes for next phase
Retro reflection skipped at user request (S20). PM commentary skipped.

### Scope changes
- **All 6 planned `phase:5` tasks shipped** (5.1 deploy, 5.2 auth, 5.3 vessel-local time, 5.4 import, 5.5 e2e, 5.R runbook); nothing moved or descoped. 5.5 (e2e) was flagged "first to cut" but shipped — not cut.
- **Added scope (shipped this phase, not in the `phase:5` plan, ~15 pts):** #68 operator manual; #93+#97 stale-safe outbox copy + session-aware root redirect; #94 `removeAsk`/`removeOutboxEntry` + idempotent outbox seed; #100 all-shifts full-visibility view + complete /admin nav (DEC-042, @architect-gated); #101 crew-seed `now`-anchoring (fixes the e2e harness rot). Mostly walkthrough fast-follows + operator-visibility.
- **#70 closed** (prod-readiness gate) — its deliverable (the loud pilot-only runbook warning) was met. The two genuine prod tells remain deferred by design: Twilio auto-send (DEC-MSG-1) + the single-operator constant.
- **New decisions:** DEC-032 (vessel-local time), DEC-033 (Vercel+Neon deploy), DEC-034 (operator auth), DEC-035/036/037/040 (import: xlsx + live Xola pull), DEC-041 (trip length→shift end), DEC-042 (all-shifts deliberate anti-dashboard exception).
- **Pilot status:** hosted pilot live (`muster-sigma.vercel.app`) — a pilot, **not** production. Next milestone is the real-crew weekend, which triggers Phase 7 (Pass D).

## Phase 4 — 2026-06-12 — Pass C: Fast-follows

**Points:** 28 / 28 planned (100%)
**Span:** ~1.8 days (2026-06-10 → 2026-06-12) — burst phase
**Throughput:** burst — 28 pts in ~1.8d (sub-week; no per-week rate quoted)  ← first phase on the DEC-S026 throughput model
**Estimate calibration:** 2 tasks re-estimated, net drift **+4 pts under** (4.1 pilot channel 5→8; Unit C #56+#57 +1 admin-reporter add); the other 6 tasks hit estimate exactly  ← keeps the point unit honest
**Sessions:** 3 (S12, S13, S14)   **PRs merged:** 9 (6 feature, 3 docs/infra)
**Issues:** 8 created, 8 closed, 0 moved to Phase 5

### Phase throughput line
| Phase | Date | Points | Span(d) | Throughput | Re-est'd | Net drift | Sessions | PRs |
|-------|------|--------|---------|------------|----------|-----------|----------|-----|
| 4 | 2026-06-12 | 28 | ~1.8 | burst | 2 | +4 | 3 | 9 |

### Cross-phase signal
`throughput.py` flags pts/issue drifting **5.38 → 3.50** across phases 1→4 — possible point drift, consistent with this phase's +4 under-pointing (work ran a bit bigger than the points said). Not alarming at 14% of a 28-pt phase, but the calibration tally is now the thing to watch: persistent positive drift = under-pointing; shrink-with-rising-throughput would be inflation.

### What worked / What didn't / Changes for next phase
Retro reflection skipped at user request (S14). PM commentary skipped.

### Scope changes
- All 8 planned tasks shipped; nothing moved or descoped.
- **Deferred-as-planned** (not started, by design): split/merge, bulk weekend-lock, live-card pings, hosted deploy.
- **Surfaced mid-phase, parked to issues** (not Phase 4 scope): #65 (e2e/Playwright harness), #68 (operator manual), #70 (pilot prod-readiness gate — now incl. the timezone/UTC blocker), #73 (operator Xola import surface). Plus the slice-1 manual E2E walkthrough doc (#72).
- **Slice-1 status:** build-complete. The real-crew test is gated on hosted deploy + #70 (prod auth + timezone) + #73 (real import) — tracked, not in this phase.

## Phase 3 — 2026-06-10 — Pass B: Tier 2 + At-Risk board

**Sessions:** 3 (S9, S10, S11)
**Points:** 28 delivered / 28 planned (100%) — first exactly-on-plan phase; the 25→28 re-total was the up-front 3.2 split (8 hiding in a 5), not creep
**Wall clock:** 37.84h  (raw elapsed — includes overnights + idle)
**Breaks:** 34.33h
**Active time (wall − breaks):** 3.42h ← honest headline
**Velocity:** 0.122 h/pt active  ← the only forecast number (third straight improvement: 0.145 → 0.130 → 0.122)
**Issues:** 7 created, 7 closed (#39, #40, #41, #42, #43, #44, #47), 0 moved

### Per-session breakdown
| Session | Date | Wall | Breaks | Active | Points | PRs |
|---------|------|------|--------|--------|--------|-----|
| S9 | 2026-06-08→09 | 14.17 | 13.75 | 0.42 | 5 | 45 |
| S10 | 2026-06-09→10 | 10.00 | 9.08 | 0.92 | 10 | 46, 48, 49 |
| S11 | 2026-06-10 | 13.67 | 11.50 | 2.08 | 13 | 51, 52 |

> **Inference notes.** S10's recorded transcript had no parseable events; its breaks were inferred by
> merging all project transcripts inside the session window (639 events) — slightly more inference
> than usual in this phase's headline. S9's tiny active is genuine (the cross-transcript check found
> the same 243 events): the 3.1a build shipped in short bursts inside a long mostly-idle window, the
> established pattern since Phase 2's S8.

### What worked
- Not captured (retro notes skipped).

### What didn't
- Not captured (retro notes skipped).

### Changes for next phase
- Not captured (retro notes skipped).

### Scope changes
- 3.1 split 8 → 3.1a (5) + 3.1b (2) and 3.2 split 8 → 3.2a (3) + 3.2b (5), both via @architect passes at session start — phase re-totaled 25→28.
- 3.4+3.5 (#42/#43) deliberately shipped as **one 8-pt PR** under the new task-splitting guidance ("don't split a coherent 8") — first use of the rule; @architect pre-pass + @ui-reviewer + @code-review all ran, three seam findings fixed in-PR.
- Decision surface scoped to **lean only** at phase start (reschedule/cancel cascade parked with payments — Drew's domain); they render disabled per DEC-026.
- Five DECs recorded (022–026), all decision-before-code via @architect.
- Mid-phase process change from user feedback: the eyeball-instructions standard (executable-today steps, literal expected sights) + `db:seed:atrisk` / `db:tick` dev tooling — whose dry run against real Postgres caught a shipped `board_landed` pkey collision the in-memory adapter had swallowed.

### PM read
0.122 h/pt active, third straight improvement (0.145 → 0.130 → 0.122), and the first phase in this project's history to land exactly on plan: 28/28, zero moved, zero drift. The 25→28 re-total isn't scope creep — it's the 3.2 split being honest about an 8 hiding inside a 5, decided up front with @architect, same move as #11 in Phase 1. The phase also ran under two calendar days wall-to-wall, which means the velocity number is now stable across three very different phase shapes (a 3-session slice, a 2-session ranking pass, a 2-day sprint). One asterisk for the record: S10's transcript was empty and its breaks were inferred from sibling transcripts, so this phase's headline carries slightly more inference than the last two. The trend is real; treat the third decimal place with suspicion.

The pattern this phase pays for itself is **decision-before-code**: five DECs (022–026) all written from @architect passes *before* the implementing PR, and every one of them changed the build — derived-not-stored horizon, the escalation log as a projection instead of a new aggregate, the recomputed-on-read asymmetry between "no one may" and "no one wants to," pool-thinness instead of a role-name check. The other recurring theme is now a confirmed two-time offender: **the in-memory adapter swallows what Postgres enforces.** Phase 1 it was equivalence gaps the CI pg gate closed; this phase the `board_landed` pkey collision shipped green through 300+ tests and only surfaced when someone dry-ran the seed against real Postgres. The pg contract suite catches what it's pointed at; the lesson is that any new table-shaped write wants a real-pg dry-run before the PR closes, not after.

On the first "don't split a coherent 8" run: the rule worked, and it's worth being precise about *why*. #42+#43 as one PR didn't just save a review round-trip — the three findings (board/lean accept-set divergence, the contrast failures, the pkey collision) were all *seam* bugs between the surface and its action, exactly the seams a two-PR split would have hidden until integration. The compensating controls the CLAUDE.md rule demands (full spec up front, @architect pre-pass, the review stack) were all present, so this is a clean data point, not a license. The "your eyeball instructions pretty much usually suck" exchange is the better story, though: the correct response to bad verification prose turned out to be *building the missing tooling* (`db:seed:atrisk`, `db:tick`) rather than writing better paragraphs — and that tooling immediately caught the shipped bug. Executable instructions found what descriptive ones never would have. That standard is now in CLAUDE.md; hold it.

Two phases running of skipped what-worked/what-didn't. I'll note that the Phase 0 and 1 verbatims were load-bearing — "not enough discipline" and "repo is the record" both turned into real process changes — and the session files only capture what Claude saw, not what annoyed you. The one piece of user signal this phase *did* produce (the eyeball-instructions complaint) became a CLAUDE.md standard and two npm scripts within the hour, which rather proves the point about what the skipped questions are worth.

Forward: Phase 4 (Pass C) has **no task table** — that's the actual blocker, and decomposition should happen at `/start-phase` with the review follow-ups as first-class candidates, not a someday list: the fills-by deadline on `AtRiskRow` (the domain has no fill-deadline concept; the mockup assumes one), Shell/Notice extraction (third copy-paste), the Bailed-seat pool gap on the click-through (the regression detail page currently shows *less* than the board row), and the **DEC-MSG-3 pilot adapter pick** — which is now the delivery seam for two consumers (crew asks *and* the admin board ping), so it stops being deferrable the moment Pass C touches anything outbound. At 0.122 h/pt, a Phase-4 plan in the 25–30 point range is roughly 3–4 active hours; the estimate risk isn't velocity, it's that Pass C is the first phase where the unbuilt thing is a *product decision* (delivery channel) rather than an engine mechanism.

## Phase 2 — 2026-06-08 — Pass A: Reliability ranking

**Sessions:** 2 (S7, S8)
**Points:** 16 delivered / 14 planned (114%) — overage = 2.4 (#20) re-estimated 3→5 (new `removeSeat` port + 2 adapters)
**Wall clock:** 31.59h  (raw elapsed — includes overnight + idle)
**Breaks:** 29.52h
**Active time (wall - breaks):** 2.08h ← honest headline
**Velocity:** 0.130 h/pt active  ← the only forecast number (vs Phase 1's 0.145)
**Issues:** 4 closed (#20, #30, #31, #32), 0 moved

### Per-session breakdown
| Session | Date | Wall | Breaks | Active | Points | PRs |
|---------|------|------|--------|--------|--------|-----|
| S7 | 2026-06-07→08 | 15.12 | 13.22 | 1.92 | 11 | 33, 34, 35 |
| S8 | 2026-06-08 | 16.47 | 16.30 | 0.17 | 5 | 38 |

> **S8 active is genuinely tiny, not a measurement error.** The #20 build shipped in two tight bursts
> (16:22–16:26 plan, 17:43–17:48 build+PR+review) with the rest of the 16.5h wall being away-from-desk
> idle — session opened 03:34Z, real work started 16:22Z. Break inference (>15min gaps) correctly
> excludes it. Phase velocity is dominated by S7's sustained 1.92h.

### What worked
- Not captured (retro notes skipped).

### What didn't
- Not captured (retro notes skipped).

### Changes for next phase
- Not captured (retro notes skipped).

### Scope changes
- 2.4 (#20, builder reconciliation) re-estimated 3→5 at session start — the `removeSeat` port method across two adapters + contract test pushed it past the carried-over 3. Shipped at ~5.
- Phase 2 closed Pass A complete: scorer (#30), pool ranking + boost/floor (#31), crew own-standing (#32), builder reconciliation (#20). The staffing-horizon clock remains explicitly out (flagged at the boundary, Phase 3+).

## Phase 1 — 2026-06-07 — Vertical slice (M0–M5)

**Sessions:** 3 (S4, S5, S6)
**Points:** 55 delivered / 43 planned (128%) — overage = #11 re-estimated 5→13 (split 3 PRs) + unplanned CI gate, a `/pull-seeds`, DEC docs
**Wall clock:** 60.31h  (raw elapsed — includes two overnights + idle)
**Breaks:** 52.31h
**Active time (wall − breaks):** 8.00h ← honest headline
**Velocity:** 0.145 h/pt active  ← the only forecast number (~8.7 min/pt; the AI-assisted signature — human keyboard time is small relative to output)
**Issues:** 8 closed (#6–13), 1 moved to Phase 2 (#20 builder reconciliation)

### Per-session breakdown
| Session | Date | Wall | Breaks | Active | Points | PRs |
|---------|------|------|--------|--------|--------|-----|
| S4 | 2026-06-04 | 5.66 | 3.00 | 2.67 | 18 | 14, 15, 16, 17, 18 |
| S5 | 2026-06-04→06 | 30.90 | 28.49 | 2.42 | 21 | 19, 21, 22, 23, 24 |
| S6 | 2026-06-06→07 | 23.74 | 20.82 | 2.92 | 16 | 25, 27, 28, 29 |

### What worked
- "it feels like a real dev team with suggestion and push back. always moving forward with the slice, not getting distracted" (verbatim)

### What didn't
- No specific friction flagged by the user. Observed: **#12 ran ~8 vs the est. 5** — the first UI surface dragged the whole Tailwind + session-layer foundation in with it (a one-time stack tax; #13 then landed clean at ~5). The **`nextUrl.origin`→localhost** bug behind Tailscale needed the user's catch (CI/tests were green). **Orphaned dev-server processes** accumulated on port 3000 across smoke tests.
- **Auto-memory isn't trustworthy** — the user surfaced this directly: memory files live outside the repo (invisible, unversioned) and recall is best-effort. Real change, not a complaint (see below).

### Changes for next phase
- "the repo is the record and i'm going to try to keep the momentum going and just keep knocking out tasks" (verbatim)
- Acted on immediately: durable conventions moved into `CLAUDE.md` (standalone docs-PR rule, automated-vs-human test plans, pushback+slice-focus, "repo is the system of record"); `docs/RUNNING.md` already carries the local-run recipe + Tailscale access. Auto-memory demoted to a convenience hint.

### Scope changes
- **#11** re-estimated 5→13 up front, split into 3 PRs (#22/#24/#25) — the "if it's a 13, break it down" rule firing as written.
- **#12** delivered ~8 vs 5 (Tailwind v4 + session-layer foundation — one-time, DEC-021).
- **#20** (manning-shrink prune + all-cancelled→Cancelled) moved to Phase 2 — wants the staffing-horizon clock.
- Unplanned but shipped: CI gate (#27), `/pull-seeds` v4 (#23), DEC docs. New ideas parked in `FUTURE_IDEAS` (booking-modification, richer call-time model, post-shift card state) — not absorbed.
- New DECs this phase: **DEC-019** (bail is a transition), **DEC-020** (M4 stack), **DEC-021** (Tailwind v4, component library deferred); plus DEC-DATA-1 bound at M4.

### PM read
Three sessions, eight active hours, and the entire spine now runs live: a Xola export goes in one end and a crew member standing on a dock with the right manifest and a 45-minute call time comes out the other. That's the whole "scary assumption" from the plan — autonomous grouping-and-asking against real bookings — exercised rather than described. 0.145 h/pt active is the first honest velocity this project owns; Phase 0's 0.176 was a break-heuristic ghost and everyone knew it. So the number to carry forward is this one, and it held remarkably steady across all three sessions (2.67 / 2.42 / 2.92h) — not a fluke phase, a pace.

On scope: 55 delivered against 43 planned is a 28% overage, and almost none of it is drift. #11 was re-estimated 5→13 *up front* and split into three clean PRs — that's the workflow's "if it's now a 13, break it down" rule firing exactly as written, not a miss. The genuine miss is #12, which came in ~8 against an estimated 5 because the first UI surface dragged the entire Tailwind v4 foundation, the session layer, and a dev seed in with it. That's a one-time stack tax — the foundation is poured now, and #13 confirmed it by landing the shift card at a clean ~5 with no new stack work. The rest of the overage (CI, the /pull-seeds, DEC docs) is real work that wasn't on a label, but unlike Phase 0's mostly-docs PRs, this was infrastructure that closed actual gaps. New ideas — booking-modification, the richer per-vessel/per-event call-time model, post-shift card state — went to FUTURE_IDEAS, not into the slice. The scope discipline you flagged as a Phase 0 goal held.

The pattern worth naming is that the no-FK / dates-as-text bet got *paid down* this phase instead of deferred into a someday-debt. You took that bet against your own FK instinct on the condition of "excellent discipline at the service layer," and PR #25 made the discipline executable: ISO validators at every write boundary, a `checkIntegrity` orphan diagnostic running over both adapters and wired into the healthcheck, and a CI gate that stands up real Postgres so the in-memory↔Postgres equivalence is a required check rather than a hand-run hope. That's the FK's loud failure relocated to your schedule, which is the only version of that bet that doesn't rot. The other recurring theme: review caught real bugs that the build was perfectly happy with — cross-seat double-booking on a 2-crew shift, the `SESSION_SECRET` prod fail-fast, the host-header injection, the `/api/health` route quietly serializing crew ids to anyone who asked. Green builds shipped genuine security holes; the review layer is the thing that's earning its keep.

On "it feels like a real dev team with suggestion and pushback, always moving forward with the slice, not getting distracted" — the record backs the second clause harder than you might give it credit for. Three sessions, eight tasks, every one closing an issue or splitting one deliberately, and the parking lot did its job. The "real dev team" feeling is doing some load-bearing work, though: the pushback that mattered most — Supabase demoted from platform to candidate host, the persistence two-substrate call, the no-FK debt being named as a hard PR-3 deliverable instead of a nice-to-have — those were *your* decisions taken at the architecture seam, with the agents arguing the tradeoffs. That's not a team moving forward on autopilot; that's a sole operator making every load-bearing call and an apparatus keeping the calls honest. Worth being clear-eyed about which is which, because Phase 2 leans on your judgment, not the apparatus's.

Forward note: Phase 2 introduces the clock, and the clock is where this slice's cleanest simplification comes due. The ask loop is deliberately horizon-agnostic — `bail()` rests at `Bailed`, double-booking is day-grained, the assignment view omits the "fills by" countdown — and the staffing-horizon task (Pending→Filling birth, the early-vs-late-bail Filling-vs-AtRisk split, the magic-token reaper that's been waiting for a scheduler) all unblock the moment time exists. The reliability scorer has exactly one insertion point waiting for it (`rankPool`), which is the tidiest possible handoff. The one thing I'd watch: #12's deferred N+1 in `buildCrewAppView` is fine at four boats and will not stay fine, and Phase 2's reads are about to get heavier. Re-estimate #11 as the 13-split it became and #12 as ~8, fold #20 in where the horizon clock lands, and the plan stays honest.

## Phase 0 — 2026-06-04

**Sessions:** 3
**Points:** 9 tracked (PRs #3/#4/#5) / 15 planned (0.1 + 0.2 = 8 pts completed as pre-ritual setup, untracked)
**Wall clock:** 6.29h
**Dev time:** 0.80h
**Review time:** 0.75h
**Velocities:**
- Wall: 0.70 h/pt
- Dev: 0.09 h/pt  ← headline forecast — but a **method artifact** this phase (see below); not a usable baseline
- Review: 0.08 h/pt
**Issues:** 2 created (#1, #2), 2 closed, 0 moved to Phase 1

> ⚠ **Dev/pt is not trustworthy for Phase 0.** The break heuristic (>15min gap = idle) counted a ~4h
> overnight wait while PR #3 sat unmerged *and* two early planning/reading gaps (31m, 20m) as breaks,
> stripping nearly all of S1's active dev time. Real active time ≈ `wall − breaks` = **1.54h**.
> Forecast against active time, skeptically, until a clean build phase mints an honest number.

### Per-session breakdown
| Session | Date | Wall | Dev | Review | Breaks | Points | PRs |
|---------|------|------|-----|--------|--------|--------|-----|
| S1 | 2026-06-03 | 5.00h | 0.25h | 0.00h | 4.75h | 2 | #3 |
| S2 | 2026-06-04 | 0.58h | 0.17h | 0.42h | 0.00h | 2 | #4 *(transcript-unavailable — Windows path; breaks=0 by inference)* |
| S3 | 2026-06-04 | 0.71h | 0.38h | 0.33h | 0.00h | 5 | #5 |

### What worked
- "i was able to get new design decision in place smoothly" (DEC-ROLE-1 went from mid-session handoff to merged-in-PR without friction).

### What didn't
- "i'm not sure i had enough displine with the workflow, and i need read the pr closer."

### Changes for next phase
- "continue to look for design gaps. follow workflow"

### Scope changes
- **PR #4 (Messaging REV 2 + design-reference staging, 2 pts)** — unplanned mid-phase docs work, no issue. Added to PROJECT_PLAN as a P0-retro drift row.
- **DEC-ROLE-1 (roles/manning as tenant data)** — mid-session handoff folded into PR #5 *after* its Task 1 block was logged. Caught the 0.4 skeleton shipping the `'captain'|'mate'` enum anti-pattern (forbidden by DEC-001) before merge. Recorded only in the Session 3 Context note — not in any per-task block.
- Carried forward (review forward-notes, not blockers): graduate the N-role manning iteration from `brewboat.test.ts` into a real `deriveSeats()` with a 3-role fixture (M2/1.3); M4 multi-tenant adapter should enforce RoleType referential integrity.

### PM read
**Phase 0 — Setup & domain foundation**

Three sessions, six and a quarter hours wall, and nine tracked points to stand up a test harness, two doc revisions, and the domain spine. On paper that's a 0.09 h/pt dev velocity, which would be the most productive engineering anyone has ever done and is also entirely fictional. The break heuristic ate a four-hour overnight wait while PR #3 sat unmerged and called it "idle," then ate two early reading-and-planning gaps for good measure. Strip the artifact and real active time across the phase is roughly 1.54h — fast, genuinely, but this phase gives us no velocity baseline worth forecasting against. Phase 1 is where the first honest number gets minted. Anyone who quotes 0.09 h/pt in a planning meeting should be asked to leave.

On scope: nine tracked points against seven on the phase:0 labels. The extra two are PR #4 — the messaging REV 2 doc work — which walked in mid-phase with no issue behind it. It was good work (port-mediated ask, DEC-MSG-3, the SPEC locked-text edits all DEC-backed), and it's exactly the kind of work that doesn't show up in a plan because it wasn't in the plan. The points-drift is small here; the habit is the thing to watch. Two of three points-bearing PRs in a setup phase being mostly documentation is fine for a setup phase and would be a smell in a build phase.

The pattern worth naming is DEC-ROLE-1. The 0.4 domain skeleton shipped with the literal `'captain' | 'mate'` enum that the project's own policy/mechanism split (DEC-001) exists to forbid — and it got caught in a mid-session handoff and rewritten as tenant data *before* merge. Good catch, real save. But it's recorded nowhere in any per-task block; it survives only as a note in the Session 3 context. The same session also folded a second descope-and-correct into a branch that had already logged its Task 1. The work is sound. The bookkeeping is exactly the discipline gap you flagged yourself.

Which is the honest part. You said you weren't sure you had enough discipline with the workflow and needed to read the PR closer — and the record agrees with you, specifically and in two places: the unrecorded DEC-ROLE-1 folded in after-the-log, and an enum anti-pattern that made it to a PR at all. That's not a confidence problem, it's a process one, and process problems have process fixes: one task, one block, log it before you fold the next thing in. On "got the new design decision in place smoothly" — sure, the *deciding* was smooth; the catch happened at review, not at design, which is the system working but working late. "Continue to look for design gaps" is the right instinct precisely because this phase proved the gaps are real and reach the branch.

Forward into Phase 1: this is the 43-point vertical slice, and it is a different animal. M0–M5 takes the spine you just merged and runs real BrewBoat weekends through it — import, auto-form, lock, ask, tap-in, shift card — which means the "scary assumption," autonomous grouping-and-asking on live bookings, finally gets exercised instead of described. Task 1.5a (M4) is where DEC-013 comes due and the deferred stack stops being deferred; budget for that decision to cost real hours, not the rounding-error this phase logged. Two notes to carry: the N-role manning iteration in `brewboat.test.ts` wants to graduate into a real `deriveSeats()` with a 3-role fixture, and the per-task logging discipline is now a stated Phase 1 goal — so treat the first dropped block as a bug, not a footnote.
