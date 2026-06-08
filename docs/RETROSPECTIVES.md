# Muster — Retrospectives

Phase-end retrospectives. Written by `/retro` at each phase boundary — velocity, scope changes,
process notes, forecast update. One entry per phase, newest at the top.

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
