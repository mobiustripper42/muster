---
id: DEC-022
title: "Staffing horizon is *derived* config, not a stored field; shift time-state is a composition layer over seat-derivation"
topic: "Timing — horizons, deadlines & vessel clock"
---

## DEC-022: Staffing horizon is *derived* config, not a stored field; shift time-state is a composition layer over seat-derivation

**See also** — later decisions that changed part of this one:
- Revised by DEC-032

**Decision:** The staffing horizon is **computed, never stored**: `staffingHorizonFor(shift, events,
leadDays) = (earliest scheduled event date+time) − leadDays`, where `leadDays` is a single
tenant/engine **config constant** (a *days* value — distinct from the same-day 45-min manifest call
lead, DEC-021/FUTURE_IDEAS; two different leads, two different purposes). It is **not** a new entity
field — no `Shift.horizonAt` column, no DDL change, no Repository-port change, no adapter change.
Modeled as a list-of-one per DEC-004 so Pass D's staged horizons slot in without a signature change.
The pure seat-fold **`deriveShiftState(seats)` stays untouched and seat-only** (DEC-005); a new
**`resolveShiftState(seats, {now, horizon, poolExhausted})`** composition layer sits *beside* it and
overlays the time dimension on the seat verdict. *(As shipped, the horizon is **precomputed** and
injected rather than passed as `shift`+`leadDays` — the pure fold takes no `shift` and reads no event
list. `staffingHorizonFor(shift, events, leadDays)` does the resolution upstream.)* The edges it owns:
`Pending`→`Filling` (horizon crossed), `Filling`/`Crewed`-fold→`AtRisk` (exhausted pool past horizon),
and "before the horizon → `Pending`", deferring to the seat-fold otherwise. **There is no explicit
`Crewed`→`Filling` early-bail edge** — DEC-019 makes `Bailed` transient, so the seat-fold never yields
`Crewed` with an open required seat; the early-bail case is already handled at the seat level before
this layer sees it. A `Crewed`/`Cancelled` fold result is returned as-is (a crewed trip doesn't
un-crew because a clock ticked).
**Why:** A stored horizon goes stale exactly when events are rescheduled (the #20 reconciliation
case) — you'd hand-maintain a cache of a subtraction. Deriving it keeps the deliberately-thin port
frozen and the core framework-free. Keeping `deriveShiftState` pure preserves DEC-005 ("state is
derived") and its ~12 seat-only tests; the composed result is *still* a pure function of (seats, time,
pool), just in a clearly-named second function — the same lifecycle-set-elsewhere pattern #20 used for
`Cancelled`. This closes the `derive.ts` ⚠️ horizon-blind KNOWN GAP and lands the early-vs-late bail
split DEC-019 explicitly deferred to this task.
**Tradeoff:** Two derivation functions instead of one, and the horizon is recomputed on each read
rather than cached — accepted; the inputs are already in hand and the subtraction is cheap. The
`poolExhausted` signal must be supplied by the caller (from the oracle's eligible pool), which couples
`resolveShiftState`'s callers to the oracle — acceptable, that's where the pool lives.
**Revisit / trigger:** If a stored horizon is ever forced (e.g. a query needs to sort thousands of
shifts by deadline at the DB), revisit — but that's an At-Risk-board-scale concern, not v1. The
concrete `leadDays` **value** stays the existing DEC-TBD open question ("ship a dumb default, tune");
this DEC fixes only *where the number lives*.
**Phase:** Phase 3 / task 3.1a (#39). (@architect pass, 2026-06-09.)
