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
| **Crew** | A person who can fill seats — captain and/or mate, by rating. Also a **session kind** (see *Admin*) — the word carries both meanings, deliberately. |
| **Admin** | The **system** authorization concept, and one of exactly **two session kinds** (`crew` \| `admin`). Since DEC-092 an admin is a row in `admins` keyed by that person's **crew id** — so **every admin is also crew**, and `kind` is what disambiguates which hat they're wearing. There are **no roles and no permissions matrix**: all admins are equal. Per-person revoke is `active=false`. *(Granular roles are a someday/multi-tenant concern; `0018` leaves the `role` column as the clean seam. Until then: two kinds, that's the whole model.)* |
| **Operator** | The **business** role — the human who runs the operation (Spink; sometimes Drew). **Not a system entity, and not a synonym for admin.** An operator is a person; an admin is a session kind. Beware `OPERATOR_CREW_MEMBER_ID`, which is about neither — it names the *crew* persona the office posts messages as (DEC-030 §7). |
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

## 1.3 The availability oracle

One authoritative function; everything queries it, nobody computes availability independently.
A **rule engine** (synchronous "may I?" evaluator) — explicitly *not* an event engine.

### Policy / mechanism split
- **Policy** = the rules. Tenant-owned data/config.
- **Mechanism** = the generic engine that runs them.

### Rule contract
Every rule `reads` a slice of state and `returns { passed, severity, reason, ruleId }`:
- `severity`: **hard** (blocks) or **soft** (warns; tenant can downgrade a rule to warn-only).
- `reason`: **structured payload, not a sentence** — the admin views need the detail (especially
  the crew group's per-candidate failure reasons).

### Evaluation mode (a caller-supplied parameter, one code path)
- `first-fail` — bail on first hard failure. Customer booking flow, "open slots" view.
- `collect-all` — evaluate everything, return all failures. Admin reschedule screen ("no captain
  **and** vessel in haul-out").

### Two horizons (per-rule setting)
A rule outside its horizon does not fail — it **abstains** (`deferred` / not-yet-evaluated). The
verdict vocabulary is **pass / fail / deferred**, never pass/fail/maybe.
- **Booking horizon** — knowable far out, gates the sale. Property rules vote here.
- **Staffing horizon** — N days before the trip, when humans get committed. Crew rules vote here.

> **⏳ RESERVED (v0.2 — not v1): the staffing horizon may be *staged*.** v1 has one staffing
> horizon (a single threshold where crew rules wake up and humans get committed). Progressive
> commitment (§4 parked) generalizes this to an **ordered list of checkpoints** — earlier *soft*
> horizons that bank tentative willingness, converging on the existing *hard* horizon that commits
> real bodies. Model the staffing horizon as a list-of-one, not a scalar, so adding earlier
> checkpoints later isn't a retrofit.

`Deferred` is first-class: it makes a booking *provisional* and feeds the admin worklist ("N trips
booked inside the staffing window, no crew assigned") — the operational view Xola cannot produce.

### The crew satisfiability finding (the most important architectural point)
Crew rules are **not independent booleans**. Evaluated separately they lie: Captain A is free but
his MMC lapsed; Captain B is current but already booked — every rule passes about a *different
person*, so the naive shape returns a false yes. The crew cluster is therefore **one composite
rule** solving a satisfiability problem over a shared human pool: *is there an assignment of real
people to every required seat such that each is simultaneously available, not double-booked, and
credential-valid on the trip date?* It returns "yes, here's a valid assignment" or "no, here's why
each candidate failed" — hence the structured `reason`.

- **Property rules** stay clean independent booleans.
- **Crew rules collapse into the one composite rule.**
- The full solve only runs **inside the staffing horizon**; outside it the crew group abstains and
  at most does a cheap "could this ever plausibly be crewed" sanity check. Two horizons, two levels
  of rigor.

### The oracle evaluates a hypothetical world
Relational rules (turnaround buffer, double-booking) read *neighboring* bookings and can fail
because the new trip would crowd an existing one. The oracle evaluates **the world as it would be
if this booking existed**, not the world as it is.

### Verdict object (sketch)
```
Verdict {
  bookable: boolean          // hard rules all passed (or deferred)
  status: 'pass' | 'fail' | 'deferred'
  failures: RuleResult[]     // populated per mode; structured reasons
  deferred: RuleResult[]     // rules abstaining until their horizon
  recheckBy?: date           // earliest horizon among deferred rules
}
```

### Rule list (verdicts)
Property rules (booking horizon): vessel not double-booked · COI valid on date · pax ≤ COI max
(**supernumerary crew count against this**) · not in maintenance/haul-out · lead-time cutoff · min/max
pax · within season · within daily hours · blackout dates · turnaround buffer (relational). Crew
rules (staffing horizon, composite): qualified captain available & not booked elsewhere · captain
MMC valid on date · minimum manning met · crew not double-booked same slot · crew marked available
(not PTO). Tenant-configurable soft/"M" rules (ship as warn-only or omit for BrewBoat v1): fuel/
cleaning turnaround · TWIC · medical cert · drug-testing consortium · duty-hour/rest · daylight/tide
window · weather/small-craft-advisory. **Not the oracle's job ("N"):** waiver (check-in gate),
payment (booking flow), coupon (pricing), customer standing (risk). The filter: *knowable fact vs.
judgment* — hard knowable facts are clean rules; judgments and things that change after booking
drift to soft or get kicked out.

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

> **⚠️ Reconciled 2026-07-15 (S54).** This section was written for a world that no longer exists: the
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
**not a 2027 event** — it is **Phase 11/12, now** (DEC-105). Both source-of-write paths coexist
permanently: Xola-sourced imports drain as Xola drains, Muster-native reservations arrive alongside
them, discriminated by `source` (DEC-106). This layer stays either way — that part held.

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
- **Event edited after shifts formed.** Changing an event's time/capacity after its shift was built
  must propagate to the shift. *(Corrected: the original said this raises a shift-builder "changed
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
> become discrete crewable shifts. Net-new (Xola has no crewing-unit concept). The builder is
> **source-agnostic** — the imported-Xola mode and the Muster-native mode are the *same surface*, only
> the input differs. *(Correction, DEC-126: this is a **cutover, not permanent coexistence** — at the
> cutover the Xola API pull **stops** and the import mode ceases to exist. There is no "2027 live-mode"
> arriving on a calendar date; see §0.3, which was rewritten away from that framing.)*

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
*(Scope of that claim, verified 2026-07-26: zero-crew is in scope **for the deriver** — an empty
`manning` list yields zero seats and a vacuously `Crewed` shift, tested — but is **excluded at ingest**,
where both self-captained Duffy resources sit in `EXCLUDED_RESOURCES`. So no zero-crew vessel-day forms
in production today. The exclusion is deliberate, not a bug.)*
Per-shift overrides: add a **required** working
hand (big-pax day — gates `Crewed`); add a **supernumerary/trainee** seat (non-gating, pairing
rule, **consumes a passenger slot** vs COI max-pax). Derived default is the COI minimum.
*(Clarification, operator input 2026-07-27: "consumes a passenger slot" is not a rule about trainees.
**COI max-pax counts people** — a trainee, a guest and a working hand are identical to it; if they have
a heartbeat they count. The supernumerary seat is not a special case, it is an instance.)*
*(Status, 2026-07-27: **supernumerary seats are withdrawn from the UI.** The seat machinery is retained
in the domain layer — the `supernumerary` seat kind, `manning.ts`, the ask loop's `trainee_seat` guard,
payroll's unpaid-ride rule — but `ManningSection` has no caller, so there is no operator path to add
either override seat kind today. Dead, not deleted.)*

### States to render
- **Date-range / weekend view, ~~grouped by boat then day~~ grouped by *day* then boat.** *(Correction,
  DEC-085/086: the shipped board renders one section per date and carries boat identity by per-vessel
  hue + vessel name on the row, not by grouping. Day-first matches the weekend review rhythm, #122.)*
  Each proposed shift is a block showing:
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

(The ~~CSV~~ **import** action itself lives in Event Admin §2.2; the builder reads the resulting events.
The builder simply shows shifts auto-formed from imported events — same as it will from Muster-native
ones. *(Corrections: DEC-043 retired the `.xlsx`/CSV upload — it can't resolve a boat — so the ingest is
a manual Xola **API pull**. And per DEC-126 the import path ends at the **cutover**, not at a 2027 live
feed; see the header note.)*)

### ~~Lock semantics~~ — **CUT (DEC-082)**
*This subsection was missed by the 2026-07-15 reconciliation pass that struck its neighbours, and until
2026-07-26 it was the last live description of shift lock anywhere in the project. Lock is gone in code
too: the `locked_at` column is dropped by migration `0022`, `src/builder/lock.ts` is deleted, and
`USER_STORIES.md` SP-6/SP-7 are struck. Struck in place, per this section's convention.*
- ~~**Before lock:** the shift quietly absorbs incoming bookings — no noise.~~ — this is now simply
  **the** behavior, unconditionally (see Edge cases).
- ~~**After lock:** bookings still join, but each change raises a **review nudge** so Spink is never
  blindsided at the dock.~~ — **CUT.** Nothing is "reviewed" in a way a change can invalidate.
- ~~Lock = "the system was assembling this" → "I've reviewed it and crewing may proceed."~~ — **CUT.**
  Crewing proceeds on the staffing horizon (DEC-022/062), never on a hand-off.

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
- [ ] Splitting a shift partitions the vessel-day's trips across two shifts at the chosen cut; merging
      is the inverse. *(Precision, DEC-083: the partition is re-derived from the vessel-day's **live**
      scheduled trips on every pull, not frozen from the original's trip set — which is what lets a new
      Xola trip auto-land on the correct side and a cancelled one land on neither. So after any booking
      change the two sides' union is deliberately **not** the original's set.)*
- [ ] Overriding to add a required hand changes the gate for `Crewed`; adding a supernumerary seat
      does **not** gate `Crewed` and **decrements** available pax against COI max.
      *(Verdict 2026-07-26/27: **first clause met in the domain layer, second clause unreachable.**
      Gating is implemented and tested. The pax decrement is not implemented anywhere — and does not
      need to be while the seats are withdrawn from the UI, since nothing can create one. Revisit
      together with any decision to restore the manning surface: at that point max-pax must count every
      body aboard, not just guests.)*
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
- ~~Lock granularity — per-shift confirmed; **bulk weekend-lock** likely also. *(Build per-shift
  first.)*~~ — **RESOLVED by DEC-082,** which cut both by name (8.2b per-shift lock and 8.6 bulk
  weekend-lock, "formally cut, not completed"). The question presumed a lock; there isn't one.
- ~~The "suggest a split" gap threshold — tune later, don't agonize.~~ — **RESOLVED and shipped,** with
  more than the question asked for: `suggestSplit` has two independent triggers, `large-gap` (dead time
  between one trip's teardown and the next's prep) and `long-span` (a long day with no single big gap),
  each with its own env knob in the DEC-062 pattern (`SPLIT_SUGGEST_GAP_MINUTES` 120,
  `SPLIT_SUGGEST_SPAN_MINUTES` 600), 14 tests including both threshold boundaries, surfaced per-row plus
  a "split candidates only" board filter.

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
- **Shift header:** boat · date · trips (1/3/5pm) · **per-trip** pax chips · overall crewing-state
  badge (Filling / Crewed / At-Risk) · the **fills-by deadline**, **rendered "deadline"** on the
  cockpit (DEC-038; the concept stays "fills by" in code/decisions).
  *(Correction: the deadline anchors to **departure − 48h** (DEC-031), **not** to the staffing horizon
  (departure − 7d, DEC-022/062). These are two instants five days apart and the cockpit renders both,
  stacked — `staffing starts:` then `deadline:`. DEC-027 §4 pulled them apart in as many words: "the
  staffing horizon is when asks start, not a fill deadline." The doc absorbed DEC-038's **label** change
  and kept the wrong **anchor**.)*
  *(Correction: the aggregate "aboard total" is computed but rendered nowhere — deliberately dropped,
  "add back if missed". Per-trip chips are what ships.)*
- **Seat cards** — one per required seat, each showing its sub-state + occupant:
  **Open** · **Asked** (who/when) · **Claimed** · **Confirmed** (name + one-tap contact) ·
  ~~**Bailed** (flips red; auto-reopens & re-asks)~~.
  *(Corrections: pools are **collapsed by default** on every seat — an explicit operator preference,
  2026-07-05, reversing the earlier auto-expand; and they render on **Open, Asked and Bailed** seats,
  not Open alone, because DEC-027 gave Asked seats a monitor view and Bailed seats a pool minus the
  bailer. `Claimed` is **momentary, not resting** — DEC-061 advances a winning accept
  `Asked → Claimed → Confirmed` in one operation. **`Bailed` is retired as a resting state** —
  DEC-128 rests a bailed seat `Open` and mints no inline re-ask; the red treatment survives for legacy
  rows only.)*
- **Eligible pool** (per Open / Asked / Bailed seat) — the oracle's computed pool (§1.3), **ranked by
  reliability** (§1.4). Only legally fillable people appear. Each candidate row: name + reliability
  indicator (high/med/low or ordering is enough) · **ask status: available · asked · in (+reply time) ·
  declined · silent (asked, timed out)** · quick actions.
  - *The hard rule set is **six**, not the four this line used to name: active · rated · MMC valid on
    date · not double-booked · not on PTO · **not on a standing weekday off** (DEC-119). The ranked
    list then drops three more classes: **over-ranked** crew (a captain is never asked for a mate seat,
    DEC-066), this shift's **bailers** (DEC-019), and holders of a **live ask on another seat of the
    same shift**. All under-inclusive, so "only legally fillable people appear" always holds — but a
    reader auditing the pool against a four-item list will find people missing with no explanation.*
- **Also rendered, and previously unlisted here:** the per-event **guest manifest** (#319, the same
  assembly the crew card reads), the **"✉ Message this day's crew →"** cohort deep-link (#317 — note
  this is a **cross-shift** action, i.e. partial delivery of the open question below), and the
  **Crewed-gate summary** ("N/M required seats confirmed — Crewed when all confirm").
  - **Silent is first-class and visually distinct from declined** — silence is the thing Spink hates
    and the thing the score penalizes; a ghost must be obvious at a glance.

### Actions
*(Reconciled 2026-07-27 against DEC-027 §1, which settled this inventory in June 2026 and never came
back to this list. The shipped set is: **assign · nudge · confirm · override · report-a-bail ·
no-penalty remove**.)*
- ~~**Broadcast ask** — fire to the whole eligible pool (mate flow / ask-then-assign).~~ — **DEFERRED
  (DEC-027 §1).** No manual broadcast control exists; the tick-fired path satisfies the intent, and
  "a blanket re-broadcast to decliners is spam, not escalation". `broadcastAsk` itself has no
  production caller — DEC-063 replaced the birth blast with the staged `widenAsk` drip.
- **Assign a person** — name someone into a seat; they get an ask. *(Correction, DEC-061: their "In"
  **auto-confirms**. There is no operator confirm step on the happy path.)*
- **Confirm** — ~~lock a claimant into the seat~~ **a vestigial backstop** (DEC-061, which amends this
  section by name). Still shipped, no longer the normal route.
- **Nudge** — direct individual escalation (manual Tier 2).
- ~~**Widen / re-ask** — broaden the pool or re-fire after declines/timeouts.~~ — **CUT.** "'Widen' has
  no rail by DEC-024" (DEC-027 §1). Widening happens automatically, on the drip.
- **Manual override** — drop **anyone rated for the role** into a seat directly, regardless of rank
  and seat state. Spink is always the authority; last-resort backstop. *(Correction: not literally
  "anyone" — **DEC-064**'s competency floor refuses an unrated placement ("no mate as captain") and
  **DEC-096** refuses an archived one. The picker enforces both, so a mate is never even offered for a
  captain seat. Rank is bypassed; competency is not.)*
- **Report a bail** / **no-penalty remove** (#87, DEC-039) — shipped, previously unlisted here.

~~In the autonomous posture the system performs broadcast → rank → confirm on its own; these actions
are Spink's manual equivalents for taking over.~~ *(The autonomous posture is now **drip → rank →
auto-confirm** — DEC-063 + DEC-061.)*

> **Fork resolved (assignment §1): contested seat → first-acceptable-yes-wins** for rollout (fast,
> fair, matches Spink's instinct); **best-by-score** is a knob to flip once reliability data is
> trusted. The two mostly agree — they diverge only when a flake answers first.

### ~~Both protocols live here~~ — **the fork is cut (operator, 2026-07-27; removal tracked in #561)**
~~Same seat cards, same eligible pool; the only difference is whether the ask goes to the crowd first
(**ask-then-assign**, mates) or names someone first (**assign-then-confirm**, captains). Per-role
default with per-person override (the override lives on the roster record, §2.1).~~

The distinction stopped being live before it was ever decided against: **DEC-063** (the drip) means
nobody is asked "as a crowd", and **DEC-061** (auto-confirm) means nobody is "named then confirmed" by
a human. The two ends collapsed it independently and nobody removed the scaffolding — `resolveProtocol`
has no production caller, `protocolOverride` persists with no reader and no editor, and no per-role
default exists as data at all.

**Settled on operator input:** neither protocol is wanted. A manual assignment happens *because the
asks failed* and the operator has already spoken to the person — that is the out-of-band path, not a
second protocol. §2.1's "the override lives on the roster record" describes a column that is being
removed.

### Data read
- Reads the **shift + seat states** (§1.1), the **escalation/tier activity** (§1.2), the **eligible
  pool** from the oracle (§1.3), the **reliability ordering + reasons** (§1.4), and **roster** detail
  (§2.1). Writes seat-state changes back through the machine.

### Edge cases
- **Bail** → the seat **rests `Open`** and re-crewing is the tick's job (the `Crewed → Filling` edge,
  §1.1). *(Correction, DEC-128 / #483 — a prod fix: `Bailed` is retired as a resting state and a bail
  no longer fires its own re-ask. The old inline re-ask was **horizon-blind** — verified in production
  2026-07-19, where a captain bail ~13 days pre-horizon stamped six identical-millisecond asks.
  Pre-horizon a bail now deliberately asks nobody. The card no longer flips red for new bails.)*
- **All declined / all silent** → the shift boards At-Risk (§2.5). *(Correction, DEC-065: the "**if
  also** close to the deadline" conjunction is wrong in both directions. A still-`Filling` shift with an
  uncrewed required seat boards inside the exhaustion threshold **regardless of in-flight asks** — the
  old pending/asked gate is deleted, so a live ask or a nudge no longer hides a near-term uncrewed
  shift. And the **eligibility**-exhaustion route boards **however far out**, with no deadline
  condition at all.)*
- **Manual override of the automation** — the automation cannot fight a manual placement; see the
  resolved open question below.
- **Reliability exposure** — ~~**resolved:** show Spink the ordering plus reasons on demand~~ —
  **ordering ships; "reasons" do not exist and never did.** `ReliabilityScore` is a scalar plus two
  window facts, with no per-factor breakdown to expose, and no admin surface renders a reliability
  value at all. The sibling clause under Eligible pool already sanctions ordering-only ("or ordering is
  enough"). **Open for the operator:** is ordering-only the settled answer, or are reasons still
  wanted? Do not close by deleting the clause — §1.4 is a different shard's subject.

### Acceptance criteria
- [ ] Each required seat renders its current sub-state and, when Open, an eligible pool ranked by
      reliability containing only legally fillable people.
- [ ] A `silent` candidate is visually distinct from a `declined` one.
- [ ] Broadcasting an ask and a candidate accepting moves the seat
      Open → Asked → Confirmed (auto-confirm, DEC-061; `Claimed` is momentary) and reflects it in
      the shift badge. (Pre-DEC-061 this required a separate Spink confirm.)
- [ ] A confirmed crew bailing ~~flips the seat to Bailed,~~ **rests it `Open`**, and re-crewing
      happens on the tick without manual intervention. *(Rewritten to DEC-128 — the old wording
      specified the horizon-blind inline re-ask that DEC-128 removed after it misfired in production.)*
- [ ] Manual override places any person **rated for the role** into a seat regardless of rank
      (authority backstop, bounded by DEC-064/DEC-096).
- [ ] The **deadline** rendered on the cockpit (DEC-038) is the **fills-by** instant —
      departure − 48h (DEC-031) — and is distinct from the **staffing horizon** line above it
      (departure − 7d, DEC-022). *(Split out of the previous criterion, which conflated the two and was
      therefore un-tickable against code that is correct and settled.)*

### Open questions (Assignment View)
- ~~Whether the autonomous posture needs an explicit **"pause automation, I've got this"** toggle per
  shift, or whether any manual action implicitly pauses the bots. *(Lean: any manual action pauses;
  confirm in build.)*~~ — **RESOLVED, twice over.** **DEC-027 §2** confirmed the implicit pause is
  *emergent*: escalation fires only on a stalled shift with no live asks, and every manual assign or
  nudge **creates** a live ask, so the autonomous tier is already incapable of fighting a manual
  placement — no pause flag, no resume action. The explicit per-shift toggle is parked in
  FUTURE_IDEAS. Separately, **DEC-054 shipped an operator engine pause** — but **global, at `/admin`**,
  honored by both cron routes, not per-shift.
- **Bulk actions** across multiple shifts (one weekend broadcast) — partly here, partly on the board.
  *(Partly delivered: the cockpit's "✉ Message this day's crew →" cohort deep-link (#317) is a
  cross-shift action. The weekend-**lock** half of the `§4 Parked` bulk-actions row is cut, not parked —
  DEC-082, see §2.3.)*

---

## 2.5 At-Risk Board

> Source: admin-3. The cross-shift **triage worklist** — the shifts the automation couldn't close.
> The **operational payoff Xola structurally cannot produce**: Xola says a booking is paid; this
> says "3 trips this weekend have no crew and you need to move."

### Purpose & design stance
The list of shifts that genuinely need a human — and almost nothing else.

- **Empty is success.** If Tiers 1–2 are working, nothing lands here. An empty board is the system
  doing its job, not a reminder Spink forgot to check.
  *(Caveat the shipped page adds and this line predates — **DEC-054**: with the operator pause on, an
  empty board means the engine is **muted**, not that every shift is covered. The page renders a warn
  banner saying exactly that. "Empty is success" holds only while the engine is running.)*
- **Push, not pull.** A shift reaching the board **pings Spink** (SMS to every active admin — DEC-095).
  ~~he goes there *when summoned*, he does not monitor it.~~ *(Correction: the shipped posture is push
  **and** pull. `/admin/at-risk` is the **admin post-login landing page**, a standing nav item, and the
  redirect target of four cockpit actions — the code calls it "the standing surface". Defensible, since
  the empty state renders as success and so costs nothing to look at; but the absolute as written is
  false.)* The intent stands: semi-retired, no babysitting.
- The failure mode to design against is the **anxiety dashboard** where everything glows yellow.
  Keep the bar for landing here **high**.

### What lands on the board (states to render)
- **Uncrewed shifts** — a required seat still empty, by either route: (a) eligibility-exhausted
  (nobody left to ask — ~~boards however far out~~ **boards only from the staffing horizon inward**) or
  (b) the trip is within the fill deadline (48h),
  **whether or not asks are still in flight** (DEC-065). The core case.
- **Regressions (late bails)** — a `Crewed` shift lost a confirmed crew close to the trip and can't
  auto-refill in time (the 11pm bail). **Distinct regression flag; rockets to the top** — was
  solved, now broken, little time. *(The regression route genuinely is horizon-free, unlike route (a)
  above — which is what makes route (a)'s bound legible as unstated rather than deliberate.)*
  > **Open for the operator (route (a)'s horizon bound).** A trip three weeks out that **nobody on the
  > roster may legally crew** is invisible until the staffing horizon (default 7 days), because
  > `resolveShiftState` returns `Pending` before the horizon whatever the pool says — DEC-022, "crew
  > rules abstain before the horizon". A test pins this as intended. But **the module's own doc comment
  > repeats this doc's error** ("summoned immediately, however far out the trip is"), so a doc-only fix
  > is insufficient. Is the horizon bound right for an *unfillable* trip, or should eligibility
  > exhaustion board early?
- **Credential lapse on assigned crew** — an assigned person's **MMC** will expire before
  the trip date, invalidating the assignment. Surfaces here so it's caught **before the dock**.
  *(Correction: **only MMC is checked.** `HARD_CREDENTIAL_TYPES` is a one-element list; `medical`,
  `TWIC` and `drug_consortium` are modeled credential types that can never board a shift. The board's
  own copy says "credential", broader than the check behind it. **Open for the operator:** widening the
  list moves the **oracle's** gate too, not just the board's — a domain question, not a board one.)*
- **Empty state** — rendered as success, not as an error/void.
- A shift still being actively worked **and more than the fill deadline (48h) from its trip** does
  not appear — it stays the system's problem in the assignment view. Inside the deadline it boards
  regardless of in-flight asks (DEC-065): a near-term uncrewed shift is the operator's to see, and a
  nudge no longer hides it.

### Urgency model (sort order)
A blend of **time to trip** (sooner = more urgent) · **fillability** (how thin the remaining pool is) ·
a **regression** term (a regression outranks a never-filled seat). Most-urgent at top.
*(Correction, DEC-025: this used to list three terms including "severity of gap — missing a **captain**
outranks a **mate**". That is **two** terms in code, not three, and the role-name ordering is
explicitly rejected: urgency is "expressed **only** as pool-thinness … never a role-name check". The
spec's own rationale for captain-outranks-mate **is** the small pool — thinness is the cause, the role
name only its BrewBoat-shaped shadow. So a missing **mate** with two candidates correctly outranks a
missing **captain** with six. Right in spirit, wrong in letter and arity.)*

### Triage from the list (context without clicking)
Each row carries enough to act without opening it:
- **What's missing** — 1 captain / 1 mate / both.
- **Time to trip.** *(The fills-by/horizon deadline is **not** shown on the board — it lives on the
  cockpit only. DEC-038. A board row no longer implies the automation has given up: within the
  deadline a still-worked uncrewed shift boards too, DEC-065.)*
- **Escalation transparency** — proof the system tried: "asked 6 mates · 4 declined · 2 silent ·
  pool widened · nudged Bob · exhausted." So Spink trusts it gave up for real reasons, not laziness.
- **Who's still ~~theoretically~~ *leanably* available** (if anyone) for a manual lean. *(Precision: the
  list is the **rankable** set, which is narrower than "theoretically available" — DEC-066 drops
  over-ranked crew, so a captain never appears under a mate seat even though the oracle counts them as
  able to crew it. On a mate seat whose only remaining candidates are captains the row therefore reads
  "nobody left in the eligible pool", when DEC-066's own text says the right move is to **override a
  captain in** from the cockpit. Tracked as #556.)*

Deep work happens in the assignment view (§2.4) — clicking a row drops Spink into that workbench.

### The decision surface: lean / reschedule / cancel
Make the three real options first-class — especially the painful ones, since this is the 11pm call:
- **Lean** — direct nudge to a specific high-value person ("I need you on this"). Manual Tier-2.
  **Shipped.**
- **Reschedule** — move the trip to a slot that *can* be crewed. Triggers customer-facing comms.
- **Cancel** — kill the shift. **This cascades** (notify customers, refund per policy, optionally
  offer reschedule). Cancel is never "delete the shift" — it has customer + payment fallout (the
  cancel-cascade flow, §3).

> **Status, 2026-07-27: two of the three are deliberately unbuilt, and §2.5 was the only doc not saying
> so.** Reschedule and Cancel **render disabled** with the honest title "customer-side cancellation
> cascades land with payments (parked, P3)", plus a standing line "Handle reschedule/cancel by phone for
> now". **DEC-026 §3** defers the cancel-cascade AC to the payments phase by name; `USER_STORIES.md`
> SP-13 already carries the marker; nothing in `src/` implements a cascade or a refund. **§3.3 also
> still states this AC as in-scope** and needs the same marker.

The board should make cancel/reschedule **easy and informed** — that's the decision that currently
keeps Spink up at night — but until payments land, the board's honest job there is to say "phone call".

### Data read
- Reads **every** shift except the two lifecycle terminals (`Cancelled` / `Completed`) and
  **re-resolves state itself**; membership is recomputed on read, never taken from the stored badge
  (the DEC-023 corollary, which the module states in its own header). *(Correction: this line used to
  say it "reads shifts in **At-Risk** (and regressed) state", which describes trusting a persisted
  badge — the one thing a display surface must not do. It also hid the headline case: **`Crewed` shifts
  are scanned too**, deliberately, because "the headline case is precisely the boat that looks fine" —
  a fully-crewed shift whose confirmed captain's MMC lapses before the trip.)* Also reads the
  **escalation log** (§1.2) and **roster + credential** data (§2.1). The **cancel** action would invoke
  the cancel-cascade flow (§3) — deferred with payments, see above.

### Edge cases
- ~~**Regression channel** — given the 11pm timing, a regression may warrant a louder channel than a
  normal in-app ping (e.g. SMS to Spink). *(Open, §3 notifications.)*~~ — **RESOLVED by removing the
  question's premise (DEC-095).** There is no "normal in-app ping" to be louder than: the board is the
  only non-SMS surface. Every landing sends **SMS to every active admin** — one composed body, one
  `admin_alert` kind, no per-reason routing (the reason only picks a label). Note the recipients are
  **all active admins**, deliberately not the single operator id. §3.1 restates the dead question and
  needs the same strike.
- **Warming / trending-toward-risk** — **explicitly not here** (would reopen the anxiety-dashboard
  door). It lives on the assignment view's monitor posture (§2.4), opened deliberately.
- ~~**"Exhausted" threshold** — how many declines / how close to horizon before a shift lands here is
  tunable; keep it high. *(Open, don't agonize.)*~~ — **RESOLVED on both halves, and one half was
  deleted rather than tuned.** *How close:* `EXHAUSTED_THRESHOLD_HOURS = FILL_DEADLINE_HOURS` — one
  constant, so the rendered deadline **is** the boarding instant (DEC-031), env-overridable, default 48h
  (DEC-115), with the inclusive boundary pinned by test. *How many declines:* no longer exists at any
  value — DEC-065 removed decline and ask counts from membership entirely, so a **never-asked** shift
  boards. §4's Tuning-knobs row parks the same resolved question and needs the same strike.

### Acceptance criteria
- [ ] ~~A shift appears on the board only after Tiers 1–2 exhaust (or a regression/credential-lapse
      occurs) — not while still being actively worked.~~ — **REWRITTEN to DEC-065.** A shift appears
      when a required seat is uncrewed and either the pool is eligibility-exhausted **or** the trip is
      inside the fill deadline — **regardless of in-flight asks**, including a shift nobody has been
      asked about yet. *(The struck wording specified the exact defect DEC-065 was filed to fix: the
      operator-reported case where nudging a candidate **removed** a near-term uncrewed shift from the
      board. The body of this section carried the DEC-065 reconciliation in two places while the
      acceptance criterion was left at the old rule, so anyone verifying the board against its own
      criteria would have marked correct shipped behaviour as a failure.)*
- [ ] Regressions render with a distinct flag and sort above never-filled at-risk shifts of similar
      time-to-trip.
- [ ] Each row shows what's missing, time to trip, and the escalation trail — enough to triage
      without opening it.
- [ ] An empty board renders as a success state, and the board does not show "warming" shifts.
- [ ] Cancel triggers the cancel-cascade (§3) across every booking on the shift, not a silent delete.
      *(**Deferred to the payments phase by DEC-026 §3** — not a gap. Reschedule and Cancel ship
      disabled with an explanatory title; the operator handles both by phone. This box cannot be ticked
      until payments land, and that is the plan of record.)*
- [ ] Clicking a row opens that shift's assignment view (§2.4).

---

## 2.6 Crew App

> Source: crew-app-surface (+ the per-event manifest reconciliation from event-admin §1, folded in
> here). Design stance: **insultingly small.** The failure mode is not missing features — it is
> **friction and stale info.** Every screen added is a place for bullshit to hide. ~~The crew member's
> entire world is three surfaces.~~ (Native vs PWA is parked, §4.)
>
> **⚠️ Reconciled 2026-07-27 (audit shard C2.6).** This section had **never had a reconciliation pass**,
> and five accepted DECs had moved under it unrecorded. Corrections are struck in place below.
>
> **Surface count:** **seven** crew routes ship — `/crew`, `/crew/shift/[shiftId]`, `/crew/open`,
> `/crew/calendar`, `/crew/threads`, `/crew/time-off`, `/crew/help` — and the hub renders four
> navigation entries plus a footer link. Each arrived with its own DEC (DEC-074, DEC-091, DEC-098,
> DEC-009, §7.6) and **none amended the count**. The *stance* stands — insultingly small, no bullshit —
> but "three surfaces" is a number, and it is wrong. `BRAND.md` carries the same stale claim, and §2.7's
> block-quote still calls self-serve "a **fourth** crew surface", true at DEC-074 and overtaken since.

### 2.6.1 The ask
Arrives as **push / SMS**, answered by **tapping through to the app**:

> *Sat Jul 18 · BrewBoat · mate · call 12:30, back ~6. In or out?*

- ~~**Two buttons. ~3 seconds. No login, no navigate-to-respond.**~~ — **half met, half settled against.**
  **"No login" is real and shipped:** the SMS carries a magic link that lands the crew member
  authenticated (DEC-030 §2/§4 — 24h TTL, prefetch-safe consume), so there is no password step. **"No
  navigate-to-respond" is not, and will not be:** answering means opening the app. DEC-030 chose an
  operator-relayed web link with **no inbound webhook**, the Twilio adapter kept that posture ("no
  inbound SMS parsing"), and no inbound route exists.
  **Settled on operator input, 2026-07-27: there will never be reply-by-SMS — too many problems.** The
  aspiration was never built and is now closed; the standard it set (accepting must not be harder than
  replying to a text) survives as the *bar*, not as the mechanism. §3.1 repeats the retired claim and
  needs the same strike.
- **Magic-link auth, no passwords** (§3.2) — casual crew won't manage credentials; a forgotten
  password is a ghosted shift.
  > **Open for the operator:** the **shipped SMS carries no time at all** — just date, boat, role, "In
  > or out?" — while the in-app ask card renders the full call→back window. The two ask surfaces
  > disagree, which is the exact shape §2.6.3's "single source of truth" invariant forbids. The reason
  > is real but is only a code comment, not a decision: GSM-7, 1-segment, 160 chars. Adding the window
  > costs ~16 characters against a ~55-character body. Worth it, or leave the text minimal?

### 2.6.2 My shifts
The home screen if they open the app: a short list of **confirmed *and claimed*** upcoming shifts, one
card each, past stuff hidden. *(Correction, #4: a fresh "In" lands visibly here — badged "Awaiting
confirmation" — instead of vanishing into nothing. A deliberate improvement on the spec'd behavior.
"Past stuff hidden" is exactly right, and uses a **vessel-local** today.)* Plus the crew member's **own reliability standing** (individual, not comparative —
§1.4). That's all. **Empty state** (no upcoming shifts) is normal, not an error.

### 2.6.3 The shift card — single source of truth
Everything needed on one screen, no hunting. This is where "bulletproof" lives.

- **Call time, distinct from departure time** — crew need when to *show up*, which is not the
  customer's departure. The #1 source of dock confusion. Show both, **labeled clearly**.
  *(Vocabulary drift worth closing: the constraint is **met**, but the card labels the rows "Shift
  Start" / "First departure" / "Shift End · off the clock", while this spec, `ui-context.md`, the view
  model (`callTime`) and DEC-041 all say **call time** — the word crew actually hear on the dock.
  Either the UI adopts it or this doc does; a binding constraint stated in vocabulary the surface
  doesn't share is hard to check on the rendered page.)*
- **Dock as a tappable map pin**, not a copy-paste address.
- Boat, ~~trip type,~~ pax count.
- **Who else is crewing, with one-tap contact** — kills "I'm running late, who do I call."
- **Manifest — grouped per event.** A mate on the Saturday shift needs the 1pm, 3pm, and 5pm guest
  lists separately, because different customers are on each event. Each shows **name + count/phone**;
  **waivers are not shown** (not needed for crew, §0.4). ~~*This is the hinge that ends the Xola split
  (§3.5) — pull it early.*~~ — **the pull happened.** The manifest has been live for phases; the §3.5
  Xola guide sheet it was meant to retire was **never built**, so §3.5's "explicitly temporary" framing
  describes a retirement trigger that has already fired. Advice now spent — §3.5 needs the update.
- ~~Notes.~~
- *(Later)* the day-cohort message thread hangs off this card (parked, §4).
- **Shipped and previously undocumented here:** a per-guest **Text button** that deep-links to Messages
  with a composed intro body (#345 Part A), and a **guest-contact ledger** on the row — "✓ Texted by
  {name} · {time}" (#345 Part B). A crew member can text a guest from the card and see who already did.

> **Open for the operator — two spec'd card fields that exist nowhere.** "Trip type" and "Notes" have
> no model field, no column and no surface; Xola's product name isn't carried through the event mapping
> either, and the only "notes" a crew member sees is Messages ("where notes from the office land").
> Escalated as a question, not a defect: at four hulls running one product, trip type may be a
> distinction without a difference, and per-shift notes may be deliberately routed to Messages by
> DEC-091's hub-and-spoke IA. Struck above pending your answer.

### The three bulletproofing principles (the load-bearing behavior)
1. **The card is authoritative and live.** Departure changes → card changes → crew gets a ping
   (§3.1). Never "check your email for the update." The entire value is that the app is the *one
   known place*; the moment info splits across channels, you're back to Xola.
   *(Status: the **card** half is structurally true — it re-reads the event on every render, no cache.
   The **ping** half has a known hole: notices fire on event-**id-set** change, so a Xola retime that
   keeps its event id tells nobody their call time moved. Pinned by a characterization test that says so
   in its own name; filed as **#548**.)*
2. **Bailing is as easy as accepting.** If "I can't make it" is a guilt-trip wall, crew ghost
   instead and you find out at the dock. A frictionless decline beats a hard one that produces
   no-shows — this is exactly the `Crewed → Filling` edge (§1.1).
   *(Correction, DEC-128 / #483: a bail no longer ~~immediately re-asks the next person~~ — it rests
   the seat `Open` and defers re-crewing to the tick, and "the re-crew latency is operator-accepted".
   Three consequences the old "immediately" hid: **pre-horizon** a bail is re-crewed **never** — the
   shift falls back to `Pending` and nobody is asked, which DEC-128 calls the fix; **in-horizon** the
   next tick drips **one** candidate, not "the next person" now; inside the fill deadline the urgent
   blast lands within ~15 minutes.)*
3. **The app watches their credentials for them.** Quietly nudge the crew member when their own
   MMC / medical / TWIC nears expiry — *before* it drops them from the eligible pool. Turns a
   compliance landmine into a gentle heads-up and keeps the pool healthy without Spink tracking
   everyone's paperwork in his head.

### States to render
- **The ask** (in/out, answered in-app via the magic link — not from the notification itself; see
  §2.6.1).
- **Confirmed-shifts list** + own reliability standing; empty state.
- **Shift card** with all fields above, ~~a **live-updated** indicator when something changed since
  last viewed,~~ and the per-event manifest.
  > **Open for the operator:** the *"changed since last viewed"* indicator is **not built**, and is
  > named as a deferred follow-up in two docstrings with nothing in `DECISIONS.md` cutting it. There is
  > no read-state, no last-viewed timestamp, no per-crew view ledger anywhere. The **operator** board
  > has the analogous cue ("changed in the last pull"); the crew card has no equivalent. This is the
  > *quiet* half of principle 1 — the loud half (the ping) is #548 — so both halves of "the card is
  > authoritative and live" are currently incomplete. Build it, or cut it on the record?
- **Bail action + confirmation.**
- **Credential nudge** (expiring-soon).
- **"Seat already filled"** acknowledgement (a contested yes that lost — first-yes-wins, §1.2/§2.4).

### Actions
- **Accept / decline an ask** (in-app, via the magic link in the notification).
- **Bail** on a confirmed shift (frictionless; the seat rests `Open` and the tick re-crews — DEC-128).
- Tap the **dock pin**; **one-tap contact** co-crew.
- See the **credential nudge**; see **own standing + reasons**.

### Data read
- Shift card reads **shift/seat state** (§1.1), the **manifest** from Event Admin reservations
  grouped per event (§2.2), and **co-crew contact** from the roster (§2.1).
- Reads the crew member's **own reliability standing** (§1.4) and **credential expiries** (§2.1).

### Edge cases
- **Accept a seat that just filled** (contested, first-yes-wins) → clear "this one's taken" message,
  no error state.
- **Bail** → seat rests `Open` and the **tick** re-crews (§1.1, DEC-128 — ~~re-asks next candidate
  immediately~~); the bailer's card drops off their list.
- **Departure/detail change** on a confirmed shift → card updates + ping; never silent.
- **Magic link** expired/reused → graceful re-request, not a dead end (§3.2).

### Acceptance criteria
- [ ] ~~An ask is fully answerable (in/out) from the push/SMS without opening or logging into the
      app.~~ — **REWRITTEN.** An ask is answerable in **two taps from the notification** — tap the
      magic link, tap In or Out — **with no login and no password**. *(The "without opening" half is
      closed on operator input, 2026-07-27: there will never be reply-by-SMS. DEC-030 chose an
      operator-relayed magic link with no inbound webhook and that stands. The "no login" half is fully
      met and well-built.)*
- [ ] The shift card shows call time and departure time as **distinct, labeled** fields.
- [ ] The shift card shows the manifest **grouped per event** (separate 1/3/5pm lists), name + count,
      no waiver field.
- [ ] Changing a shift's departure updates every assigned crew member's card and pushes a ping.
      *(Card half met — it re-reads the event on every render. **Ping half has a known hole, #548:**
      notices fire on event-**id-set** change, so a Xola retime that keeps its event id tells nobody.)*
- [ ] Bailing reopens the seat and the **tick** re-crews it, with no operator action.
      *(Rewritten to DEC-128 — the inline "re-asks the next candidate" was removed after it fired
      horizon-blind in production. Pre-horizon a bail deliberately asks nobody.)*
- [ ] A crew member sees only their own standing and reasons — never a ranking against other crew.
- [ ] A credential nearing expiry triggers a crew-facing nudge before the person drops from the pool.

---

## 2.7 Crew Self-Serve — "Pick your shifts" (the crew pull surface)

> **Stance:** ~~a fourth crew surface, added as a knowing exception to §2.6's "three surfaces"~~ a crew
> pull surface (DEC-074) — a *restoration* of the self-pick workflow mates always loved. It is **pull,
> opt-in, anti-anxiety** (DEC-042 guardrails) and is **not** the parked positive-availability calendar
> (§4): crew claim concrete, already-formed shifts, never declare abstract availability.
> *(The "fourth surface" framing was true at DEC-074 and has been overtaken three times since — seven
> crew routes ship. See §2.6's reconcile banner.)*
>
> **Dark by default, and coupled.** `/crew/open` 404s unless `CREW_SELF_SERVE=1`; the claim action
> redirects on the same gate and the hub entry doesn't render. **The coupling is the point, not the
> flag:** one env var gates **both** this surface **and** the DEC-079/DEC-081 crew code-login front
> door, so they cannot ship independently — a fact stated in neither §2.7 nor §3.2 until now. Shard E's
> E1 named the consequence: a deploy built from the runbook comes up with crew unable to sign in.

**2.7.1 The list.** ~~Open~~ **Uncommitted** **required** seats the viewer is **eligible** for, on
shifts in `Pending`/`Filling`/**`AtRisk`**, within `[today, today+45d]`.
*(Correction, #440: both halves were widened and never back-ported. Seats are the **complement of
committed** — `Open`, **`Asked`** and **`Bailed`** — because "an outstanding ask is not a reservation".
Shifts include **`AtRisk`** deliberately: "the shift that most needs a body is the last one that should
be hidden." The same stale wording is the origin text in **DEC-078's "MVP claimable set"**, so fixing it
here alone leaves the DEC as the surviving wrong answer — routed to shard Z.)*
*(Precision on "eligible": the gate is **six** rules, not the three named here — active · rated · MMC
valid on date · not double-booked · not on PTO · **not on a standing weekday off** (DEC-119). §1.3's own
rule list omits the sixth and §2.1 calls suppressions "PTO / blackout only", so following this pointer
does not let a reader enumerate the gate. Note also that "suppressed" here means **PTO** in the §1.3
sense, **not** the DEC-129/130 `working`/`declinedOnDay` ask-suppression — a collision this spec
predates.)*
Default filter **7 Days**; presets **7 Days / 2 Weeks / 30 Days** plus a from–to range. *(Correction,
#414: not "today", and the "this weekend" preset was removed — the e2e suite actively asserts its
absence. This is a pull surface, so crew browse a week ahead.)* One row per claimable seat: **date ·
vessel hue + vessel · role · first departure · trip count · Claim**; the **call → back window** lives in
the confirm sheet, not the collapsed row ("too busy collapsed"). No auto-refresh, no polling, neutral
ink (DEC-042) — ~~no live counts~~ a bare `N open` row count for orientation is fine, which is how the
surface reads DEC-042's guardrail. Empty = normal, not an error.

**2.7.2 The claim.** One tap → confirm sheet stating the **whole-day** scope, the **live trip count**,
and the **call/back window** (DEC-077 copy). Confirm → seat `Open → Confirmed` (auto-lock, DEC-075). The
seat now appears in **My shifts** (§2.6.2). Guarded against races ~~and the one-shift-per-date
conflict~~ (DEC-078).

> **The one-shift-per-date guard is not concurrency-safe — #554.** The single-seat race genuinely is
> closed (a guarded CAS; the loser gets `just_taken`). The same-date guard is a read-then-CAS over a
> cross-record invariant the no-FK store cannot enforce, and the code says so in its own comment: two
> **concurrent** claims by one crew member for two **different** same-date shifts both read an empty
> committed set, both pass, and each per-seat CAS wins → confirmed to two boats the same day. DEC-078
> asserts both guards in one breath with no caveat and needs the same correction.
>
> **Related but separate — #560.** The operator has questioned whether the whole-day rule is right at
> all: two non-overlapping single trips on different boats should arguably be workable by one person,
> and today the rule removes them from the **eligible pool** entirely, so they are never even asked.
> That is a policy change to the oracle, not to this surface. **Neither this clause nor DEC-077/078
> should be rewritten further until #560 is decided**, or they get rewritten twice.

**2.7.3 Release.** Releasing a self-claimed seat ~~is as easy as claiming it~~ ships via §2.6's bail,
not a §2.7 control: seat returns to `Open` and **the tick re-crews it** (DEC-128 — ~~re-asks~~ no inline
ask); a reliability event is recorded, lead-time-weighted (§1.4).
*(Three corrections. The function written for this subsection, `releaseSelfClaim`, has **zero production
callers** — the behavior moved to `bailFromSeat` and ships correctly from the shift card, so this is
"its function moved", not "it's missing"; the dead export is tracked in #558. "Re-asks" is stale per
DEC-128. And "as easy as claiming it" is not true of the shipped geometry: claiming is one tap on
`/crew/open`, releasing is `/crew` → `/crew/shift/[id]` → bail, on a different surface.)*

**2.7.4 What this surface is NOT (Phase 7 non-goals).** No sub-day blocks/"watches" (whole-day only,
DEC-077). No multi-role / role-picker (native-role-only; dual-rating is the operator-assign hack,
DEC-076). No supernumerary self-claim. No operator-confirm gate (auto-lock; the confirm-required mode is
a dormant `app_settings` seam, DEC-075). No availability calendar (§4).

**2.7.5 Relationship to the cascade.** Pull and push **coexist**. Self-claim front-loads fills
(especially mates) during `Pending`/early `Filling`; whatever's still `Open` at the staffing horizon
flows into the existing ask cascade (§1.2) — which remains the primary captain-fill tool. The two never
conflict: both end at a `Confirmed` seat via the same state machine.

### Acceptance criteria
> **Added 2026-07-27 (audit shard C2.7).** §2.7 was the **only** §2.x section with no acceptance
> criteria and no open questions — six sections established the format and the seventh silently dropped
> it, in the section whose behavior is the most concurrency-sensitive in the crew app. Phase 7 shipped
> anyway, so nothing was blocked; the cost was retrospective, i.e. this audit had zero boxes to tick and
> verdicted the five numbered sub-clauses instead. **Confirm or amend this list** — it is derived from
> the sub-clauses and shipped behavior, not from an original author's intent.

- [ ] The list shows only seats the viewer is eligible for under the **same six-rule gate** the oracle
      applies — no seat is claimable that the engine would never have asked them about.
- [ ] An `AtRisk` shift and an already-`Asked` seat both appear (#440); a **committed** seat never does.
- [ ] One tap → a confirm sheet stating whole-day scope, live trip count, and the call/back window
      before anything is written.
- [ ] Two concurrent claims on the **same seat** produce exactly one `Confirmed`; the loser gets an
      honest "just taken", not an error. *(Met — guarded CAS.)*
- [ ] A crew member cannot end up committed to two shifts on the same date. *(**NOT met** — #554;
      and the rule itself is under review in #560.)*
- [ ] Releasing a claimed seat returns it to `Open` and records a lead-time-weighted reliability event,
      with no operator action.
- [ ] The surface renders nothing and claims nothing when `CREW_SELF_SERVE` is off.

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
- **Bulk actions** — ~~weekend-lock (builder),~~ cross-shift broadcast (assignment/board). Build the
  single-item version first. *(Correction, DEC-082: the weekend-lock half is **cut, not parked** — 8.6
  by name — and "build the single-item version first" was unreachable advice, since per-shift lock
  (8.2b) was cut in the same breath. The broadcast half is untouched and stays parked.)*
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
- **Deposit vs full payment** at booking — Drew. (Recommendation: full upfront for v1.)
- **Refund schedule numbers** (the partial-refund tiers) — Drew.
- **Credit-vs-cash default ordering** in the cancel flow — lean credit-first, cash always available;
  confirm with Drew.
- **Balance-capture timing** if deposits are used (tie to a horizon?).
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
