---
id: DEC-024
title: "Tier-2 escalation is a *nudge* over a *derived* escalation trail; \"widen the pool\" is a logged stub, not a soft-constraint engine"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-024: Tier-2 escalation is a *nudge* over a *derived* escalation trail; "widen the pool" is a logged stub, not a soft-constraint engine

**Context:** Phase 3.2 (#40) builds Tier 2 (SPEC §1.2, DEC-006): widen the pool, direct-nudge
high-reliability crew, log the trail — all within `Filling`, no Spink. Two forks surfaced at the
@architect pass (2026-06-09) because the acceptance criteria assume levers v1 doesn't have.

**Decision:** Tier-2 escalation is two real mechanisms and one honest stub.
1. **The nudge is the live lever.** A direct assign-then-confirm (`assignPerson`) to the top-ranked
   eligible crew who ghosted the Tier-1 broadcast (went silent), logging a new `nudged` reliability
   event. **No `escalation_accepted` bonus is awarded in v1** (amended at the 3.2b build, 2026-06-10):
   every target `escalate` can reach is, by construction, already on the Tier-1 list — and rewarding
   someone for finally answering a *direct poke* after ignoring the broadcast is backwards. The
   `escalation_accepted` event stays reserved/unused (DEC-008) until `escalate` can reach a body *off*
   the Tier-1 list (a genuinely fresh person stepping into a shift others passed on). A nudged person
   who accepts gets only the ordinary `ask_accepted` — normal machinery, not an escalation reward.
2. **"Widen the pool" is a logged-intent stub.** Every eligibility rule is hard (MMC/rating are legal
   gates, PTO is suppression-only per DEC-009, double-booking is physical), and `broadcastAsk` already
   fans out to the *whole* ranked pool — so there is nothing to relax and no one new to reach. A new
   `pool_widened` event records that the engine re-confirmed full-pool exhaustion (the "I checked
   everyone, twice" rung of the trail); it widens nothing. No soft-constraint engine, no cross-day
   reach, no supernumerary promotion — each is its own later feature.
3. **The escalation log is derived, not a new aggregate.** A pure `escalationTrailFor(repo, shiftId,
   now)` projection (`src/asks/escalation-trail.ts`) reconstructs the trail from existing reads:
   asked/accepted/declined/silent from the seats' asks (`listAsksForSeat`), pool-widened/nudged from
   the one append-only reliability log (DEC-008) filtered by `metadata.shiftId`, exhausted from the
   distinct-pool `solveShift` (DEC-003). No `EscalationEvent` entity, no port method, no DDL, no
   adapter work — it crosses the in-memory→Postgres boundary for free. #41's At-Risk board reads it.
4. **The Tier-1-stall trigger lives in `tick`.** A `Filling` shift is *stalled* when it has unfilled
   required seats, every live ask has resolved declined-or-silent, and the horizon hasn't yet forced
   At-Risk. `tick` (DEC-023) detects it — reusing the `solveShift` exhaustion signal it already
   computes (the DEC-003 fix from 3.1a) — and fires a standalone `escalate(repo, shiftId, now)`. The
   shift stays `Filling`; At-Risk stays horizon/exhaustion-driven Tier 3.

**Why:** A second append-only log parallel to the reliability log is exactly the lock-in DEC-008 was
built to avoid; the transparency string is a read-model, so derive it. Relaxing hard rules is illegal
or physically impossible, so v1 has no soft levers — pretending otherwise means building an engine the
task can't afford.

**Tradeoff:** `pool_widened` is shift-scoped riding in a crew-keyed log, keyed to a `SYSTEM_ACTOR_ID`
sentinel — one wart, accepted over standing up a new aggregate. `escalationTrailFor` re-scans a shift's
seats/asks and the roster's logs per read rather than caching — cheap at BrewBoat's scale; revisit if
the At-Risk board ever sorts at DB scale (same trigger as DEC-022's stored-horizon revisit).

**Split:** #40 is honestly an 8, not a 5 — the unbudgeted stall-trigger design is the reason. Shipped
as **3.2a** (escalation substrate + trail projection — pure, additive, unblocks #41) then **3.2b**
(stall detection + `escalate()` in `tick`).

**Phase:** Phase 3 / task 3.2 (#40). (@architect pass, 2026-06-09.)
