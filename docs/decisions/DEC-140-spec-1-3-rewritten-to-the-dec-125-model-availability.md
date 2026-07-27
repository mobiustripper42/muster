---
id: DEC-140
title: "SPEC §1.3 rewritten to the DEC-125 model — availability is two mechanisms, not one rule engine; COI-expiry and lead-time cutoff closed as out of scope"
topic: "Reservations & payments"
---

## DEC-140: SPEC §1.3 rewritten to the DEC-125 model — availability is two mechanisms, not one rule engine; COI-expiry and lead-time cutoff closed as out of scope

*(Authored on `feature/reservations` as DEC-138; **renumbered to DEC-140 at the 2026-07-27 merge** —
`main` had independently taken 138 for the embeddable-booking-widget decision. Numbers are allocated on
`main` from now on: a branch takes the next free number at merge time. See #562.)*

**Status:** Decided 2026-07-25 (Eric + Claude, under DEC-105/125). Doc-only — **no code change**.
Triggered by the 2026-07-25 doc-consistency audit, shard C
(`docs/audit/2026-07-25/shard-C-asks-shifts.md`).

**Context.** SPEC §1.3 specified a single **rule engine**: one merged list of property and crew
rules, a `Verdict` object (`{ bookable, status, failures, deferred, recheckBy }`), per-rule
`hard | soft` severity with tenant downgrade-to-warn, and `first-fail` / `collect-all` evaluation
modes. The audit found none of that exists. What exists is **two** mechanisms with different shapes:
booking availability as **set subtraction** (DEC-125) and crew eligibility as **six hard
per-candidate rules** (`src/oracle`). §1.3 read as a description of the system; it was a description
of a system that was never built, and it had accumulated enough authority to be cited as the plan.

The audit deliberately did **not** propose an edit, because "why is this unimplemented" and "is this
still the plan" are different questions and only the operator can answer the second.

**Decision.** §1.3 is **rewritten to describe what shipped**, keeping the two insights that survive
and explicitly parking the rest.

1. **Two questions, two mechanisms — stated up front.** "Can a customer book this boat?" is answered
   by the DEC-125 computed set (`open slots = schedule × vessels × dates × muster-owned-days −
   blocks − bookings`). "Who may crew this seat?" is answered by `src/oracle`. Conflating them was
   the original error; the rewrite leads with the distinction.
2. **The old property rules are re-homed, not deleted.** §1.3 now carries a mapping table showing
   where each landed — season/daily-hours into the schedule term, maintenance/haul-out and blackouts
   into `Block` variants, vessel-double-booking into the slot-identity guardrail, pax-vs-COI into
   `canBook`. Two are recorded as genuinely partial or absent: **no per-offering minimum party size**,
   and **no booking turnaround buffer** (the `turnaround` in `src/builder/derive.ts` is the crew
   fatigue call, a different concept sharing the word).
3. **The satisfiability finding survives verbatim** — it is still the most important architectural
   point, and its resolution is unchanged: the eligible pool is computed upstream of the ask (§1.1),
   so the problem collapses into a filter on *who gets asked* rather than a solver.
4. **The two horizons survive; `deferred` is resolved into the state machine.** A shift outside its
   staffing horizon is `Pending` — crew rules abstain, they do not fail. The "N trips booked inside
   the staffing window, no crew assigned" worklist §1.3 promised **exists**, by a different
   mechanism: the Shift Builder derives shifts from vessel manning **source-agnostically**, so a
   Muster-sold event staffs exactly like a Xola-imported one, and a shift that cannot be crewed
   escalates to `At-Risk` (§1.2 Tier 3). The concept shipped; the `Verdict` wrapper did not.
5. **Parked, with no current consumer** (Muster is single-tenant): `hard | soft` severity with tenant
   downgrade, the `Verdict` object, `first-fail`/`collect-all` modes, and the tenant-configurable "M"
   rules (TWIC, medical, drug consortium, duty-hour, daylight/tide, weather).

**Two questions closed on the record**, so no future audit re-raises them as gaps:

- **COI expiry is NOT a booking rule and will not become one (operator, 2026-07-25).** For BrewBoat
  the inspection date is known well in advance and is not missed; the boat passes. The failure mode a
  COI-expiry check would guard is one in which a Muster banner is the least of the operator's
  problems. *The asymmetry with crew is deliberate and correct:* `mmc_valid_on_date` **is** enforced,
  because a lapsed individual credential is a routine, silent, per-person event across a roster. A
  vessel certificate on a single hull under direct operator attention is not the same class of risk.
- **No lead-time cutoff.** It would block the flow §1.2 calls the payoff — the autonomous
  last-minute booking ("customer books Sat-evening on Friday night → shift is born straight into
  `Filling` → Tier 1 fires"). Refusing short-notice bookings would delete an emergent behavior the
  spec treats as a feature. The *better* shape for short notice — hold the slot, find crew, then
  confirm the booking, so you never sell what you cannot staff — is **parked** in
  `docs/FUTURE_IDEAS.md` rather than built. `CheckoutHold` is the existing primitive it would extend.

**Alternatives considered.** *Build §1.3 as specified* — rejected: a rule engine with soft severity
and tenant downgrade is multi-tenant generality for a single-tenant product, and the set-subtraction
model is a better fit for whole-boat charter than per-rule evaluation. *Delete §1.3* — rejected: the
satisfiability finding and the two-horizon frame are load-bearing and cited from §1.1 and §1.2.
*Leave it and annotate* — rejected: the section's failure was that it read as descriptive; a banner
on top of eighty lines of wrong description does not fix that.

**Schema:** none. Doc-only.

**Revisit if:** Muster becomes multi-tenant (soft severity and tenant rule-downgrade come back), or
the cutover (DEC-126) surfaces a booking-time constraint the set-subtraction model cannot express —
at which point the parked `Verdict` machinery is the place to start, not a fresh design.
