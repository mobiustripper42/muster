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

*Rule of thumb before promoting anything here into a spec v1.1: has the single-horizon vertical
slice run a real BrewBoat weekend yet? If no, the answer is "still parked."*
