# Changelog

## [0.10.0] - 2026-07-03 — Phase 8: Shift Builder
- 19 pts shipped across 2 sessions (burst — ~2d); see docs/RETROSPECTIVES.md
- Split-suggestion detector + manual split/merge engine & UI (8.1/8.3/8.4), DEC-084 crew assignment-change notice subsystem, seat/manning override (8.5)
- Locking CUT (DEC-082 — Xola owns booking truth); out-of-band SMS consent for Twilio 10DLC (#229, migration 0017)

## [0.9.10] - 2026-07-03
- PR #229: SMS consent block on public crew login (Twilio 10DLC opt-in) + sms_consent audit

## [0.9.9] - 2026-07-03
- PR #227: DEC-084 fast-follow — assignment notices on all add/drop sites

## [0.9.8] - 2026-07-03
- PR #223: Phase 8.5 — Seat/manning override (closes #208)

## [0.9.7] - 2026-07-03
- PR #221: Phase 8.4 — Manual Merge + crew assignment-change notices (closes #207)

## [0.9.6] - 2026-07-03
- PR #219: Phase 8.3b — Shift Builder Edit-mode Split UI (closes #206)

## [0.9.5] - 2026-07-03
- PR #218: Phase 8.3a — manual split engine (cut-time partition, DEC-083)

## [0.9.4] - 2026-07-03
- PR #217: Crew My Shifts cards: show shift times + co-crew (#216)

## [0.9.3] - 2026-07-03
- PR #214: Cut locking from Phase 8 (Xola is source of truth, DEC-082) + frontend-design binding

## [0.9.2] - 2026-07-03
- PR #213: Phase 8.2a — Builder View mode: next-7-days default + split cue

## [0.9.1] - 2026-07-03
- PR #212: Phase 8.1 — shift split-suggestion detector (gap/span)

## [0.9.0] - 2026-06-30 — Phase 7: Crew Self-Serve
- 20 pts shipped across 2 sessions (burst — ~1.1d); see docs/RETROSPECTIVES.md
- Crew self-serve: front door (7.0a/b), two-door eligibility (7.1), claim service (7.2), /crew/open surface (7.3), cascade coexistence (7.4) — shipped DARK behind CREW_SELF_SERVE
- Follow-ups: ring-relay no-phone Web Share (#186), seat provenance (#196, migration 0013)

## [0.8.8] - 2026-06-30
- PR #199: 7.4 cascade coexistence — verify pull/push coexist

## [0.8.7] - 2026-06-30
- PR #200: 7/#186 ring relay — no-phone crew relayable via Web Share

## [0.8.6] - 2026-06-30
- PR #201: 7/#196 seat provenance — fix self-claim Added-for-you badge (migration 0013)

## [0.8.5] - 2026-06-30
- PR #198: docs: AUTH.md — auth/identity model + sign-in doors

## [0.8.4] - 2026-06-30
- PR #197: 7.3 /crew/open self-serve pull surface — browse + claim

## [0.8.3] - 2026-06-30
- PR #194: 7.2 claim service — claimSeat (Open→Confirmed) + releaseSelfClaim

## [0.8.2] - 2026-06-30
- PR #193: Fix VersionTag blank in prod (read version from package.json)

## [0.8.1] - 2026-06-30 — Crew Self-Serve front door (interim prod release)
- Crew self-serve sign-in: 6-digit email-code login + sign-out, shipped **dark** behind `CREW_SELF_SERVE` until `crew.brewcle.com` DKIM is live (7.0a/7.0b — #190/#191)
- Two-door eligibility: `nativeRole` + `claimableSeatsFor` (self-claim is native-role-only; operator-assign keeps full ratings) — domain only, no surface yet (7.1 — #192)
- Xola pull window decoupled from the staffing horizon (`XOLA_PULL_LEAD_DAYS`, defaults to no behavior change — #188)
- Manual interim release outside the `/retro` flow; Phase 7 retro reconciles per-PR versioning at phase close

## [0.8.0] - 2026-06-29 — Phase 6
- 43 pts shipped across 10 sessions (throughput ~38 pts/calendar-week; work landed 06-28 via the feature→main merge) — Messaging & the Smart Doorbell: message store + derived membership, the pure doorbell decider + human-drivable harness, doorbell tick/cron, crew messaging UI, operator messaging surface, and the operator-outbox ring relay
- Shipped behind a **manual operator ring-relay**; 6.9 (Twilio second number) deferred — 10DLC-gated. #173 (crew DM-visibility disclosure) deferred
- Landed on main via the DEC-059 feature/messaging integration (PR #179); clean minor at phase close (per-PR patches collapsed — 30 PRs in window, operator call at retro)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.7.0] - 2026-06-20 — Phase 5
- 28 pts shipped across 8 sessions (throughput 24.5 pts/calendar-week) — pilot-readiness/go-live: hosted deploy (Vercel+Neon), prod operator auth, vessel-local time, Xola import (xlsx + live pull), e2e Playwright harness, pilot weekend runbook
- Plus ~15 pts added scope: operator manual (#68), all-shifts full-visibility view (#100, DEC-042), walkthrough fast-follows (#93/#94/#97/#101); #70 prod-readiness gate closed
- Clean minor at phase close (per-PR patches collapsed — ~25 PRs in window; operator call at retro)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.6.0] - 2026-06-12 — Phase 4
- 28 pts shipped across 3 sessions (burst — ~1.8d span; DEC-S026 throughput model)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.5.6] - 2026-06-12
- PR #71: 4.7 fills-by deadline (DEC-031): name the escalation threshold, render it (closes #59)

## [0.5.5] - 2026-06-12
- PR #69: Pilot channel: web-link relay + operator outbox (4.1, closes #53)

## [0.5.4] - 2026-06-12
- PR #67: Builder 'changed since reviewed' nudge (4.6, closes #58)

## [0.5.3] - 2026-06-12
- PR #64: Crew bail flow + credential nudge (4.4+4.5, closes #56, closes #57)

## [0.5.2] - 2026-06-12
- PR #62: Assignment cockpit + warming view (4.2+4.3, closes #54, closes #55)

## [0.5.1] - 2026-06-12
- PR #61: Extract shared Shell/Notice into components/ui (4.8, closes #60)

## [0.5.0] - 2026-06-10 — Phase 3
- 28 pts shipped across 3 sessions (0.122 h/pt active)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.4.7] - 2026-06-10
- PR #52: Phase 3.4+3.5 — At-Risk board surface + lean

## [0.4.6] - 2026-06-10
- PR #51: Phase 3.3 — At-Risk derivation: board membership + urgency sort

## [0.4.5] - 2026-06-10
- PR #50: Pull seeds v4 templates — Fable 5 model guidance, task-splitting, narration, conventions

## [0.4.4] - 2026-06-10
- PR #49: Phase 3.2b — Tier-2 escalation mechanism: stall detection + escalate()

## [0.4.3] - 2026-06-10
- PR #48: DEC-024 + Phase 3.2a — escalation substrate + trail projection

## [0.4.2] - 2026-06-09
- PR #46: Phase 3.1b — magic-token reaper: reapExpiredMagicLinks + removeMagicToken port

## [0.4.1] - 2026-06-09
- PR #45: Phase 3.1a — staffing-horizon clock: resolveShiftState overlay + tick(repo,now)

## [0.4.0] - 2026-06-08 — Phase 2
- 16 pts shipped across 2 sessions (0.130 h/pt active)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.3.5] - 2026-06-08
- PR #38: Phase 2.4 — builder reconciliation: manning-shrink seat prune + all-cancelled→Cancelled (closes #20)

## [0.3.4] - 2026-06-08
- PR #36: DEC-S namespace sweep — apply DEC-S025

## [0.3.3] - 2026-06-08
- PR #35: Phase 2.3 — crew own-standing: real score + plain reasons (closes #32)

## [0.3.2] - 2026-06-08
- PR #34: Phase 2.2 — rank eligible pool by reliability + manual boost/floor (closes #31)

## [0.3.1] - 2026-06-08
- PR #33: Phase 2.1 — reliability scorer: blended score from logged events (closes #30)

## [0.3.0] - 2026-06-07 — Phase 1
- 55 pts shipped across 3 sessions (0.145 h/pt active)
- Vertical slice M0–M5 complete; see `docs/RETROSPECTIVES.md`

## [0.2.15] - 2026-06-07
- PR #29: Phase 1.6 / M5 (#13) — shift card: call vs departure, dock pin, per-event manifest

## [0.2.14] - 2026-06-07
- PR #28: Phase 1.5b / M4 (#12) — crew tap-in: the ask, my-shifts, magic-link landing + Tailwind foundation

## [0.2.13] - 2026-06-06
- PR #27: ci: GitHub Actions verify gate with a real Postgres

## [0.2.12] - 2026-06-06
- PR #26: docs: park booking-modification idea in FUTURE_IDEAS

## [0.2.11] - 2026-06-06
- PR #25: Phase 1.5a / M4 (PR 3/3) — self-rolled magic-link + channel port + no-FK integrity discipline

## [0.2.10] - 2026-06-06
- PR #24: Phase 1.5a / M4 (PR 2/3) — Postgres adapter + DDL + REQ-CLAIM-1 state-guarded write

## [0.2.9] - 2026-06-06
- PR #23: Pull seeds (v4): @ui-reviewer agent + DEC-020-coherent CLAUDE.md additions

## [0.2.8] - 2026-06-05
- PR #22: Phase 1.5a / M4 (PR 1/3) — Next.js framework + topology standup

## [0.2.7] - 2026-06-05
- PR #21: Phase 1.4b / M3 — Tier-1 ask/confirm loop + thin assignment view

## [0.2.6] - 2026-06-05
- PR #19: Phase 1.4a / M3 — oracle eligible-pool (composite satisfiability) + reliability logging

## [0.2.5] - 2026-06-04
- PR #18: Phase 1.3 / M2 — auto-form shifts, derive seats, state machine + lock

## [0.2.4] - 2026-06-04
- PR #17: Phase 1.2 / M1 — Xola xlsx import → Events + Reservations + browse

## [0.2.3] - 2026-06-04
- PR #16: DEC-015/016/017/018 — Xola import decisions + DEC-016 spec corrections

## [0.2.2] - 2026-06-04
- PR #15: Add DEC-DATA-1 — service layer stays; Supabase is managed Postgres, RLS authz-only

## [0.2.1] - 2026-06-04
- PR #14: Phase 1.1 / M0 — Vessel + CrewMember + MMC credential admin, roster, BrewBoat seed

## [0.2.0] - 2026-06-04 — Phase 0
- 9 pts shipped across 3 sessions (active dev ~1.54h; dev/pt is a method artifact — see retro)
- See `docs/RETROSPECTIVES.md` for the full retro

## [0.1.3] - 2026-06-04
- PR #5: Phase 0.4 — Domain skeleton: entities + repository port + reliability log

## [0.1.2] - 2026-06-04
- PR #4: docs: messaging REV 2 (channel port) + stage UI design reference

## [0.1.1] - 2026-06-04
- PR #3: Phase 0.3 — TS/Node runtime + Vitest test harness

