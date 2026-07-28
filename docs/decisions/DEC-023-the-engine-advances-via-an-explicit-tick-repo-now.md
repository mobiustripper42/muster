---
id: DEC-023
title: "The engine advances via an explicit `tick(repo, now)` operation; no scheduler in v1"
topic: "Core architecture & engine mechanics"
---

## DEC-023: The engine advances via an explicit `tick(repo, now)` operation; no scheduler in v1

**Decision:** Horizon advances run through an explicit **`tick(repo, now)`** sweep in the core (pure
over injected `now`, never reads a clock — mirrors `scoreCrewMember`/`lock`). `tick` walks shifts,
advances any that crossed their horizon via `resolveShiftState`, persists the change, and **eagerly
fires Tier-1 asks** for newly-`Filling` shifts by reusing `solveShift`/`broadcastAsk` (not a rebuild).
**Who calls `tick` on a timer is deferred to deploy** — a Vercel cron route is one line of config when
there's a deployed app, and there isn't yet (DEC-020 parked hosting). For now its callers are tests
and, optionally, a dev/admin "run the engine" trigger — exactly how `formShifts` already lives (a real
core operation with no production scheduler behind it).
**Why:** The advance **must be eager, not lazy-on-read**: `Pending`→`Filling` *kicks off Tier-1 asks*
(SPEC §1.1, DEC-006), and you cannot lazily "send the ask" only when someone happens to load a page.
A lazy derivation can compute a *display* state but can't drive the ask loop. So the state change that
has side effects has to be an explicit operation. Building the scheduler now would be infra the stack
doesn't have — premature.
**Tradeoff:** Until a scheduler exists, horizons only advance when something calls `tick` (tests, a
manual trigger) — accepted; there's no deployed app to run a cron against yet, and the calling seam is
one config line when there is. **Corollary — the persisted shift badge can lag the true horizon state
between ticks.** The ask loop's `refreshShiftState` persists the *pure* seat-fold (it has no `now`), so
a seat-driven write between ticks can transiently drop the time-overlay (e.g. a late `yes` flips an
`AtRisk` shift back to `Filling`). `tick` is the **sole reconciler** and re-asserts on its next sweep.
Treat the persisted state as eventually-consistent, not authoritative-the-instant-you-read-it; display
surfaces should resolve on read (via `resolveShiftState`) or tolerate the staleness. No asks
double-fire from this — `broadcastAsk` only fires on the `Pending`→`Filling` birth inside `tick`.
**Revisit / trigger:** Wire the cron caller at first hosted deploy (alongside DEC-020's deferred host
pick). If lazy *display*-state is ever needed before then, `resolveShiftState` already gives it for
free on read — `tick` remains the only thing that fires asks.
**Phase:** Phase 3 / task 3.1a (#39). (@architect pass, 2026-06-09.)
