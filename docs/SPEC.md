# Muster — Authoritative Design Spec

Status: **🔒 LOCKED v1.0 — 2026-06-03** · Baseline for the Claude Code build. Consolidates the 11
design artifacts into one buildable source of truth. Working name: **Muster** (crew engine). Worked
example / tenant #1: **BrewBoat**.

> **LOCK RULE.** This document is frozen as the build baseline. **No new features or scope go in
> here.** Anything new — however good — goes in a separate `future-ideas` doc in the project and
> waits. The only edits permitted to a locked spec are *corrections* (something already in scope is
> wrong, contradictory, or unclear) and downstream feedback from Design/Code about existing
> behavior — never additions. Unlock with a deliberate version bump (v1.1) only when a batch of
> changes is genuinely ready; don't let the baseline drift one shiny idea at a time. 😬

**This document is the source of truth.** Screens are built from these words. When a screen
reveals something the words got wrong or missed, the words get edited first, then the screen is
regenerated. Code reverse-engineers from this text, not from the mockups.

Source artifacts folded in: shift-state-machine, availability-oracle, crew-app-surface,
crew-reliability-score, admin-1-shift-builder, admin-2-assignment-view, admin-3-at-risk-board,
payments-topology, coexistence-rollout, event-admin, customer-portal-sketch.

> **Section status legend:** ✅ written · ◻️ not yet written.
> 0 Overview ✅ · 1 Substrate ✅ · 2 Surfaces ✅ (2.1 Roster · 2.2 Event Admin · 2.3 Builder · 2.4 Assignment · 2.5 At-Risk · 2.6 Crew App · 2.7 Crew Self-Serve) · 3 Cross-cutting ✅ · 4 Parked ✅

---

# 0. Overview & glossary

## 0.1 What Muster is

Muster is a **crew engine** for small-passenger-vessel operators: it turns a week's reservations
into discrete **shifts** (one boat, one day), works out who is legally allowed to crew each shift,
asks them in reliability order, and surfaces only the shifts the automation could not close. It is
the half of an eventual Xola replacement that Xola has no concept of — Xola knows a booking is
paid; Muster knows whether anyone is going to be standing on the dock to run it.

The product's spine is a **policy/mechanism split**: the rules (USCG manning, credentials,
turnaround) are tenant-owned data; the engine that runs them is generic. That split is what lets
Muster be built perfect for one niche (BrewBoat) and still be sellable later without forking.

## 0.2 Scope of this spec — locked

**In scope (the 2026-buildable crew engine):**

- The **behavioral substrate** — shift/seat state machine, availability oracle, reliability score
  (§1), written as the canonical reference the surfaces cite.
- **Event Admin** — the imported events + reservations data layer everything reads from.
- **Shift Builder** — reservations/events → reviewable ~~, lockable~~ shifts. *(Lock cut — DEC-082.)*
- **Assignment View** — the per-shift crewing cockpit.
- **At-Risk Board** — the cross-shift triage worklist.
- **Crew App** — the three crew-facing surfaces (the ask, my shifts, the shift card).
- **Crew Roster / People** — the per-person record everything above consumes (NET-NEW; see §2
  when written). Without it the oracle has nothing to reason over.
- **Cross-cutting** — notifications/push, magic-link auth, and the cancel-cascade + dispute-alert
  flows **only where they surface inside the admin app**.

**Parked — inherited deferrals, not reopened here (full list in §4):**

- ~~The **customer portal** — sketch only, Tier 4, off-season 26/27. Builds last; not on the
  critical path because 2026 reservations arrive via CSV.~~ — **REOPENED by DEC-105 (2026-07-11).**
  Muster takes real paid reservations **in 2026**, alongside Xola: **Phase 11** service layer, **Phase 12**
  the real customer UI. Two phases (**DEC-126, 2026-07-17**): a **pilot coexistence** (Muster sells a subset
  alongside Xola), then a **cutover** — a one-time full import of Xola's reservations into Muster, after
  which Muster is the reservation source of truth (the cutover is reversible). 2026 reservations do **not**
  arrive via CSV — that's the live Xola **API pull** (DEC-036/037/043), which stops at the cutover.
- **Payments topology internals** — deposit-vs-full, refund-schedule numbers, Stripe integration
  detail. Only the admin-facing *surfaces* of payments are in scope.
- **Native vs PWA** for the crew app — decided at the infrastructure stage.
- **Historical Xola data migration** — leaning read-only archive.
- ~~The **Xola API bolt-on** — killed~~ — **UN-KILLED by DEC-036 (2026-06-15)**, which explicitly
  flags this line as needing correction: the kill rested on DEC-011's belief that the API was
  unreliable and hard to extract from (traced to faulty "crewbook" info), **falsified by a working,
  tested client proven live**. The read-only API pull is now the primary ingest. *(Write-back to Xola
  stays manual — the "enter these in Xola" sheet — since the pull is read-only.)*

A "full spec" session tempts re-speccing the deferred work. The discipline is that this document
*inherits* those deferrals; it does not relitigate them.

## 0.3 The 2026/2027 arc (context the surfaces assume)

> **⚠️ Reconciled 2026-07-15 (S54), revised 2026-07-17 (S56, DEC-126).** The 2026/2027 arc below is
> **superseded by DEC-105 + DEC-126**: Muster takes real paid reservations **in 2026**. The shape is
> **coexistence → cutover**, not the old "2027 switch": first a **pilot coexistence** (Muster sells a
> subset alongside Xola, `source`-discriminated — DEC-106); then a **cutover** (DEC-126) — a **one-time
> full import** of Xola's reservations into Muster, after which **Muster is the reservation source of
> truth**, the ongoing Xola pull stops, and money stays in Xola only for imported bookings. The cutover is
> **reversible** (rollback to Xola if it fails). *(This revises the S54 "permanent coexistence, no cutover,
> drains naturally" wording — that was the pilot half; DEC-126 adds the flip, which does include a one-time
> migration.)* The ingest is the API pull, not a CSV (DEC-036/037/043).

- **2026 — coexistence.** Xola owns bookings/money/waivers ~~. A CSV export from Xola is imported~~
  — **corrected:** a **live Xola API pull** (DEC-036/037; CSV retired, DEC-043) imports into Event
  Admin and **auto-forms shifts**. Muster crews those shifts for real. Crew are also assigned as
  **guides in Xola** (manual write-back from a Muster-emitted sheet) because the guest manifest still
  lives in Xola. **Added (DEC-105):** from Phase 11, Muster *also* sells its own reservations on
  Muster-owned vessel-days, alongside the imports, discriminated by `source` (DEC-106).
- ~~**2027 — Muster takes bookings.** Shifts auto-form from Muster's own live feed; the CSV step
  evaporates. Same shift-builder surface, different input source.~~ — **corrected (DEC-105/126): this is
  2026, via coexistence → cutover, not a dated switch.** During the pilot, Muster-native and Xola-sourced
  events coexist. At the **cutover** (DEC-126) Xola's reservations are imported once, the pull stops, and
  Muster owns reservations; the import path dies at the cutover, not on a calendar date. The shift builder
  was always source-agnostic,
  which is what makes the drain a non-event for it.
- **The hinge** that ends the Xola split: the day the crew-facing **manifest** (guest name +
  count per event) lives on Muster's shift card, crew stop needing Xola. Pull the manifest early.

The import path is disposable plumbing; everything it feeds is permanent.

## 0.4 Glossary — locked vocabulary

| Term | Definition |
|---|---|
| **Event** | A scheduled trip occurrence: BrewBoat · Sat · 3pm · capacity 6. Exists whether or not anyone booked it. *(Correction, DEC-016: "capacity 6" is illustrative — real boats are COI 12–16; capacity is per-vessel data.)* |
| **Reservation** | A customer buying seats *on* an event: "Smith, party of 4, on the 3pm." |
| **Shift** | One boat + one day, batching that boat's events (1/3/5pm) into a single **crewing unit**. The atom Muster crews. |
| **Seat** | One role slot inside a shift (a captain seat, a mate seat). What crew get assigned to. |
| **Required seat** | Working crew the shift legally/operationally needs (BrewBoat = 1 captain + 1 mate, derived from COI). **Gates** the shift. *(Correction, DEC-016: illustrative only — the real BrewBoat fleet is 4 inspected boats, COI 12–16, 2 crew each; manning is per-vessel data the deriver loops, not this fixed pair.)* |
| **Supernumerary seat** | Optional, non-gating seat (trainee). Carries a pairing rule and **consumes a passenger slot** against COI max-pax — not free capacity. |
| **Crew** | A person who can fill seats — captain and/or mate, by rating. |
| **Eligible pool** | The people legally fillable for a given open seat (credentials valid on the trip date, correct rating, not double-booked, not on PTO), ranked by reliability. |
| **Oracle** | The single authoritative function answering "can this trip be booked at this time — yes/no, and if no, why?" A rule engine, not a calendar. |
| **Horizon** | When a rule gets a vote. **Booking horizon** (property rules, gates the sale) vs **staffing horizon** (crew rules, N days out when humans get committed). |
| **Reliability score** | Per-crew number setting **ask priority** within the eligible pool. Ranking, not a gate, not a grade. |
| **Tiers 1–3** | Degrees of automation in filling a seat: 1 autonomous, 2 semi-autonomous escalation, 3 human (Spink). |
| **Manifest** | The guest list crew need — name + phone/count. **Per-event**, not per-shift (a Saturday shift has a 1pm, 3pm, 5pm manifest). Waivers explicitly *not* required for crew. |
| **Spink** | The operator persona (BrewBoat's). Semi-retired; the design goal is no babysitting. |
| **Drew** | The owner/business persona. Owns the money/policy decisions (refunds, deposit-vs-full). |

> **Manifest reconciliation (decided):** the manifest is grouped **by event** on the shift card.
> This supersedes the per-shift phrasing in crew-app-surface §3.

---

# 1. Behavioral substrate (canonical reference)

The surfaces in §2 render and drive the machinery defined here. This section is the reconciled
canonical version; where a source doc was superseded by a later decision, the decision is folded
in and flagged.

## 1.1 The shift/seat state machine

**Two nested machines. Model them separately; derive the shift state from its seats.**

### Shift states

| State | Meaning |
|---|---|
| **Pending** | Trips booked into the shift, staffing horizon not yet reached. Crew not sought. Crew rules abstain. (The "booked in February, it's July" state.) |
| **Filling** | Staffing horizon crossed. Shift needs crew; the system is working it (Tiers 1–2) — whether zero or some seats are filled. (Open + Filling merged: seat sub-states already distinguish "no progress" from "some.") |
| **Crewed** | Every **required** seat confirmed. Green. (Supernumerary seats do not gate this.) |
| **At-Risk** | Automated escalation exhausted, still short, trip closing in. Human-only state — surfaced to Spink. |
| **Completed** | Trip ran. Historical. Feeds reliability scores. |
| **Cancelled** | Shift killed — booking cancelled, or couldn't crew and Spink pulled the plug. |

### Seat sub-states

| Seat state | Meaning |
|---|---|
| **Open** | Needs a person. Eligible pool computed (credential + role + date-valid). |
| **Asked** | Ask is out — broadcast to pool, or named person notified. Awaiting response. |
| **Claimed** | Someone accepted (ask-then-assign) or a named person was assigned (assign-then-confirm). Tentative. |
| **Confirmed** | Locked to a specific person. |
| **Bailed** | A confirmed person backed out. Seat returns to Open; shift re-evaluates. |

> **⏳ RESERVED (v0.2 — not v1): a tentative `Held` tier.** Progressive commitment (see §4 parked,
> "Progressive crew commitment") will add a state weaker than `Confirmed` but stronger than `Asked`
> — a crew member who has *soft-held* a shift at an early horizon, pending hard confirmation at a
> later one. Model the seat machine so a tier can be inserted between `Claimed` and `Confirmed`
> without restructuring; do **not** implement it in v1. An all-`Held` shift stays `Filling` (no new
> shift state).

### Transitions (the load-bearing edges)

- `Pending → Filling` — staffing horizon reached.
- `Filling → Crewed` — all required seats confirmed.
- `Filling → At-Risk` — escalation exhausted, still short (**includes "no takers at all"** — there
  is no separate Open shift state).
- `Crewed → Filling` — a confirmed crew bails with **time to refill**. The graceful-bail edge the
  crew app's frictionless decline depends on.
- `Crewed → At-Risk` — a confirmed crew bails **late, no time/pool** (the 11pm bail). A locked
  shift is never truly locked until the trip runs.
- `At-Risk → Crewed` — Spink leans on someone, seat fills.
- `At-Risk → Cancelled` — pull the plug.
- `Crewed → Completed` — trip day passes, trip ran.
- `Cancelled` — reachable from every pre-Completed state.

Seat machine: `Open → Asked → Claimed → Confirmed`, with `Asked → Open` (timeout/all-declined,
re-ask next), `Claimed → Open` (claim rescinded), `Confirmed → Bailed → Open` (re-opens & re-asks).

**The eligible pool is computed upstream of the ask:** only people whose credentials are valid on
the trip date and who hold the required rating ever get asked. By the time someone can tap "in,"
they are already a legal candidate — the oracle's satisfiability problem (§1.3) collapses into a
filter on *who gets asked*.

## 1.2 The escalation tiers

The carrot/stick lives in *how the system works a seat*, not in the state names. The tiers are
degrees of automation within `Filling`:

- **Tier 1 — autonomous fill.** Shift enters `Filling`; system asks the eligible pool ranked by
  reliability, accepts down the list until required seats are `Confirmed` → `Crewed`. No Spink.
  The normal Saturday.
- **Tier 2 — semi-autonomous escalation.** Tier 1 stalls. System widens the pool, direct-nudges
  high-reliability people, optionally sweetens. Still `Filling`, still no Spink.
- **Tier 3 — human.** Automation exhausted. Shift → `At-Risk`, surfaces on the board with full
  context (who was asked, who declined, who never answered, how close it got). Spink leans /
  reschedules / cancels.

**The autonomous last-minute booking is emergent, not a feature:** customer books Sat-evening on
Friday night → oracle says bookable (provisional) → inside the staffing horizon, so the shift is
born straight into `Filling` → Tier 1 fires → first eligible captain + mate accept → `Crewed` →
Spink gets an FYI, not a task. The organs running in sequence with no human in the loop.

### Assignment protocol per role (fork resolved)

Two protocols ride the same seat machine:

- **Ask-then-assign** (mates): broadcast → yeses accrue → ranked → confirm down the list.
- **Assign-then-confirm** (captains): name a person → they confirm/decline → decline kicks to next.

> **Superseded for v1 by DEC-061:** the explicit "confirm" step is now automatic — a winning "in"
> advances `Asked → Claimed → Confirmed` in one operation (both protocols). The first-acceptable-yes
> CAS already picked the winner; the operator's confirm only rubber-stamped it. "In" now means
> committed (a retraction is a penalized bail). The reserved `Held` soft-hold (DEC-005) is the place
> a future soft-commitment buffer would go — not a resting `Claimed`.
>
> **Refined by DEC-063:** the ask-then-assign "broadcast" is **staged (a drip)** — one ask to the
> top-ranked candidate, widening by one every `ASK_DRIP_INTERVAL_MINUTES` (default 15), asks
> accumulating, first-acceptable-yes-wins unchanged. `interval=0` is the original blast-all; inside
> the fills-by deadline (DEC-031) it blasts regardless. Ranking now drives *timing*, not just display.

**Decided:** per-role default (mates ask-then-assign, captains assign-then-confirm), with a
per-person override toggle. Default contested-seat winner is **first-acceptable-yes-wins** for
rollout (simple, matches Spink's instinct, feels fair); **best-by-score** is a knob to flip once
reliability data is trusted. The two mostly agree — they diverge only when a flake answers first.

## 1.3 Availability — two questions, two mechanisms

> **Rewritten 2026-07-25 (DEC-138).** This section previously specified a single **rule engine**: one
> merged list of property and crew rules, a `Verdict` object, per-rule `hard | soft` severity with
> tenant downgrade, and `first-fail` / `collect-all` evaluation modes. **That framing is superseded.**
> Two separate mechanisms shipped instead, and the old prose described neither. The *insights* it
> recorded — two horizons, and "crew rules are not independent booleans" — survive and are kept below.

Two different questions wear the word "availability." Different code, different shapes. Conflating
them is the mistake the old §1.3 made.

| Question | Mechanism | Lives in |
|---|---|---|
| **"Can a customer book this boat?"** | Set subtraction over a schedule | `src/reservations/availability.ts` |
| **"Who may crew this seat?"** | Per-candidate rule evaluation | `src/oracle/` |

### Booking availability — a computed set (DEC-125)

Muster does not write an `Event` row per potential departure. An `Offering` **plus its schedule is a
rule**; open availability is **computed on read**, and a row materializes only once a slot acquires
state — a booking, a hold, or a block:

```
open slots = schedule × vessels × dates × muster-owned-days − blocks − bookings
```

`deriveVirtualAvailability` is that computation, and it is **pure**. This is where the old §1.3's
"property rules" actually live — not as rules, as terms in a set difference:

| Old §1.3 property rule | Where it went |
|---|---|
| within season · within daily hours | the **schedule** term (`Offering.seasonStart`/`seasonEnd`, departure times) |
| not in maintenance / haul-out | `Block{kind:"vessel"}` — an inclusive out-of-service date range |
| blackout dates | `Block{kind:"location"}` (day + time window) and `Block{kind:"vessel"}` |
| vessel not double-booked | the **slot-identity guardrail** — one boat holds one departure per day+time — plus `Block{kind:"vesselHold"}` |
| pax ≤ COI max | `canBook` — `partySize > event.capacity` fails |
| min/max pax | partial: `canBook` bounds party to `1..capacity`. **No per-offering minimum exists.** |

**Whole-boat, not seats.** BrewBoat sells whole-boat private charters — one reservationist per
boat-event (DEC-105). So availability is a **mutex, not a seat count**: an event is bookable iff it
carries zero active `source='muster'` reservations. Remaining is a step function — `capacity` when
unclaimed, `0` when claimed — **never** `COI max − Σ party sizes`. The whole-boat rule lives in the
predicate, not as a database constraint (DEC-109). Only `source='muster'` events are sellable here;
Xola events keep their money in Xola (DEC-105) and never enter this funnel.

**Deliberately absent, and staying that way** (DEC-138):

- **COI expiry as a booking rule.** Inspection is scheduled and passed; the failure mode this would
  guard is one where a "your COI expired" banner in Muster is the least of the operator's problems.
  Not Muster's job. *(Note the asymmetry with crew: `mmc_valid_on_date` **is** enforced, because a
  lapsed individual credential is a routine, silent, per-person event. A vessel certificate is not.)*
- **A lead-time cutoff.** It would block the flow §1.2 calls the payoff — the autonomous last-minute
  booking. A short-notice booking is *supposed* to land inside the staffing horizon and fire Tier 1
  immediately. Holding a short-notice slot until crew is confirmed, rather than refusing it, is a
  parked idea (`FUTURE_IDEAS.md`), not a cutoff.

### Crew eligibility — the composite that stayed a filter

`src/oracle/` answers who may crew a seat. Six rules, all hard, all per-candidate: `is_active` ·
`has_rating` · `mmc_valid_on_date` · `not_double_booked` · `not_on_pto` · `not_recurring_off`. Each
returns `{ ruleId, passed, severity, details }`, where `details` is the **structured reason payload**
the admin surfaces render — never a sentence.

**The satisfiability finding still holds, and is still the important architectural point.** Crew
rules are not independent booleans. Evaluated separately they lie: Captain A is free but his MMC
lapsed; Captain B is current but already booked — every rule passes about a *different person*, so
the naive shape returns a false yes. The resolution is the one §1.1 records: **the eligible pool is
computed upstream of the ask.** Only people whose credentials are valid on the trip date and who hold
the required rating are ever asked, so by the time someone can tap "in," they are already a legal
candidate. The satisfiability problem collapses into a filter on *who gets asked* — which is why the
oracle is a per-candidate filter and not a solver.

### The two horizons — the surviving frame

- **Booking horizon** — knowable far out; gates the sale. Answered by the computed set above.
- **Staffing horizon** — N days out, when humans get committed. Answered by the oracle.

A shift outside its staffing horizon is `Pending`: crew rules **abstain**, they do not fail. This is
the old `deferred` verdict, and it is real — it just isn't an object. It is the `Pending → Filling`
edge (§1.1) plus the At-Risk board.

**"Provisional" resolved into the state machine.** The old §1.3 said a deferred rule makes a booking
*provisional* and feeds an admin worklist — "N trips booked inside the staffing window, no crew
assigned," the operational view Xola cannot produce. **That view exists**, by a different mechanism:
the Shift Builder derives shifts from vessel manning **source-agnostically**, so a Muster-sold event
staffs exactly like a Xola-imported one, and a shift that cannot be crewed escalates to `At-Risk`
(§1.2 Tier 3) where Spink sees it. The concept shipped; the `Verdict` wrapper did not.

> **⏳ RESERVED (v0.2 — not v1): the staffing horizon may be *staged*.** v1 has one staffing horizon.
> Progressive commitment (§4 parked) generalizes it to an **ordered list of checkpoints** — earlier
> *soft* horizons banking tentative willingness, converging on the existing *hard* horizon that
> commits real bodies. Model the staffing horizon as a list-of-one, not a scalar.

### Parked from the original §1.3

Recorded here so they are not re-derived as gaps. All are engine generality with **no current
consumer**, and Muster is single-tenant:

- **`hard | soft` severity with tenant downgrade-to-warn.** `RuleResult.severity` is the literal
  `"hard"` — soft is unrepresentable, not merely unused.
- **The `Verdict` object** (`{ bookable, status, failures, deferred, recheckBy }`).
- **`first-fail` / `collect-all` evaluation modes.**
- **The tenant-configurable "M" rules** — fuel/cleaning turnaround, TWIC, medical cert, drug-testing
  consortium, duty-hour/rest, daylight/tide, weather/small-craft-advisory.
- **Booking turnaround buffer** (relational). *(The `turnaround` in `src/builder/derive.ts` is the
  crew fatigue call — a different concept that happens to share the word.)*

**Not availability's job at all ("N"):** waiver (check-in gate), payment (booking flow), coupon
(pricing), customer standing (risk). The filter is *knowable fact vs. judgment* — hard knowable facts
are clean terms; judgments and things that change after booking get kicked out.

## 1.4 The reliability score

A per-crew number that sets **ask priority** within the eligible pool. Ranking, not judgment, not
a gate (credentials gate; the score only orders who-gets-asked-first). It is the **single lever**
for both carrot and stick: position in the queue. Good actors see more shifts and claim first;
flakes drift down and naturally work less. No explicit punishment — the system stops manually
compensating for them, which is the thing Spink does in his head today.

### Two axes (blended into one number for v1)
- **Responsiveness** — do they answer asks, and how fast?
- **Dependability** — once they commit, do they honor it?

### Loggable events — log rich from day one (even if v1's formula ignores some)
- **Response (per ask):** `ask_sent` · `ask_accepted` (+latency) · `ask_declined` (+latency,
  **neutral**) · `ask_ignored` (timed out — **negative**).
- **Commitment (per confirmed seat):** `shift_completed` (positive) · `shift_bailed` (+how far in
  advance, **negative scaled by lateness**) · `no_show` (worst case).
- **Bonus:** `escalation_accepted` · `at_risk_rescue`.
- **Acknowledgment** `shift_acknowledged` — **NEW, decided this session.** See box below.

### The two distinctions that make or break it
- **Declining is neutral; ignoring is the sin.** Penalizing a fast "no" teaches crew to go silent
  to dodge the penalty, destroying the signal. Reward *responsiveness regardless of answer*. Only
  `ask_ignored` carries a response penalty.
- **Lateness of a bail is the signal, not the bail.** A cancel a week out is cheap (lands the shift
  back in `Filling`); an 11pm bail is expensive (lands it in `At-Risk`). `no_show` is the maximum.

### v1 formula — deliberately dumb
Rolling window (last ~90 days or ~N shifts — pick one). `+` for `ask_accepted` and
`shift_completed`; `+` small for low `ask_declined` latency; `0` for the decline itself
(**superseded by DEC-120**: an Out now scores **+1**, an In **+2** — "reward responsiveness regardless
of answer" is implemented as a small positive, not zero); `−` for
`ask_ignored`; `−` for `shift_bailed` scaled by lateness; `−−` for `no_show`; `+` bonus for
`escalation_accepted` / `at_risk_rescue`. One number, rolling window, no tuning machinery. Weights
are an anticipated near-term knob (e.g. exponential bail-lateness penalty) — fine to add against
real data; do not block launch tuning them.

> **Acknowledgment reward (decided this session):** if a "confirm you're still good" acknowledgment
> exists, it earns a **small positive only — no penalty arm.** A penalty would invent a new sin and
> collide with "declining is neutral, only ignoring is the sin." Two hard constraints: (1) the
> weight is **capped well below `shift_completed`** so no amount of diligent acking out-ranks
> someone who actually shows up — otherwise you breed a responsive ghost who games the cheap signal;
> (2) prefer a **passive** ack signal (e.g. "opened the live shift card within 24h of call time")
> over an explicit tap, since the card is already authoritative and live — zero added crew friction,
> full anxiety-reducer for Spink. Explicit one-tap "I'm good for Saturday" is the fallback if passive
> proves too soft. Its real predictive value is as a **leading indicator** feeding the warming view
> (assignment-view §2) / At-Risk board, not the score — so even in the score it stays small. **Log
> the event day one; the score weight is small/optional in v1, tuned against data.**

### Visibility — visible to self (decided)
The crew member sees **their own** standing — you cannot game it except by being reliable, so
exposure turns it into a feedback loop that nags automatically. Guardrails: **individual, not
comparative** (their own standing + reasons — "answered fast · showed 8/8 · one late bail" — never
a leaderboard); the manual veteran adjustment is visible only in its *effect* (good standing), not
as a mechanism. Showing Spink the full ordering + reasons on the assignment view is fine.

### Manual adjustment & veteran weighting (decided)
A flat rolling window forgets a 4-year veteran after a slow couple of months. Spink gets a **manual
thumb on the scale** per crew member: a **boost** or a **floor** he sets by judgment ("this veteran
never ranks below X"). Dead-simple manual knob, **not** an auto-tenure-curve. This also resolves
cold start: unknowns start neutral/mid-pool (so they get tried); Spink seeds trusted hires above
neutral. The algorithm only governs people he hasn't formed an opinion about yet.

---

# 2. The surfaces

Each surface section uses one template:

- **Purpose** — what this surface is for, in one or two lines.
- **States to render** — the machine/data states the screen must show (so the screen is built to
  cover them all, not just the happy path).
- **Actions** — what the operator/crew can do here.
- **Data read** — which substrate/data this surface consumes (so dependencies are explicit).
- **Edge cases** — the off-happy-path behavior the screen must handle.
- **Acceptance criteria** — Given/When/Then or checklist; independently testable.

Written bottom-up: each surface cites the ones above it in this list.

---

## 2.1 Crew Roster / People

> **NET-NEW.** No source artifact — derived here from everything that *consumes* a per-person
> record: the oracle's credential rules (§1.3), the eligible pool (§1.1), the reliability score and
> its manual thumb (§1.4), and the crew app's credential nudge (§2.6). Without this surface the
> oracle has nothing to reason over in 2026. This is the one most likely to shift the others, so
> it is specified first.

### Purpose
The operator-maintained record of every crew member — identity, what they're rated for, their
credentials and expiries, their availability suppressions, and Spink's manual thumb on their
reliability standing. It is **reference data the rest of Muster reads**; it is not a workflow.
Crew do not self-register in 2026 — Spink creates and maintains these records. (The crew's *own*
view of their standing and credential nudges lives in the crew app, §2.6, reading this record.)

### The record (fields)
- **Identity:** name; **phone** (SMS/push target and magic-link destination — crew-app §1); email
  (optional secondary).
- **Ratings:** which seats this person can fill — **captain**, **mate**, or both. The eligible-pool
  filter reads this per seat. (Supernumerary/trainee is a *seat* property, not a rating — a trainee
  is simply someone not yet rated, riding a supernumerary seat to build hours.)
  *(Correction, DEC-ROLE-1: roles are tenant **data**, not a fixed enum — `RoleType` is a per-tenant
  table `{id, tenantId, name}`; `ratings` is a set of `roleTypeId`; `Seat.role` references a
  `roleTypeId`. "Captain"/"mate" are BrewBoat's two seeded rows, not a hardcoded pair.)*
- **Credentials:** a set of `{ type, identifier?, expiry }` rows. **MMC is universal** (captain
  gating, 5-yr renewal — "ages out" = expires, not retires). Other credential types
  (**TWIC, medical cert, drug-testing consortium**) are **tenant-configurable**, matching the
  oracle's "M" rules (§1.3) — a tenant turns on the credential types its routes/facilities require.
  For BrewBoat v1, ship MMC + medical; TWIC only if a facility demands it.
- **Reliability standing (read-only here):** the computed score/ordering + the human-readable
  reasons (§1.4). Displayed, not edited.
- **Manual thumb (Spink-set):** a **boost** or a **floor** per person (§1.4 — "never ranks below
  X"). This is the editable reliability control; the score itself is not hand-editable.
- **Availability suppressions:** **PTO / blackout** windows only. **Suppression-only by design** —
  there is no positive "set your recurring availability" calendar (the Xola trap, state-machine §9).
  Absence of a suppression means available; the system never asks crew to maintain a calendar.
- **Protocol override (optional):** per-person toggle of ask-then-assign vs assign-then-confirm,
  overriding the per-role default (§1.2). Lives on the person because it's a per-person trait.
- **Status:** active / inactive. Inactive removes them from future eligible pools without rewriting
  history.

### States to render
- **Roster list** — all crew, each row showing name, ratings, reliability standing (high/med/low or
  ordering — a raw number is optional), and a **credential-health flag** (valid / expiring-soon /
  expired). Expired or expiring credentials must be visible at the list level — this is the
  pool-health view Spink currently keeps in his head.
- **Person detail** — the full record above, with credentials and their expiry dates, current
  suppressions, the reliability reasons, and the manual-thumb control.
- **Cold-start state** — a newly added crew member with no history: shows **neutral / mid-pool**
  standing (so they get tried), with an explicit "no history yet" indication rather than a
  misleading low score (§1.4).

### Actions
- Add / edit a crew member (Spink-created).
- Set ratings (captain / mate / both).
- Add / update / remove a credential row (type + expiry).
- Set or clear the **manual boost / floor**.
- Add / remove a **PTO / blackout** window (suppression).
- Set the per-person protocol override.
- Activate / deactivate.

### Data read
- Writes the record that the **oracle** (§1.3 credential + availability rules), the **eligible pool**
  (§1.1), the **reliability score** (§1.4), and the **crew app credential nudge** (§2.6) all read.
- Reads back the **computed reliability score** (§1.4) for display.

### Edge cases
- **Credential expires mid-booking-window.** The oracle's date-valid check (§1.3) drops the person
  from any eligible pool for trips after the expiry automatically — no manual removal. If they were
  already *assigned* to such a shift, that shift surfaces on the At-Risk board as a credential lapse
  (§2.5).
- **Expiring-soon.** Before expiry, the crew app nudges the person (§2.6) and the roster flags it —
  the goal is to renew before they drop from the pool, not discover it at the dock.
- **Deactivation while assigned to a future shift.** Deactivating must surface the affected future
  assignments (don't silently strand a shift); those seats reopen.
- **Trainee → rated transition.** When a trainee earns a rating, editing their rating makes them
  appear in the corresponding eligible pool going forward; their supernumerary history is just past
  shifts.

### Acceptance criteria
- [ ] Spink can create a crew member with name, phone, and at least one rating.
- [ ] A crew member with an MMC expiring before a trip date does **not** appear in that trip's
      eligible pool, with no manual action.
- [ ] The roster list visibly flags every crew member with an expired or expiring-soon credential.
- [ ] Setting a floor of X guarantees the person never ranks below X in any eligible pool,
      regardless of recent score dips.
- [ ] Adding a PTO window removes the person from eligible pools overlapping that window; removing
      it restores them. No positive-availability entry is ever required.
- [ ] A newly added crew member shows neutral/mid-pool standing labeled "no history," not a low
      score.
- [ ] Deactivating a crew member assigned to future shifts surfaces those shifts and reopens the
      seats rather than failing silently.

---

## 2.2 Event Admin

> Source: event-admin.md. The data layer beneath the crew engine — imported events + reservations,
> the thing both the shift builder and the crew manifest read from. A **data-management** surface,
> not a second booking system.

> **⚠️ Reconciled 2026-07-15 (S54), revised 2026-07-26 (S71, DEC-126).** This section was written for a world that no longer exists: the
> **CSV bridge** (retired — DEC-043 killed the `.xlsx` path; ingest is a manual Xola **API pull** at
> `/admin/import`, DEC-036/037), a **2027** customer portal (reservations went live in **2026** —
> DEC-105, Phases 11/12), and **shift locking** (cut — Xola is source of truth, so a "reviewed/locked"
> stamp is meaningless). The paragraphs below are corrected in place; where a claim was load-bearing and
> is now wrong, it says so rather than being quietly deleted. **"Reservation" here means the imported,
> Xola-sourced kind.** Muster-native reservations are a different animal — see
> `docs/design/reservations-model.md`, `reservations-admin.md`, and DEC-105–113 / DEC-123 / DEC-124.

### Purpose
Hold the **imported** events and reservations and be the single data layer the rest of Muster reads —
shift builder reads **events**, crew manifest reads **reservations**. Allow light manual maintenance
between syncs.

**Corrected:** ingest is the **live Xola API pull** (DEC-036/037), not a CSV bridge. **There is no
spreadsheet path at all** — DEC-036/037 kept the `.xlsx` reader as a Xola-downtime fallback, but
**DEC-043 retired it outright** (it can't resolve a boat, and a fallback that collapses four boats into
one event is worse than no fallback). And the customer portal that writes reservations here directly is
**not a 2027 event** — it is **Phase 11/12, now** (DEC-105). The two source-of-write paths coexist
**through the pilot** — Xola-sourced imports alongside Muster-native reservations, discriminated by
`source` (DEC-106) — and then **stop coexisting at the cutover** (DEC-126): one final full import of
Xola's reservations, after which Muster is the reservation source of truth and **the ongoing Xola pull
stops**. This layer stays either way — that part held; only its *upstream* goes away.

*(Revised 2026-07-26, S71 — audit shard C2.2. The S54 wording said the paths "coexist permanently"
and that Xola "drains naturally", which DEC-126 reversed on 2026-07-17. The S56 pass corrected §0.2,
§0.3 and §4 and missed this section, so the file contradicted itself for nine days. Operator position,
confirmed this session: one Xola import once customers can book in Muster, then Muster only — as soon
as `feature/reservations` lands.)*

> **This section has an end date, and that is not a defect.** Everything below describes the
> Xola-sourced pipeline. At the cutover it stops running and this section can be deleted outright —
> the `Event` and `Reservation` tables outlive it as the substrate under the reservations product, but
> the *ingest* does not. Don't invest in surfaces here that the flip will delete; do keep it accurate
> while it's the thing importing every trip on the board.

### States to render
- **Event list** — events grouped by date (and filterable by boat), each showing boat · day · time ·
  capacity, plus reservation count and pax total against capacity.
- **Event detail** — one event with its reservations: each reservation's customer **name, party
  size, phone**. This is the per-event manifest source (name + phone; **waivers not needed for
  crew** — §0.4).
- **Import result** — after an import, what was added / updated / skipped, and any records that
  couldn't be parsed (so a dirty source is visible, not silently dropped).

### Actions
- **Import** events + reservations — the operator-triggered Xola **API pull** at `/admin/import`
  (DEC-036/037), with reconciliation against what's already there (see edge cases). *(Was: CSV upload,
  ~1–2×/week. The pull window is `[today−1, today+lead+1]`. No `.xlsx` fallback — DEC-043 retired it.)*
- ~~**Manually add / cancel a single reservation**~~ · ~~**Manually add / edit an event**~~ —
  **STRUCK by DEC-043.** Its operator trust model is explicit: *"auto-import stays, Xola is the single
  source of truth; a bad boat assignment is fixed **in Xola + 'Pull now'** — no Muster-side
  staging/override."* There is **no Muster-side manual write** to a Xola-sourced event or reservation;
  the odd phone booking is fixed in Xola and re-pulled. *(This is the same reasoning that cut locking —
  you don't hand-edit a projection of someone else's source of truth.)* A **Muster-native** reservation
  is not this section's business at all — it belongs to the reservations purchases surface (DEC-123).
  > **The `cancel` half is coming back (DEC-126 item 4, task 12.14 / #467).** The cutover leaves Muster
  > holding imported bookings it must be able to cancel *in Muster*, with no write back to Xola — "the
  > thing you can't do today". The `add` half stays struck. This does not reopen Muster-side *editing*
  > of a Xola-sourced record; it is one status write that frees the slot. **Sequencing matters:** while
  > the pull still runs, a re-import overwrites `status` straight from the Xola row, so either 12.14
  > ships after the pull is switched off, or it needs a "cancelled in Muster wins" guard. Decide which
  > before building it.
- **Browse** events with their reservations — also how Spink eyeballs the weekend before building
  shifts.

Deliberately **out of scope here:** marketing. **Corrected:** pricing, payment capture, and customer
comms were parked as "Xola's job in 2026 or the portal/payments work later" — that expired with
DEC-105. They are now **Muster's**, but they live in the **reservations** surfaces (per-event price
DEC-112, Stripe DEC-107, the `Offering` catalog DEC-123, tips DEC-124), **not here**. This section stays
what it always was: the **data layer under the crew engine**, not a booking system.

### Data read
- Written by the **Xola API pull** (DEC-036/037/043 — *was: the CSV bridge*) and, for
  `source='muster'` rows, by the **reservations service** (**Phase 11/12, now** — *was: "in 2027, by
  the customer portal"*; DEC-105/106).
- Read by the **shift builder** (§2.3, reads events) and the **crew manifest** on the shift card
  (§2.6, reads reservations grouped per event).

### Edge cases
- **Re-import reconciliation.** A reservation already imported, now changed or cancelled in Xola,
  must update/cancel in place — not duplicate. (Identity on `Reservation ID`, `updatedAt` materiality
  per DEC-029.)
- ~~**Manual entry clobbered by re-import.**~~ — **MOOT (DEC-043).** There are no Muster-side manual
  entries to clobber (see Actions), so there is nothing to merge and no merge rule to write. A
  Muster-native reservation can't collide either: the importer **skips** a Muster-owned vessel-day
  (DEC-106), so the two sources never write the same event.
- **Dirty / partial source.** Unparseable records surface in the import result for Spink to fix by
  hand, rather than failing the whole import or dropping records silently.
- **Event edited after shifts formed.** Changing an event's **time** after its shift was built
  must propagate to the shift. *(Revised 2026-07-26, S71 — audit C2.2-6: this said "time/capacity",
  but capacity propagates to nothing and can't. Seats come from vessel manning — `deriveSeats` takes
  the `Vessel`, never the `Event` — and `Event.capacity` is re-derived from the boat at import, not
  read from Xola. Time propagation, by contrast, is met the strong way: the shift stores no time at
  all, only `eventIds`, so call time and trip times are computed live from the events on every read.
  What is **not** met is telling the crew a retime happened — issue #548.)*
  *(Corrected: the original said this raises a shift-builder "changed
  since you reviewed it" nudge **if locked**. **Locking was cut — DEC-082** ("Locking cut — Xola is
  the source of truth; supersedes SPEC §2.3 Lock, reframes DEC-029"): a reviewed/locked stamp over a
  projection of someone else's source of truth is meaningless. Propagation is unconditional; there is
  no locked state to gate it. **§2.3 below still specs Lock as a live feature — it is superseded by
  DEC-082 wherever it does.**)*
- **Muster-owned vessel-days.** The importer **skips and itemizes** a Xola event landing on a
  vessel-day Muster owns (DEC-106) — the coexistence guard. Inert until a vessel-day is marked owned.

### Acceptance criteria
- [ ] Importing creates events and their reservations, grouped correctly (reservations →
      events by occurrence; events available to roll up → shifts by boat+day).
- [ ] Re-importing with a changed reservation updates it in place; a cancelled one is marked
      cancelled — neither duplicates.
- [ ] ~~A manually-added reservation survives the next import per the merge rule.~~ — **struck**, no
      manual entries (DEC-043).
- [ ] Event detail shows each reservation's name, party size, and phone; no waiver field is required.
- [ ] Unparseable records appear in the import result rather than being silently dropped.
- [ ] Editing an event's time propagates to any shift already formed from it.
- [ ] A Xola event landing on a Muster-owned vessel-day is skipped and itemized, not imported
      (DEC-106).

### Open questions (Event Admin)
- ~~**Merge rule** for manual entries vs re-import~~ — **RESOLVED by DEC-043**, not by Spink/Drew.
  Its trust model removes Muster-side manual writes entirely, so there are no manual entries to
  reconcile. *(Was carried as an open question with a human owner; leaving it open would send someone
  to ask Drew a dead question.)*
- ~~Exact Xola **export columns**~~ — **RESOLVED.** The CSV export is retired (DEC-043). The API
  response shape is settled by **DEC-040**, which supersedes DEC-036's pre-live spike: **no `expand`
  is needed** (`items[]`, item `name`, `arrival*` and `quantity` are inline), **contact is order-level
  and inline — `order.phone`, NOT `organizer.phone`**, and status codes are 200–203 booked / 700
  cancelled. Boat resolution is **DEC-043** (`event.resourceUsages[].resource.id`, events-driven join).
  Field completeness is no longer an open question.

---

## 2.3 Shift Builder

> Source: admin-1. The **bridge between the two halves of the app** — where continuous reservations
> become discrete crewable shifts. Net-new (Xola has no crewing-unit concept). The 2026 import-mode
> and the 2027 live-mode are the **same surface** — only the input source differs (coexistence §4).

> **⚠️ Reconciled 2026-07-15 (S54). LOCK IS CUT — DEC-082** ("Locking cut — Xola is the source of
> truth; **supersedes SPEC §2.3 Lock**, reframes DEC-029"). Everything below that specs a lock state,
> a lock action, a "changed since you reviewed it" nudge, or a bulk "lock the weekend" is **superseded
> and not built**. A reviewed/locked stamp over a projection of someone else's source of truth is
> meaningless: Xola keeps changing the bookings, so there is nothing to freeze. The **build → review**
> reframe survives — shifts still form continuously and Spink still adjusts them — only the *commit*
> step is gone. Asks fire on the **staffing horizon** (DEC-022/062), never on a lock. Split/merge is
> live and is the judgment override (DEC-083/114). The lock text is struck in place rather than
> deleted, so the reasoning stays legible.

### Purpose
Turn the week's events into reviewable ~~, lockable~~ **shifts**. The core reframe is **build →
review**: shifts form **continuously and automatically** as bookings land; the Monday ritual becomes a
**review pass** (adjust ~~+ lock~~), not a build-from-blank-slate. The machine does the grouping; Spink
applies judgment.

> **Fork resolved (builder §1): continuous auto-grouping, not manual build.** There is **no
> blank-slate "build" flow** to design. Proposed shifts already exist on the screen; Spink adjusts
> and locks. This is what makes the autonomous last-minute case (§1.2) work without a manual build
> step.

### Auto-grouping rule
**Same vessel + same day → one candidate shift** (matches "crew work the day"). Large mid-day gaps
*may* raise a "split this?" suggestion, but the default is one-boat-one-day; split/merge is Spink's
judgment override.

### What a shift carries (restated for rendering)
One boat, one day; the trips inside it batched; **required seats derived from COI** (BrewBoat =
1 captain + 1 mate — computed, not hand-entered). *(Correction, DEC-ROLE-1: vessel manning is a
`{roleTypeId, count}` **list** the seat builder iterates — N lines, not a captain/mate pair.)*
*(Correction, DEC-016: the "1 captain + 1 mate" figure is illustrative — the real fleet is 4 boats
needing 2 crew each, and zero-crew rentals are in scope; the count is per-vessel data, 0/1/2/N.)*
Per-shift overrides: add a **required** working
hand (big-pax day — gates `Crewed`); add a **supernumerary/trainee** seat (non-gating, pairing
rule, **consumes a passenger slot** vs COI max-pax). Derived default is the COI minimum.

### States to render
- **Date-range / weekend view, grouped by boat then day.** Each proposed shift is a block showing:
  boat · date · the trips inside (1/3/5pm) with pax totals · required seats (derived) · current
  **crewing-state badge** (Pending / Filling / Crewed / At-Risk).
- ~~**Lock state** per shift — unlocked (system still assembling) vs locked (reviewed, crewing may
  proceed).~~ — **CUT (DEC-082).** There is no lock state. Crewing proceeds on the staffing horizon.
- ~~**"Changed since you reviewed it" nudge** — a locked shift that has absorbed a new/changed booking
  shows this; it is never silently altered.~~ — **CUT (DEC-082):** nothing is "reviewed" in a way a
  change can invalidate. *(The change-cue mechanism that survives is the split/merge re-derivation cue
  — DEC-083/114, not this.)*
- **A freshly spawned proposed shift** — a late booking for a boat/day with no existing shift
  creates one; it appears as a new block needing review.

### Actions
- **Split** a shift (e.g. morning private charter wants different crew than the afternoon public trips).
- **Merge** two proposed shifts.
- **Override seat requirements** — the two cases above (required working hand vs supernumerary).
- ~~**Lock** — commit the shift. Locking is the deliberate hand-off; **inside the staffing horizon it
  fires the asks** (Tier 1). Per-shift, plus a likely **bulk "lock the weekend"** action.~~ — **CUT
  (DEC-082).** No lock, no bulk lock. **Asks fire on the staffing horizon itself** (DEC-022/062), which
  is what removed the need for a hand-off in the first place.

(The CSV **import** action itself lives in Event Admin §2.2; the builder reads the resulting events.
In 2026 the builder simply shows shifts auto-formed from imported events — same as it will from the
live feed in 2027.)

### Lock semantics
- **Before lock:** the shift quietly absorbs incoming bookings — no noise.
- **After lock:** bookings still join, but each change raises a **review nudge** so Spink is never
  blindsided at the dock.
- Lock = "the system was assembling this" → "I've reviewed it and crewing may proceed."

### Data read
- Reads **events** from Event Admin (§2.2) → auto-forms shifts.
- Derives required seats from **COI / vessel manning** (policy data the oracle also uses, §1.3).
- **Writes shifts into the state machine** (§1.1): forming a shift is how it is *born* — into
  `Pending`, or straight into `Filling` if already inside the staffing horizon.

### Edge cases
- **Late booking, shift exists** → slots in automatically, silently. *(DEC-082: the old
  unlocked-vs-locked fork is gone — there was never a second behaviour to pick.)*
- **Late booking, no shift for that boat/day** → spawns a new proposed shift.
- **Event edited upstream** (Event Admin) after a shift formed → propagates unconditionally. *(Was:
  "nudge if locked" — cut, DEC-082.)*
- ~~**Unlocked shift already inside the staffing horizon**~~ → **moot (DEC-082):** every shift inside
  the horizon is worked by the engine; there is no lock to wait on.

### Acceptance criteria
- [ ] Importing/refreshing events produces proposed shifts grouped one-boat-one-day, with required
      seats derived from COI — no manual grouping step.
- [ ] Splitting a shift produces two shifts whose trips partition the original's; merging is the
      inverse.
- [ ] Overriding to add a required hand changes the gate for `Crewed`; adding a supernumerary seat
      does **not** gate `Crewed` and **decrements** available pax against COI max.
- [ ] ~~Locking a shift inside the staffing horizon fires Tier-1 asks; locking one outside does not.~~
      — **struck (DEC-082).** Replaced by: a shift crossing the **staffing horizon** moves
      `Pending → Filling` and fires Tier-1 asks (DEC-022/062).
- [ ] A booking landing on an existing shift joins it silently; a booking for a boat/day with no
      shift spawns a new proposed shift. *(Was: "…raises a review nudge" — cut, DEC-082.)*

### Open questions (Shift Builder)
- ~~**Unlocked shift inside the staffing horizon** — does crewing wait for lock, or start
  provisionally?~~ — **RESOLVED by DEC-082.** The question presumed a lock. There isn't one: crewing
  starts at the horizon, autonomously. The "leaning: crewing waits for lock during rollout so Spink
  stays in control" is the exact posture DEC-082 rejected — Xola keeps changing the bookings, so
  waiting for a human stamp buys nothing and costs the autonomous path.
- Lock granularity — per-shift confirmed; **bulk weekend-lock** likely also. *(Build per-shift
  first.)*
- The "suggest a split" gap threshold — tune later, don't agonize.

---

## 2.4 Assignment View

> Source: admin-2. The per-shift **crewing cockpit** — both a **monitor** (watch the autonomous
> Tiers 1–2) and a **control panel** (take over and drive manually). Reached directly or by clicking
> a shift on the At-Risk board (§2.5).

### Purpose
Where the seats of **one shift** get worked. It must serve two postures without clutter, defaulting
to a calm monitor that exposes controls on demand.

- **Watching (autonomous):** Tiers 1–2 work the seats on their own; Spink sees what the system is
  doing ("asked top 5 mates, 2 declined, waiting on 3") and rarely intervenes. The optional
  **warming view** lives *here* — shifts trending toward risk (horizon approaching, low response)
  but not yet At-Risk. It is opened **deliberately**, and explicitly **does not** live on the
  At-Risk board (which stays pure push/empty — §2.5).
- **Driving (manual):** Spink works it himself (especially captains, where he often knows
  availability) — assigns, nudges, overrides.

### View structure / states to render
- **Shift header:** boat · date · trips (1/3/5pm) · pax totals · overall crewing-state badge
  (Filling / Crewed / At-Risk) · the **fills-by deadline** to the staffing horizon, **rendered "deadline"**
  on the cockpit (DEC-038; the concept stays "fills by" in code/decisions).
- **Seat cards** — one per required seat, each showing its sub-state + occupant:
  **Open** (expands to the eligible pool) · **Asked** (who/when) · **Claimed** (accepted, awaiting
  confirm) · **Confirmed** (name + one-tap contact) · **Bailed** (flips red; auto-reopens & re-asks).
- **Eligible pool** (per open seat) — the oracle's computed pool (§1.3), **ranked by reliability**
  (§1.4). Only legally fillable people appear (credentials valid on date, correct rating, not
  double-booked, not on PTO). Each candidate row: name + reliability indicator (high/med/low or
  ordering is enough) · **ask status: available · asked · in (+reply time) · declined · silent
  (asked, timed out)** · quick actions.
  - **Silent is first-class and visually distinct from declined** — silence is the thing Spink hates
    and the thing the score penalizes; a ghost must be obvious at a glance.

### Actions
- **Broadcast ask** — fire to the whole eligible pool (mate flow / ask-then-assign).
- **Assign a person** — name someone into a seat; they get a confirm/decline ask (captain flow /
  assign-then-confirm).
- **Confirm** — lock a claimant into the seat.
- **Nudge** — direct individual escalation (manual Tier 2).
- **Widen / re-ask** — broaden the pool or re-fire after declines/timeouts.
- **Manual override** — drop anyone into a seat directly. Spink is always the authority;
  last-resort backstop.

In the autonomous posture the system performs broadcast → rank → confirm on its own; these actions
are Spink's manual equivalents for taking over.

> **Fork resolved (assignment §1): contested seat → first-acceptable-yes-wins** for rollout (fast,
> fair, matches Spink's instinct); **best-by-score** is a knob to flip once reliability data is
> trusted. The two mostly agree — they diverge only when a flake answers first.

### Both protocols live here
Same seat cards, same eligible pool; the only difference is whether the ask goes to the crowd first
(**ask-then-assign**, mates) or names someone first (**assign-then-confirm**, captains). Per-role
default with per-person override (the override lives on the roster record, §2.1).

### Data read
- Reads the **shift + seat states** (§1.1), the **escalation/tier activity** (§1.2), the **eligible
  pool** from the oracle (§1.3), the **reliability ordering + reasons** (§1.4), and **roster** detail
  (§2.1). Writes seat-state changes back through the machine.

### Edge cases
- **Bail** → seat card flips red, auto-reopens, re-asks the next candidate (the `Crewed → Filling`
  edge, §1.1).
- **All declined / all silent** → pool exhausts; if also close to the deadline, the shift escalates
  to At-Risk and onto the board (§2.5).
- **Manual override of the automation** — see open question on whether it implicitly pauses the bots.
- **Reliability exposure** — **resolved:** show Spink the ordering plus reasons on demand; no need to
  hide a number from the operator (crew see their own standing too, §1.4).

### Acceptance criteria
- [ ] Each required seat renders its current sub-state and, when Open, an eligible pool ranked by
      reliability containing only legally fillable people.
- [ ] A `silent` candidate is visually distinct from a `declined` one.
- [ ] Broadcasting an ask and a candidate accepting moves the seat
      Open → Asked → Confirmed (auto-confirm, DEC-061; `Claimed` is momentary) and reflects it in
      the shift badge. (Pre-DEC-061 this required a separate Spink confirm.)
- [ ] A confirmed crew bailing flips the seat to Bailed, reopens it, and re-asks the next candidate
      without manual intervention.
- [ ] Manual override places any person into a seat regardless of rank (authority backstop), and the
      fills-by deadline (rendered **"deadline"**, DEC-038) reflects the staffing horizon.

### Open questions (Assignment View)
- Whether the autonomous posture needs an explicit **"pause automation, I've got this"** toggle per
  shift, or whether any manual action implicitly pauses the bots. *(Lean: any manual action pauses;
  confirm in build.)*
- **Bulk actions** across multiple shifts (one weekend broadcast) — partly here, partly on the board.

---

## 2.5 At-Risk Board

> Source: admin-3. The cross-shift **triage worklist** — the shifts the automation couldn't close.
> The **operational payoff Xola structurally cannot produce**: Xola says a booking is paid; this
> says "3 trips this weekend have no crew and you need to move."

### Purpose & design stance
The list of shifts that genuinely need a human — and almost nothing else.

- **Empty is success.** If Tiers 1–2 are working, nothing lands here. An empty board is the system
  doing its job, not a reminder Spink forgot to check.
- **Push, not pull.** A shift reaching the board **pings Spink**; he goes there *when summoned*, he
  does not monitor it. This is the whole point — semi-retired, no babysitting.
- The failure mode to design against is the **anxiety dashboard** where everything glows yellow.
  Keep the bar for landing here **high**.

### What lands on the board (states to render)
- **Uncrewed shifts** — a required seat still empty, by either route: (a) eligibility-exhausted
  (nobody left to ask — boards however far out) or (b) the trip is within the fill deadline (48h),
  **whether or not asks are still in flight** (DEC-065). The core case.
- **Regressions (late bails)** — a `Crewed` shift lost a confirmed crew close to the trip and can't
  auto-refill in time (the 11pm bail). **Distinct regression flag; rockets to the top** — was
  solved, now broken, little time.
- **Credential lapse on assigned crew** — an assigned person's MMC/medical/TWIC will expire before
  the trip date, invalidating the assignment. Surfaces here so it's caught **before the dock**.
- **Empty state** — rendered as success, not as an error/void.
- A shift still being actively worked **and more than the fill deadline (48h) from its trip** does
  not appear — it stays the system's problem in the assignment view. Inside the deadline it boards
  regardless of in-flight asks (DEC-065): a near-term uncrewed shift is the operator's to see, and a
  nudge no longer hides it.

### Urgency model (sort order)
A blend of **time to trip** (sooner = more urgent) · **severity of gap** (missing a **captain** —
small, fickle pool — outranks a **mate**; a **regression** outranks a never-filled seat) ·
**fillability** (how thin the remaining pool is). Most-urgent at top.

### Triage from the list (context without clicking)
Each row carries enough to act without opening it:
- **What's missing** — 1 captain / 1 mate / both.
- **Time to trip.** *(The fills-by/horizon deadline is **not** shown on the board — it lives on the
  cockpit only. DEC-038. A board row no longer implies the automation has given up: within the
  deadline a still-worked uncrewed shift boards too, DEC-065.)*
- **Escalation transparency** — proof the system tried: "asked 6 mates · 4 declined · 2 silent ·
  pool widened · nudged Bob · exhausted." So Spink trusts it gave up for real reasons, not laziness.
- **Who's still theoretically available** (if anyone) for a manual lean.

Deep work happens in the assignment view (§2.4) — clicking a row drops Spink into that workbench.

### The decision surface: lean / reschedule / cancel
Make the three real options first-class — especially the painful ones, since this is the 11pm call:
- **Lean** — direct nudge to a specific high-value person ("I need you on this"). Manual Tier-2.
- **Reschedule** — move the trip to a slot that *can* be crewed. Triggers customer-facing comms.
- **Cancel** — kill the shift. **This cascades** (notify customers, refund per policy, optionally
  offer reschedule). Cancel is never "delete the shift" — it has customer + payment fallout (the
  cancel-cascade flow, §3).

The board should make cancel/reschedule **easy and informed** — that's the decision that currently
keeps Spink up at night.

### Data read
- Reads shifts in **At-Risk** (and regressed) state (§1.1), the **escalation log** (§1.2), **roster
  + credential** data (§2.1, for lapses and for who's available). The **cancel** action invokes the
  cancel-cascade flow (§3), which reads refund policy and writes customer comms + booking/shift state.

### Edge cases
- **Regression channel** — given the 11pm timing, a regression may warrant a louder channel than a
  normal in-app ping (e.g. SMS to Spink). *(Open, §3 notifications.)*
- **Warming / trending-toward-risk** — **explicitly not here** (would reopen the anxiety-dashboard
  door). It lives on the assignment view's monitor posture (§2.4), opened deliberately.
- **"Exhausted" threshold** — how many declines / how close to horizon before a shift lands here is
  tunable; keep it high. *(Open, don't agonize.)*

### Acceptance criteria
- [ ] A shift appears on the board only after Tiers 1–2 exhaust (or a regression/credential-lapse
      occurs) — not while still being actively worked.
- [ ] Regressions render with a distinct flag and sort above never-filled at-risk shifts of similar
      time-to-trip.
- [ ] Each row shows what's missing, time to trip, and the escalation trail — enough to triage
      without opening it.
- [ ] An empty board renders as a success state, and the board does not show "warming" shifts.
- [ ] Cancel triggers the cancel-cascade (§3) across every booking on the shift, not a silent delete.
- [ ] Clicking a row opens that shift's assignment view (§2.4).

---

## 2.6 Crew App

> Source: crew-app-surface (+ the per-event manifest reconciliation from event-admin §1, folded in
> here). Design stance: **insultingly small.** The failure mode is not missing features — it is
> **friction and stale info.** Every screen added is a place for bullshit to hide. The crew member's
> entire world is three surfaces. (Native vs PWA is parked, §4.)

### 2.6.1 The ask
Arrives as **push / SMS**, answerable **without opening anything**:

> *Sat Jul 18 · BrewBoat · mate · call 12:30, back ~6. In or out?*

- **Two buttons. ~3 seconds. No login, no navigate-to-respond.** If accepting is harder than
  replying to a text, it has already failed (the Xola lesson).
- **Magic-link auth, no passwords** (§3.2) — casual crew won't manage credentials; a forgotten
  password is a ghosted shift.

### 2.6.2 My shifts
The home screen if they open the app: a short list of **confirmed upcoming** shifts, one card each,
past stuff hidden. Plus the crew member's **own reliability standing** (individual, not comparative —
§1.4). That's all. **Empty state** (no upcoming shifts) is normal, not an error.

### 2.6.3 The shift card — single source of truth
Everything needed on one screen, no hunting. This is where "bulletproof" lives.

- **Call time, distinct from departure time** — crew need when to *show up*, which is not the
  customer's departure. The #1 source of dock confusion. Show both, **labeled clearly**.
- **Dock as a tappable map pin**, not a copy-paste address.
- Boat, trip type, pax count.
- **Who else is crewing, with one-tap contact** — kills "I'm running late, who do I call."
- **Manifest — grouped per event.** A mate on the Saturday shift needs the 1pm, 3pm, and 5pm guest
  lists separately, because different customers are on each event. Each shows **name + count/phone**;
  **waivers are not shown** (not needed for crew, §0.4). *This is the hinge that ends the Xola split
  (§3.5) — pull it early.*
- Notes.
- *(Later)* the day-cohort message thread hangs off this card (parked, §4).

### The three bulletproofing principles (the load-bearing behavior)
1. **The card is authoritative and live.** Departure changes → card changes → crew gets a ping
   (§3.1). Never "check your email for the update." The entire value is that the app is the *one
   known place*; the moment info splits across channels, you're back to Xola.
2. **Bailing is as easy as accepting.** If "I can't make it" is a guilt-trip wall, crew ghost
   instead and you find out at the dock. A frictionless decline that *immediately re-asks the next
   person* beats a hard one that produces no-shows — this is exactly the `Crewed → Filling` edge
   (§1.1).
3. **The app watches their credentials for them.** Quietly nudge the crew member when their own
   MMC / medical / TWIC nears expiry — *before* it drops them from the eligible pool. Turns a
   compliance landmine into a gentle heads-up and keeps the pool healthy without Spink tracking
   everyone's paperwork in his head.

### States to render
- **The ask** (in/out, answerable from the notification itself).
- **Confirmed-shifts list** + own reliability standing; empty state.
- **Shift card** with all fields above, a **live-updated** indicator when something changed since
  last viewed, and the per-event manifest.
- **Bail action + confirmation.**
- **Credential nudge** (expiring-soon).
- **"Seat already filled"** acknowledgement (a contested yes that lost — first-yes-wins, §1.2/§2.4).

### Actions
- **Accept / decline an ask** (from notification or in-app).
- **Bail** on a confirmed shift (frictionless; triggers re-ask).
- Tap the **dock pin**; **one-tap contact** co-crew.
- See the **credential nudge**; see **own standing + reasons**.

### Data read
- Shift card reads **shift/seat state** (§1.1), the **manifest** from Event Admin reservations
  grouped per event (§2.2), and **co-crew contact** from the roster (§2.1).
- Reads the crew member's **own reliability standing** (§1.4) and **credential expiries** (§2.1).

### Edge cases
- **Accept a seat that just filled** (contested, first-yes-wins) → clear "this one's taken" message,
  no error state.
- **Bail** → seat reopens and re-asks next candidate immediately (§1.1); the bailer's card drops off
  their list.
- **Departure/detail change** on a confirmed shift → card updates + ping; never silent.
- **Magic link** expired/reused → graceful re-request, not a dead end (§3.2).

### Acceptance criteria
- [ ] An ask is fully answerable (in/out) from the push/SMS without opening or logging into the app.
- [ ] The shift card shows call time and departure time as **distinct, labeled** fields.
- [ ] The shift card shows the manifest **grouped per event** (separate 1/3/5pm lists), name + count,
      no waiver field.
- [ ] Changing a shift's departure updates every assigned crew member's card and pushes a ping.
- [ ] Bailing reopens the seat and re-asks the next candidate with no operator action.
- [ ] A crew member sees only their own standing and reasons — never a ranking against other crew.
- [ ] A credential nearing expiry triggers a crew-facing nudge before the person drops from the pool.

---

## 2.7 Crew Self-Serve — "Pick your shifts" (the crew pull surface)

> **Stance:** a fourth crew surface, added as a knowing exception to §2.6's "three surfaces" (DEC-074) —
> a *restoration* of the self-pick workflow mates always loved. It is **pull, opt-in, anti-anxiety**
> (DEC-042 guardrails) and is **not** the parked positive-availability calendar (§4): crew claim
> concrete, already-formed shifts, never declare abstract availability.

**2.7.1 The list.** Open **required** seats the viewer is **eligible** for (credentials valid on the
trip date + native role per DEC-076 + not suppressed, §1.3), on shifts in `Pending`/`Filling`, within
`[today, today+45d]`. Default filter **today**; presets **this weekend** / from–to range. One row per
claimable seat: **date · vessel · role · committed window (call → back) · Claim**. No auto-refresh, no
live counts, neutral ink (DEC-042). Empty = normal, not an error.

**2.7.2 The claim.** One tap → confirm sheet stating the **whole-day** scope, the **live trip count**,
and the **call/back window** (DEC-077 copy). Confirm → seat `Open → Confirmed` (auto-lock, DEC-075). The
seat now appears in **My shifts** (§2.6.2). Guarded against races and the one-shift-per-date conflict
(DEC-078).

**2.7.3 Release.** Releasing a self-claimed seat is as easy as claiming it (§2.6 principle 2): seat
returns to `Open` and re-asks; a reliability event is recorded, lead-time-weighted (§1.4).

**2.7.4 What this surface is NOT (Phase 7 non-goals).** No sub-day blocks/"watches" (whole-day only,
DEC-077). No multi-role / role-picker (native-role-only; dual-rating is the operator-assign hack,
DEC-076). No supernumerary self-claim. No operator-confirm gate (auto-lock; the confirm-required mode is
a dormant `app_settings` seam, DEC-075). No availability calendar (§4).

**2.7.5 Relationship to the cascade.** Pull and push **coexist**. Self-claim front-loads fills
(especially mates) during `Pending`/early `Filling`; whatever's still `Open` at the staffing horizon
flows into the existing ask cascade (§1.2) — which remains the primary captain-fill tool. The two never
conflict: both end at a `Confirmed` seat via the same state machine.

---

# 3. Cross-cutting

Behavior that spans surfaces. **Payments appears here only where it surfaces inside the admin app**
(the cancel flow and the dispute alert). Deposit-vs-full, refund-schedule numbers, and the Stripe
integration internals are parked (§4) — they are Drew's decisions and build-phase plumbing.

## 3.1 Notifications & push

The system mediates every interaction, so notifications are the nervous system — and the thing that
keeps info from going stale across channels.

- **The ask** → to crew, **port-mediated**, answerable without opening the app (§2.6.1). Transport is
  a swappable adapter (DEC-MSG-3): fake + pilot (web-link or Telegram) at M4, **SMS the eventual
  production adapter** — see DEC-MSG-1.
- **Live card updates** → to assigned crew, when a shift's details change (§2.6, principle 1).
- **Credential nudges** → to crew, before expiry (§2.6, principle 3 / §2.1).
- **At-Risk ping** → to Spink, **push not pull**: a shift reaching the board summons him; he does not
  monitor a dashboard (§2.5).
- **Regression ping** → to Spink, possibly a **louder channel** (SMS) than a normal at-risk item,
  given the 11pm timing. *(Open — §3 below.)*
- **Acknowledgment signal** → captured for the score (§1.4). Prefer **passive** (crew opened the live
  card within ~24h of call time) over an explicit tap; explicit one-tap "still good" is the fallback.

The deeper reason this matters: notification-channel **reliability** is the real question behind
native-vs-PWA — "does the ask actually arrive" outranks "does it feel like an app." **Resolved
post-lock:** the **channel port** is the spine — one `sendAsk`/`recordReply` the ask logic depends
on, with the transport injected as an adapter (DEC-MSG-3); SMS is the eventual production adapter
that guarantees arrival (DEC-MSG-1), not the slice. Native (Capacitor, both platforms) is a
de-prioritized fast-follow whose only job is reliable push, never the participation path (DEC-MSG-2).

> **REQ-CLAIM-1 — atomic first-come claim in the domain, behind the port.** *(Code clarification of
> existing behavior, recorded under the lock rule — not new design scope; no version bump.)*
> First-acceptable-yes-wins (§1.2, §2.4) is a **concurrency** problem: when two crew accept the same
> offered seat in the same window, replies arrive in parallel. Every adapter funnels into the one
> inbound `recordReply` (DEC-MSG-3), so the claim is enforced **once, in the domain** — never inside a
> transport adapter. It must resolve **atomically**: confirm **exactly one** person, cleanly tell the
> other "seat already filled" (the §2.6 contested-yes state). Enforce at the data layer — a
> conditional/transactional update that succeeds only while the seat is `Open`, a row lock, or a
> unique constraint on seat assignment; never read-then-write without the atomic guard. Identical
> across fake, web-link, Telegram, and Twilio adapters — and provable with the fake adapter alone
> (call `recordReply` twice in parallel, assert a single occupant). *(Phase: M4.)*

## 3.2 Authentication

- **Crew: passwordless.** Casual crew will not manage credentials; a forgotten password is a ghosted
  shift (§2.6.1). Two passwordless entries (**DEC-081**, refining the original magic-link-only plan):
  operator-relayed **action links** (magic links) drop crew straight onto the relevant card/ask; a crew
  member opening the app **on their own initiative** signs in with a **6-digit code emailed to their
  roster email**. One login primitive — *a login is always a code; a link is only ever an addressed
  deep-link, never a bare login*.
- **Crew do not self-register.** Roster records are operator-created (§2.1); passwordless entry is for
  *responding, viewing, and self-serve sign-in*, never signup.
- **Admin (Spink): a real authenticated login.** Lower-stakes to specify (one trusted operator);
  the load-bearing decision is the crew side. Exact admin auth mechanism is a build-phase detail.

## 3.3 The cancel cascade (admin-facing)

When Spink cancels a shift from the At-Risk board (§2.5), **cancel is never "delete the shift"** —
it is a fan-out of money + comms across every booking the shift carried. For **each booking**:

1. **Compute the refund** via policy — `refund_owed = policy(who_cancelled, when_cancelled,
   amount_paid, trip_terms)`. A **function, not a hardcoded rule** (same policy/mechanism philosophy
   as the oracle), tenant-configurable.
2. **Operator-initiated cancel** (this is always the at-risk case — Spink couldn't crew it) →
   **principled default = full refund.** Every crew-shortage cancellation costs real money — which is
   itself the incentive for the crew engine to work and keep the board empty.
3. **Offer rebook / credit *first*** where appropriate ("rebook or refund?"), with **full cash refund
   always available** — credit retains the customer and is cheaper, but never forced.
4. **Issue** the refund/credit (via Stripe — wiring is build-phase), **notify** the customer (reason +
   refund/credit details), and **update** booking + shift state to `Cancelled` (§1.1).

> The customer-initiated cancel branch (policy scales the refund by how far out they cancel) belongs
> to the customer portal, which is parked (§4). The **admin cancel flow above is in scope** because
> it's the 11pm decision Spink makes from the board.

**States to render:** the cancel confirmation showing, per booking on the shift, the computed
refund/credit and the rebook-vs-refund choice; a summary of what will be sent. **Acceptance:** a
cancel produces a refund-or-credit decision and a customer notification for *every* booking, and sets
the shift to `Cancelled` — no booking is silently dropped.

## 3.4 Dispute / chargeback surfacing (admin-facing)

Stripe disputes must **surface in the admin app**, not rot in the Stripe dashboard:

- A dispute creates an **admin alert** with the booking, customer, amount, and **Stripe's deadline**.
- Spink can **attach evidence** (waiver on file, comms log, completed-trip record) from inside the app.
- **Goal:** never miss a dispute window because it was buried in a Stripe email.

**Acceptance:** an incoming Stripe dispute webhook creates a dated admin alert with the deadline
visible; Spink can attach evidence without leaving Muster. (Webhook wiring is build-phase.)

## 3.5 The Xola write-back sheet (2026 only — disposable)

A 2026 coexistence mechanic (coexistence §3). Because the guest manifest lives in Xola in 2026, crew
must be assigned as **guides in Xola** so they can see their guests — and that write-back is **manual,
not an API** (the API bolt-on is killed, §4). To make it painless, **Muster emits a weekend "enter
these in Xola" sheet**: boat · trip · time · captain · mate, so Spink keys from one list instead of
cross-referencing two screens (~10 min/week at BrewBoat volume).

- **In scope for 2026:** Muster generating that sheet from the ~~locked~~ **crewed** shifts. *(Lock
  cut — DEC-082; the sheet reads a shift's confirmed crew, which never depended on a lock.)*
- **This is explicitly temporary.** The day the crew-facing **manifest on the shift card** (§2.6.3)
  is live, crew stop needing Xola and this sheet retires. That manifest is the **hinge** that ends
  the split — which is why §2.6.3 says pull it early.

---

# 4. Parked — deliberately deferred, not reopened

These are inherited deferrals (§0.2). Listed so they're visible and owned — **not** to be designed
now. Building any of these is out of scope until its trigger condition is met.

### Deferred features (build later, by plan)
- ~~**Customer portal** — Tier 4, off-season 26/27 → 2027 launch. Sketch only
  (customer-portal-sketch); Not on the 2026 critical path because reservations arrive via CSV.~~ —
  **NO LONGER DEFERRED. Reopened by DEC-105 (2026-07-11)** and **in build now**: Phase 11 (service
  layer + one real paid booking) and Phase 12 (the real customer UI + flipping new sales). Not a 2027
  launch, not a cutover — Muster sells **alongside** Xola and Xola's forward book drains. *(The one
  part that held: "Xola's screens are the pattern source" — they are, and were enumerated for the
  admin side in `docs/design/reservations-admin.md`. See also `reservations-model.md` and
  DEC-105–113 / DEC-123 / DEC-124.)*
- **Day-cohort messaging** — future; same messaging substrate as the crew ask, different audience
  selector + timing.
- **AI captain-phone-call agent** ★ — real and useful for won't-text captains, but phase-B garnish.
- **Bulk actions** — weekend-lock (builder), cross-shift broadcast (assignment/board). Build the
  single-item versions first.
- **Progressive crew commitment (soft-hold + staged horizons)** ⏳ — bank crew *willingness* early
  via a tentative **soft-hold** ("hold this Saturday 11–9; confirmed 5 days out"), converging on the
  existing hard staffing horizon that commits real bodies. Reduces operator anxiety by locking in
  willingness weeks out without committing anyone prematurely. Reserved primitives are already noted
  in §1.1 (a `Held` seat tier) and §1.3 (staffing horizon as a list of checkpoints), plus the
  `Ask.type` / `Ask.decisionBy` fields in the build plan. **Mid-size thickening pass; rides existing
  rails (asks, seats, horizons, reliability events) — not a new subsystem.** A soft-hold released at
  its decision deadline is a costly reliability event; released early is cheap (same lateness logic
  as a bail, §1.4).
  > **GUARDRAIL — the knife-edge against the Xola trap (state-machine §9).** The soft-hold must stay
  > **system-initiated, shift-specific, and expiring** ("hold *this* Saturday, decide by Tuesday").
  > It must **never** drift into a crew-maintained, standing **positive-availability calendar**
  > ("set the hours you're generally free") — that is the exact thing the product killed. Same data
  > could back both shapes; only the system-initiated, per-shift, expiring one is correct. If a "set
  > your availability" screen the crew tend ever appears, the feature has failed.
- **Year-end reliability report (operator-judged bonuses)** ⏳ — a per-crew reliability *summary* for
  any period — the **receipts** the operator otherwise holds fuzzily in his head ("showed 8/8 ·
  answered fastest · rescued two at-risk Saturdays · one late bail in May · held-and-finished 6").
  Its purpose is to **arm the operator's judgment when awarding year-end monetary bonuses** — a
  read-only report he reviews, then assigns bonuses himself, weighing it alongside everything the
  algorithm can't see. Far downstream: needs a mature score (post Pass A) and is strengthened by the
  hold feature above. This is the killer *capability* (reliability made **legible** — captured as
  data, not vibes) put to a downstream use; keep the legibility as the prize, not the bonus.
  > **GUARDRAIL — Goodhart. The score arms judgment; it never signs the check.** The system **never
  > awards bonuses automatically** and the reliability number is **never wired directly to a payout.**
  > The instant real money keys off the number it stops being a ranking you can only game by being
  > reliable and becomes a target people contest and demand the formula for — dragging in the
  > appeals / weights / fairness machinery deliberately deferred (§1.4, §1.5). It would also silently
  > reverse two foundational decisions — the score is *ranking, not a grade*, and visibility is
  > *individual, not comparative* (§1.4) — since a bonus pool is inherently both. This is simply the
  > operator-authority principle (§1.4 manual thumb / reliability §7) applied to money: the algorithm
  > governs ask-order; the human awards the pay. The report **informs**; the operator **decides**.

### Owner decisions (Drew / Spink — not Claude's to set)
- ~~**Deposit vs full payment** at booking — Drew. (Recommendation: full upfront for v1.)~~
  **DECIDED: deposit + balance** (DEC-107, 2026-07-11) — the operator chose it over full-upfront as
  the closer match to Xola. The recommendation above was not taken.
- **Refund schedule numbers** (the partial-refund tiers) — Drew. *(Still open — #472; DEC-135 notes the
  refund policy does not exist yet, which is what blocks self-service cancel.)*
- **Credit-vs-cash default ordering** in the cancel flow — lean credit-first, cash always available;
  confirm with Drew. *(Still open — §3.3 refund cascade is parked by DEC-107.)*
- ~~**Balance-capture timing** if deposits are used (tie to a horizon?).~~
  **DECIDED: on demand** (DEC-107 amendment, 11.2b) — a re-minted Stripe Checkout URL is the balance
  link. The auto-emit scheduler that would read `balanceDueDaysBeforeEvent` is deferred to P12+.
- **Which "M" rules** ship as soft/warn vs omitted for BrewBoat v1 (TWIC, medical, drug consortium,
  duty-hour, weather/tide) — Spink/Drew against real operations.

### Tuning knobs (ship a dumb default, tune against real data)
- **Concrete horizon values** — how many days is the "staffing horizon"? (Per-rule setting; needs
  defaults.)
- **Reliability weights** — bail-lateness penalty curve, ack weight, decay. Flat v1; tune later.
- **Two-axis reliability split** (separate responsiveness vs dependability) — blend for v1.
- **"Exhausted" threshold** for landing on the At-Risk board; **split-suggestion** gap threshold.
- **Matching algorithm** inside the crew composite rule — greedy-by-score to start.
- ~~**Event Admin merge rule** — precise reconciliation of manual entries vs re-import.~~ —
  **RESOLVED by DEC-043**: no Muster-side manual writes, so there are no manual entries to reconcile
  (§2.2).

### Infrastructure-stage decisions
- **Native app vs PWA** for the crew app — decided once all requirements are in; the real question is
  push reliability (§3.1).
- **Historical Xola data** — migrate 2024/25/26 reservations, or leave Xola as read-only archive.
  Leaning **archive**.

### Explicitly killed — do not revive
- **The Xola API bolt-on.** A live API integration is a maintained dependency on a system with an
  ~18-month kill date. The one-way CSV import + manual guide write-back (§3.5) replaces it on purpose.
  Different thing from the CSV bridge; do not conflate.
  > **Correction (DEC-036, 2026-06-15):** the *reliability* premise above was wrong — a working,
  > tested Xola client (`xola-tip-extractor`) falsifies "hard to extract from" (that pessimism
  > traced to faulty crewbook info). The API is **revived as a read-only import Land adapter** behind
  > the existing Map/Reconcile, replacing the manual export+upload. The kill-date / disposability
  > point stands and now *licenses* the swap. The manual guide write-back sheet (§3.5) is unaffected.
  > See DEC-036.
  > **Further corrected (S54 2026-07-15, revised S56 2026-07-17):** the CSV import this entry calls the
  > replacement is itself **retired** (DEC-043 — it can't resolve a boat), so the API pull is not an
  > alternative to the CSV path, it *is* the path. And the adapter does **not** die "in 2027": the pull runs
  > through the pilot coexistence and **stops at the DEC-126 cutover** (a one-time full import of Xola's
  > reservations into Muster), after which Muster owns reservations and there is no recurring pull. *(This
  > revises the S54 "coexistence is permanent, not a dated cutover" note — DEC-126 adds the cutover; it's
  > event-driven, not calendar-dated.)*

---

*End of v1. This document is the buildable source of truth; mocks (Claude Design) and code (Claude
Code) derive from it. Changes discovered downstream edit these words first.*
