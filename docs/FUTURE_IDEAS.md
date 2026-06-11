# Muster — Future Ideas (the shiny-object parking lot)

Companion to the **🔒 LOCKED** `docs/SPEC.md` (v1.0, 2026-06-03). The spec is frozen as the build
baseline. **Everything new lands here, not there** — however good it sounds at 11pm.

This is not a backlog you're committed to. It's a holding pen so a new idea can be *caught* without
*derailing* the build. An idea here costs nothing and blocks nothing. An idea in the locked spec
costs a baseline change.

## How to use this
- New idea → drop it below with one line of why. Done. Go back to what you were building.
- Don't design it here. A title + a sentence is enough to stop it rattling around your head.
- When a batch is genuinely ready to fold in, that's a deliberate spec **v1.1** — not a drip.
- Be honest in the "verdict" column over time: most shiny objects are correctly *never built*.

## Already reserved in the locked spec (not here — pointers only)
These three were captured *before* the lock and live in spec §4 with their guardrails. Listed so you
don't re-log them:
- **Progressive crew commitment** (soft-hold + staged horizons) — SPEC §1.1, §1.3, §4; PROJECT_PLAN Phase 5 (Pass D).
- **Year-end reliability report** (operator-judged bonuses) — spec §4, Goodhart guardrail.
- **Hold→complete reward** folds into the existing score; no new machinery.

---

## Parking lot

*(date · idea · why it's tempting · the catch / guardrail · verdict: parked / folding-into-v1.1 / dropped)*

| Date | Idea | Why tempting | The catch | Verdict |
|---|---|---|---|---|
| 2026-06-04 | **Booking modification (party-size change → possible vessel reassignment)** — full writeup below | Found live in real Xola data; the engine already half-answers it (oracle re-query) | Touches reservations + reassignment + customer comms; self-serve version is portal-era | parked — build post-slice |
| 2026-06-07 | **Richer call-time model** — per-vessel prep + additive per-event positioning/transit, ultimately *computed* from a storage-location → pickup-dock distance | Real nuance: a bigger boat takes longer to ready (per-vessel); a boat staged from storage to a different pickup dock needs extra lead (per-event/route) | Needs a locations/routes model + travel-time lookups; the slice ships a flat fleet-wide 45-min lead instead (#13). Operator-set `transitMinutes` is the cheap interim before auto-compute | parked — slice uses a flat lead |
| 2026-06-07 | **Post-shift state on the shift card** — what the card shows/offers once the shift is over (a "shift complete" wrap-up, graceful retirement, or an attendance check) | Closes the card's lifecycle; the *completed* shift is where reliability "did they actually show — 8/8" data is born (DEC-008), so the card is the natural capture point | Needs the `Completed` shift transition (wants the staffing-horizon clock) + a thin wrap-up/confirmation flow; beyond the read-only card shipped in #13 | parked — nice-to-have, post-slice |
| 2026-06-07 | **Volume-neutral reliability scoring** — the score is a plain *sum* today (#30), so a long good history outscores a short one and a brand-new rookie sits near the bottom of the rank. A per-event average or a confidence-weighted blend would treat tenure and freshness more fairly | Spink shouldn't have to babysit a good rookie up the list; a 3-trip newcomer who nails all 3 arguably beats a 200-trip vet who's slipping | Picking sum-vs-average changes the *meaning* of the number and wants real per-crew volumes to calibrate against (Pass-A payoff); "good enough" sum ships in #30 with a neutral-0 cold start so rookies start mid-pool, not at the floor | parked — sum for v1, revisit with real data |
| 2026-06-07 | **Inverse-exponential bail-lateness penalty** — the bail penalty scales *linearly* in `latenessMs` today (#30). The real curve is steep near call time: a bail a week out is nearly forgivable, an hour-before bail is catastrophic, and the penalty should ramp non-linearly as call time approaches | Linear under-penalizes the truly last-minute bail relative to a merely-early one; the dock-side reality is sharply non-linear | Needs a chosen curve + constants to tune, and real lateness data to calibrate; the linear `bailLatenessPerHour` lever in #30 is the clean interim and already makes late > early | parked — linear for v1 |
| 2026-06-11 (Drew) | **Smart same-day booking — oracle-gated open times + request-a-grey-slot** — same-day booking surfaces *only* times the oracle confirms are crewable; a grey-area slot (no confirmed crew yet) becomes a customer **"request this time"** that fires an ask to crew to see who bites | Best-aligned of Drew's batch: it *is* the open-slots view (oracle `first-fail`, §1.3) plus an **inverted ask** — customer demand triggers a crew sounding instead of the operator initiating. Reuses the oracle + the channel port wholesale | The inverted ask is net-new flow (a customer-originated `ask` with no shift yet) and the public-facing booking surface is portal-era; the request→ping leg also wants an SLA so a customer isn't left hanging on silence | parked — on-thesis, build when same-day demand + portal land |
| 2026-06-11 (Drew) | **24h airline-style customer check-in** — a day-before customer "check in" that confirms they're coming, the directions, and arrival time — distinct from crew call-time | Cuts no-shows and dock confusion; SPEC §1.3 already names a "waiver (check-in gate)" concept the check-in could carry | Customer-facing → portal-era; needs guest contact (see no-contact gap below) and a check-in state on the reservation | parked — portal-era |
| 2026-06-11 (Drew) | **Guest-facing booking page + the no-contact gap** — each customer gets their own shareable booking URL (directions, parking, weather, notes, **messages from office/crew**); core insight is guests get **no alerts from us because Muster holds no guest contact** (Xola does) | The contact gap is real *today*, and SPEC §2.2 already carries reservation phone — so guest comms is partly feasible pre-portal; overlaps the parked customer portal (§4) and the booking-modification writeup below | The full self-serve page is the parked portal; doing it sooner means owning guest comms (opt-in, unsubscribe) the product currently leaves to Xola | parked — portal-era; the contact gap is the part worth solving early |
| 2026-06-11 (Drew) | **Two-way / multi-party messaging** — generalize the one-way crew **ask** into threads: office↔crew, and office-**overseen** crew↔client | Natural extension of the channel port (DEC-MSG-3) and day-cohort messaging (§4); operators already want to reach crew off the ask path | Two-way + oversight drags in moderation, audit, and read-state machinery the one-way ask deliberately avoids; the client leg is portal-era. Keep the ask port single-purpose until this is actually next | parked — post-portal |
| 2026-06-11 (Drew) | **AI phone concierge (inbound, full-context)** — a phone number a customer calls that an AI bot answers from directions / weather / live availability / their booking state | The inbound-customer cousin of the parked **AI captain-phone-call agent ★** (§4); genuinely useful for a semi-retired operator who doesn't want to field calls | Garnish, not spine — it can only answer from data surfaces that must exist first (availability, booking state, the guest page above); phase-B at the earliest | parked — phase-B garnish |
| 2026-06-11 (Drew) | **Crew location tracking / live boat position** — see a crew member's location while they're using the app, to answer "customer says they don't see the boat — Liam's 5 min out" | Real operational value for the dock-side mystery; the boat's position *is* the crew's phone | ⚠️ **Riskiest in the batch.** Continuous background location is a privacy + consent + battery + platform-permission landmine, and it inverts the crew app's "insultingly small, no-babysitting, every screen is where bullshit hides" stance (§2.6). Would need explicit per-shift opt-in, foreground-only / on-demand ("ping location now"), and a hard retention limit — never silent always-on tracking | parked — only behind a strong consent guardrail, if ever |
| 2026-06-11 (Drew) | **Boat-management suite (adjacent domain — out of current thesis)** — sea-time tracking, captain's log w/ fuel/oil low-fluid alerts, per-vessel ops notes ("starboard light out, use the battery light"), consumables inventory (ice, towels, cleaner) | All real operator needs; **sea-time tracking** has a thread into the core (it's a byproduct of `Completed` shifts and feeds crew credentialing) | This is **vessel operations, a different product** from the crew engine — Muster's thesis is "who's standing on the dock," not "is the boat maintained/stocked." Logged as one line, not four, to stay visible without implying a roadmap. Sea-time is the only piece worth pulling forward, and only once `Completed` shifts log hours | parked — different domain; revisit sea-time only |

---

## Writeup — Booking modification: party-size change with possible vessel reassignment

**Provenance:** surfaced while reviewing the real Xola export — a party-size change that pushes a
booking past a vessel's COI max is a live, real case, not a hypothetical.

**Why it's not net-new architecture:** a party-size change is a **re-query of the oracle against a
modified hypothetical world** (oracle §7, generalized from "if this booking existed" to "if this
booking changed"). The pax rule re-runs; it may fail the current vessel's COI max; that may force a
**vessel reassignment**; reassignment re-derives required seats; the **horizon** (§1.3) then says
whether the new arrangement is crewable in time. Every organ already exists. What's missing is the
*surface* that drives the re-query and the *decision* it produces (update / decline) — plus, for the
self-serve tier, customer comms.

### Tier 1 — scheduler-mediated (the honest first build)
A new operator user story:
1. Customer calls the scheduler to request a change (more/fewer passengers).
2. Scheduler opens the **event / trip dashboard** (Event Admin §2.2, or a modify view on it) and
   enters the proposed new party size.
3. System **re-queries the oracle** for the modified booking:
   - pax still within current vessel COI max → simple update.
   - pax exceeds it → oracle proposes **vessel reassignment** (which vessel can take it), and the
     **horizon** determines whether the reassigned vessel can be **crewed in time** (re-derived seats
     vs. staffing horizon).
4. Verdict surfaces as **Update or Decline** — scheduler acts:
   - **Update:** booking moves (possibly to a new vessel → possibly a new/changed shift → crew
     re-evaluation via the existing seat machine).
   - **Decline:** not possible (no vessel / can't crew in the window) — scheduler tells the customer.

### Tier 2 — customer self-serve (portal-era)
The same flow, customer-initiated online: customer requests the change → oracle evaluates → system
responds **update or decline** without a human in the loop (auto-approve when trivially crewable,
route to scheduler when it forces reassignment near the horizon). This is the **self-reschedule /
modify** item already in the customer-portal sketch (Tier 3 there) — explicitly portal-dependent.

### What it reuses vs. what's new
- **Reuses:** the oracle (re-query, collect-all mode for the diagnosis), the pax/COI rule, vessel
  reassignment logic, seat re-derivation, the horizon, the shift state machine (a reassignment is a
  shift change → crew re-evaluation, same edges as a late booking joining/leaving).
- **New:** a *modify* surface on the trip/event dashboard; the update-or-decline decision UI; for
  Tier 2, customer-facing comms + the auto-vs-route policy.
- **Watch:** a reassignment that drops/moves a booking has the **same cascade shape** as a cancel
  (it can strand the old shift's crewing or change pax on two shifts at once) — reuse the
  reconciliation/nudge logic, don't reinvent it.

### Trigger / when to build
Post-slice. Tier 1 becomes worth building once shifts form and crew from real bookings and the
operator is fielding real change requests (it's a scheduler-efficiency feature, not slice spine).
Tier 2 waits on the customer portal (Tier 4 / 2027). Promote to a SPEC v1.1 modify-flow section only
when Tier 1 is actually next on the build, not before.

---

## Explicit "pause automation" toggle on the cockpit (parked 2026-06-11, DEC-027 §2)

SPEC §2.4 asked whether the cockpit needs a per-shift "pause automation, I've got this" toggle or
whether any manual action implicitly pauses the bots. The build confirmed the implicit answer is
**emergent**: `escalate` only fires on a stalled shift with no live asks, every manual assign/nudge
creates a live ask, and Tier-1 broadcast fires only at the `Pending→Filling` birth — the autonomous
tier cannot fight a manual placement today. So v1 ships no pause flag, no resume button.

### What it would be
A persisted per-shift `automationPaused` flag + `tick`/`escalate` honoring it + an explicit resume
action (the mockup's posture bar: "You're driving / Resume automation").

### Trigger / when to build
The moment the automation gains a lever that can act on a seat carrying a live manual ask —
e.g. auto-expiry + auto-re-broadcast inside `tick`, or any future move that supersedes a pending
ask. At that point implicit-pause stops being emergent and needs the flag.

---

*Rule of thumb before promoting anything here into a spec v1.1: has the single-horizon vertical
slice run a real BrewBoat weekend yet? If no, the answer is "still parked."*
