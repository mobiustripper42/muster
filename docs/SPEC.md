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
> 0 Overview ✅ · 1 Substrate ✅ · 2 Surfaces ✅ (2.1 Roster · 2.2 Event Admin · 2.3 Builder · 2.4 Assignment · 2.5 At-Risk · 2.6 Crew App) · 3 Cross-cutting ✅ · 4 Parked ✅

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
- **Shift Builder** — reservations/events → reviewable, lockable shifts.
- **Assignment View** — the per-shift crewing cockpit.
- **At-Risk Board** — the cross-shift triage worklist.
- **Crew App** — the three crew-facing surfaces (the ask, my shifts, the shift card).
- **Crew Roster / People** — the per-person record everything above consumes (NET-NEW; see §2
  when written). Without it the oracle has nothing to reason over.
- **Cross-cutting** — notifications/push, magic-link auth, and the cancel-cascade + dispute-alert
  flows **only where they surface inside the admin app**.

**Parked — inherited deferrals, not reopened here (full list in §4):**

- The **customer portal** — sketch only, Tier 4, off-season 26/27. Builds last; not on the
  critical path because 2026 reservations arrive via CSV.
- **Payments topology internals** — deposit-vs-full, refund-schedule numbers, Stripe integration
  detail. Only the admin-facing *surfaces* of payments are in scope.
- **Native vs PWA** for the crew app — decided at the infrastructure stage.
- **Historical Xola data migration** — leaning read-only archive.
- The **Xola API bolt-on** — killed; write-back to Xola is manual in 2026 (the "enter these in
  Xola" sheet).

A "full spec" session tempts re-speccing the deferred work. The discipline is that this document
*inherits* those deferrals; it does not relitigate them.

## 0.3 The 2026/2027 arc (context the surfaces assume)

- **2026 — coexistence.** Xola owns bookings/money/waivers. A CSV export from Xola is imported
  into Event Admin and **auto-formed into shifts** by the same grouping logic that runs live in
  2027. Muster crews those shifts for real. Crew are also assigned as **guides in Xola** (manual
  write-back from a Muster-emitted sheet) because the guest manifest still lives in Xola.
- **2027 — Muster takes bookings.** Shifts auto-form from Muster's own live feed; the CSV step
  evaporates. Same shift-builder surface, different input source.
- **The hinge** that ends the Xola split: the day the crew-facing **manifest** (guest name +
  count per event) lives on Muster's shift card, crew stop needing Xola. Pull the manifest early.

The import path is disposable plumbing; everything it feeds is permanent.

## 0.4 Glossary — locked vocabulary

| Term | Definition |
|---|---|
| **Event** | A scheduled trip occurrence: BrewBoat · Sat · 3pm · capacity 6. Exists whether or not anyone booked it. |
| **Reservation** | A customer buying seats *on* an event: "Smith, party of 4, on the 3pm." |
| **Shift** | One boat + one day, batching that boat's events (1/3/5pm) into a single **crewing unit**. The atom Muster crews. |
| **Seat** | One role slot inside a shift (a captain seat, a mate seat). What crew get assigned to. |
| **Required seat** | Working crew the shift legally/operationally needs (BrewBoat = 1 captain + 1 mate, derived from COI). **Gates** the shift. |
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
`shift_completed`; `+` small for low `ask_declined` latency; `0` for the decline itself; `−` for
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

### Purpose
Hold the **imported** events and reservations (from the 2026 Xola CSV bridge) and be the single
data layer the rest of Muster reads — shift builder reads **events**, crew manifest reads
**reservations**. Allow light manual maintenance between CSV syncs. In 2027 the customer portal
becomes the thing that writes reservations here directly; the CSV path retires, this layer stays.

### States to render
- **Event list** — events grouped by date (and filterable by boat), each showing boat · day · time ·
  capacity, plus reservation count and pax total against capacity.
- **Event detail** — one event with its reservations: each reservation's customer **name, party
  size, phone**. This is the per-event manifest source (name + phone; **waivers not needed for
  crew** — §0.4).
- **Import result** — after a CSV import, what was added / updated / skipped, and any rows that
  couldn't be parsed (so a dirty export is visible, not silently dropped).

### Actions
- **Import** events + reservations from CSV (bulk, ~1–2×/week) — with reconciliation against what's
  already there (see edge cases).
- **Manually add / cancel a single reservation** — the odd phone booking or cancellation between
  syncs.
- **Manually add / edit an event** — the odd schedule change (extra sailing, cancelled slot).
- **Browse** events with their reservations — also how Spink eyeballs the weekend before building
  shifts.

Deliberately **out of scope here:** pricing, payment capture, marketing, customer comms. Those are
Xola's job in 2026 or the portal/payments work later.

### Data read
- Written by the **CSV bridge** (coexistence §2) and, in 2027, by the **customer portal**.
- Read by the **shift builder** (§2.3, reads events) and the **crew manifest** on the shift card
  (§2.6, reads reservations grouped per event).

### Edge cases
- **Re-import reconciliation.** A reservation already imported, now changed or cancelled in Xola,
  must update/cancel in place — not duplicate. (Mirrors the "late booking joins a locked shift"
  nudge, §2.3.)
- **Manual entry clobbered by re-import.** A reservation Spink hand-added between syncs must **not**
  be wiped by the next CSV import. Needs an explicit **merge rule** — manual entries are preserved
  or reconciled, never silently overwritten. *(Merge rule shape is an open question, §2.2 below /
  carried from event-admin §5.)*
- **Dirty / partial CSV.** Unparseable rows surface in the import result for Spink to fix by hand,
  rather than failing the whole import or dropping rows silently.
- **Event edited after shifts formed.** Changing an event's time/capacity after its shift was built
  must propagate to the shift (and raise the shift-builder "changed since you reviewed it" nudge if
  locked — §2.3).

### Acceptance criteria
- [ ] Importing a CSV creates events and their reservations, grouped correctly (reservations →
      events by occurrence; events available to roll up → shifts by boat+day).
- [ ] Re-importing a CSV with a changed reservation updates it in place; a cancelled one is marked
      cancelled — neither duplicates.
- [ ] A manually-added reservation survives the next CSV import per the merge rule.
- [ ] Event detail shows each reservation's name, party size, and phone; no waiver field is required.
- [ ] Unparseable CSV rows appear in the import result rather than being silently dropped.
- [ ] Editing an event's time propagates to any shift already formed from it.

### Open questions (Event Admin)
- **Merge rule** for manual entries vs re-import — the precise reconciliation policy. *(Owner:
  Spink/Drew, against a real export. Non-blocking — can default to "manual wins, flag conflicts"
  and refine.)*
- Exact Xola **export columns** — determines how complete imported events/reservations are, and
  how much pax/trip detail is available for crew sizing. *(Check at the desk against a real export.)*

---

## 2.3 Shift Builder

> Source: admin-1. The **bridge between the two halves of the app** — where continuous reservations
> become discrete crewable shifts. Net-new (Xola has no crewing-unit concept). The 2026 import-mode
> and the 2027 live-mode are the **same surface** — only the input source differs (coexistence §4).

### Purpose
Turn the week's events into reviewable, lockable **shifts**. The core reframe is **build → review**:
shifts form **continuously and automatically** as bookings land; the Monday ritual becomes a
**review pass** (adjust + lock), not a build-from-blank-slate. The machine does the grouping; Spink
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
1 captain + 1 mate — computed, not hand-entered). Per-shift overrides: add a **required** working
hand (big-pax day — gates `Crewed`); add a **supernumerary/trainee** seat (non-gating, pairing
rule, **consumes a passenger slot** vs COI max-pax). Derived default is the COI minimum.

### States to render
- **Date-range / weekend view, grouped by boat then day.** Each proposed shift is a block showing:
  boat · date · the trips inside (1/3/5pm) with pax totals · required seats (derived) · current
  **crewing-state badge** (Pending / Filling / Crewed / At-Risk).
- **Lock state** per shift — unlocked (system still assembling) vs locked (reviewed, crewing may
  proceed).
- **"Changed since you reviewed it" nudge** — a locked shift that has absorbed a new/changed booking
  shows this; it is never silently altered.
- **A freshly spawned proposed shift** — a late booking for a boat/day with no existing shift
  creates one; it appears as a new block needing review.

### Actions
- **Split** a shift (e.g. morning private charter wants different crew than the afternoon public trips).
- **Merge** two proposed shifts.
- **Override seat requirements** — the two cases above (required working hand vs supernumerary).
- **Lock** — commit the shift. Locking is the deliberate hand-off; **inside the staffing horizon it
  fires the asks** (Tier 1). Per-shift, plus a likely **bulk "lock the weekend"** action.

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
- **Late booking, shift exists, unlocked** → slots in automatically, silently.
- **Late booking, shift exists, locked** → joins, raises the "changed since you reviewed it" nudge.
- **Late booking, no shift for that boat/day** → spawns a new proposed shift.
- **Event edited upstream** (Event Admin) after a shift formed → propagates; nudge if locked.
- **Unlocked shift already inside the staffing horizon** → see open question below.

### Acceptance criteria
- [ ] Importing/refreshing events produces proposed shifts grouped one-boat-one-day, with required
      seats derived from COI — no manual grouping step.
- [ ] Splitting a shift produces two shifts whose trips partition the original's; merging is the
      inverse.
- [ ] Overriding to add a required hand changes the gate for `Crewed`; adding a supernumerary seat
      does **not** gate `Crewed` and **decrements** available pax against COI max.
- [ ] Locking a shift inside the staffing horizon fires Tier-1 asks; locking one outside does not.
- [ ] A booking landing on a locked shift joins it and raises a review nudge; a booking for a
      boat/day with no shift spawns a new proposed shift.

### Open questions (Shift Builder)
- **Unlocked shift inside the staffing horizon** — does crewing wait for lock, or start
  provisionally? **Leaning: crewing waits for lock** during rollout so Spink stays in control;
  revisit once the autonomous path is trusted. *(Non-blocking; default = wait-for-lock.)*
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
  (Filling / Crewed / At-Risk) · a **"fills by" countdown** to the staffing-horizon deadline.
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
- [ ] Broadcasting an ask, a candidate accepting, and Spink confirming moves the seat
      Open → Asked → Claimed → Confirmed and reflects it in the shift badge.
- [ ] A confirmed crew bailing flips the seat to Bailed, reopens it, and re-asks the next candidate
      without manual intervention.
- [ ] Manual override places any person into a seat regardless of rank (authority backstop), and the
      "fills by" countdown reflects the staffing-horizon deadline.

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
- **At-Risk shifts** — Tiers 1–2 exhausted, still short, deadline closing. The core case.
- **Regressions (late bails)** — a `Crewed` shift lost a confirmed crew close to the trip and can't
  auto-refill in time (the 11pm bail). **Distinct regression flag; rockets to the top** — was
  solved, now broken, little time.
- **Credential lapse on assigned crew** — an assigned person's MMC/medical/TWIC will expire before
  the trip date, invalidating the assignment. Surfaces here so it's caught **before the dock**.
- **Empty state** — rendered as success, not as an error/void.
- A shift still being actively worked (pool not exhausted, deadline not close) **does not** appear —
  it stays the system's problem in the assignment view.

### Urgency model (sort order)
A blend of **time to trip** (sooner = more urgent) · **severity of gap** (missing a **captain** —
small, fickle pool — outranks a **mate**; a **regression** outranks a never-filled seat) ·
**fillability** (how thin the remaining pool is). Most-urgent at top.

### Triage from the list (context without clicking)
Each row carries enough to act without opening it:
- **What's missing** — 1 captain / 1 mate / both.
- **Time to trip + horizon deadline.**
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

- **Crew: magic-link, passwordless.** Casual crew will not manage credentials; a forgotten password
  is a ghosted shift (§2.6.1). The link drops them straight onto the relevant card/ask.
- **Crew do not self-register.** Roster records are operator-created (§2.1); the magic link is for
  *responding and viewing*, not signup.
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

- **In scope for 2026:** Muster generating that sheet from the locked shifts.
- **This is explicitly temporary.** The day the crew-facing **manifest on the shift card** (§2.6.3)
  is live, crew stop needing Xola and this sheet retires. That manifest is the **hinge** that ends
  the split — which is why §2.6.3 says pull it early.

---

# 4. Parked — deliberately deferred, not reopened

These are inherited deferrals (§0.2). Listed so they're visible and owned — **not** to be designed
now. Building any of these is out of scope until its trigger condition is met.

### Deferred features (build later, by plan)
- **Customer portal** — Tier 4, off-season 26/27 → 2027 launch. Sketch only (customer-portal-sketch);
  Xola's screens are the pattern source when the time comes. Not on the 2026 critical path because
  reservations arrive via CSV.
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
- **Event Admin merge rule** — precise reconciliation of manual entries vs re-import.

### Infrastructure-stage decisions
- **Native app vs PWA** for the crew app — decided once all requirements are in; the real question is
  push reliability (§3.1).
- **Historical Xola data** — migrate 2024/25/26 reservations, or leave Xola as read-only archive.
  Leaning **archive**.

### Explicitly killed — do not revive
- **The Xola API bolt-on.** A live API integration is a maintained dependency on a system with an
  ~18-month kill date. The one-way CSV import + manual guide write-back (§3.5) replaces it on purpose.
  Different thing from the CSV bridge; do not conflate.

---

*End of v1. This document is the buildable source of truth; mocks (Claude Design) and code (Claude
Code) derive from it. Changes discovered downstream edit these words first.*
