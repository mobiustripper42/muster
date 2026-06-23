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

## Max-slice candidates — prioritized index (2026-06-23)

A reading-order *index* over the parking lot below, grouped by feature with a working priority.
The chronological table is still the source of detail (the "why / catch / verdict"); this just says
what's near the top. Priority is Eric's working call, not a commitment — re-rank freely. **The rule
still holds:** nothing here is built until the single-horizon slice has run a real BrewBoat weekend.

### HIGH — next-up max-slice
| Feature | One-liner | Detail |
|---|---|---|
| **Crew time-off / sign-up (availability + blackout)** | Crew state "can't work this weekend" (blackout) or opt in to dates *before* asks, so the oracle pool reflects stated availability and stops firing dead asks | 2026-06-23 row |
| **Shift editor** | First-class edit surface for a formed shift — split/merge, manning/seat tweak, manual compose/override, retime. **UX screen already designed** | 2026-06-23 row |
| **Post-shift report card** | "Shift complete" wrap-up on the card + 8-of-8 attendance capture — closes the card lifecycle and is where reliability data is born | 2026-06-07 ("post-shift state") |
| **Calendar view of reservations / shifts** | Week/month grid — the weekend at a glance | 2026-06-23 row |
| **Filter-by-crew-on-boats** | Cross-shift roster: "show only Liam's boats Saturday" / who's on each boat | 2026-06-23 row |

### MED — strong, not first
| Feature | One-liner | Detail |
|---|---|---|
| **Weekend staffing heatmap** | Boats × slots colored by crewing health — one calm zoom-out, folds calendar + at-risk | 2026-06-23 row |
| **Per-vessel crew qualification gate** | Oracle gates on which boats a crew is checked out on ("Liam isn't on Brew 3") — a correctness hole if missing | 2026-06-23 row |
| **Crew "living link" → My Shifts + iCal feed** | Persistent bookmarkable home + calendar push | 2026-06-19 row |
| **`/admin/shifts` in-flight list + global nav** | Standing path back to a nudged shift's cockpit | 2026-06-19 row |
| **Operator "My shifts" in the admin session** | Spink is captain+operator — stop the two-browser dance | 2026-06-19 row |
| **Import audit — on-screen + DB** | Per-run audit, history browse ([#128](https://github.com/mobiustripper42/muster/issues/128)) | issue #128 |

### LATER — real but parked
| Feature | One-liner | Detail |
|---|---|---|
| **Volume-neutral reliability scoring** | Average / confidence-weighted vs today's plain sum | 2026-06-07 row |
| **Inverse-exponential bail-lateness penalty** | Steep near call time vs today's linear | 2026-06-07 row |
| **Richer call-time model** | Per-vessel prep + transit vs flat 45-min lead | 2026-06-07 row |
| **Booking modification (party-size → reassignment)** | Scheduler-mediated Tier 1; writeup below | parked row + writeup |
| **Smart same-day booking** | Oracle-gated open times + request-a-grey-slot | 2026-06-11 row |
| **"View as crew" render-as** | Operator browses crew surfaces, no cookie swap | DEC-030 writeup |
| **Periodic keep-warm touch** | Light-week "still in touch" — **overlaps the messaging slice** | 2026-06-17 row |
| **12h / 24h time-format preference** | Honor the device clock | 2026-06-18 row |

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
| 2026-06-17 (Eric) | **Periodic crew keep-warm touch** — a regular (weekly?) message to crew who weren't asked/scheduled that week — "didn't need you this week, stay in touch" — so a light week doesn't read as being dropped | Silence is corrosive for an on-call bench; a couple of quiet weeks and crew drift. The reliability log only *sees* a crew member when they're asked, so a never-asked one generates no signal — the touch keeps them both engaged and responsive. Plumbing's already there: the channel port (DEC-MSG-3) + the existing cron (DEC-023 / 5.1) | It's an **unprompted outbound** — a new message *type* distinct from the ask, so it needs a cadence, an opt-out, and a "who counts as untouched this week" query, plus guarding against firing at someone who *was* asked (notification fatigue). The plumbing exists; the policy doesn't. Watch it doesn't erode the "no-noise, every message earns its place" crew-app stance (§2.6) | parked — post-slice; revisit once the pilot shows real light-week patterns |
| 2026-06-15 (Drew) | **Demand-based / gap-fill pricing ⏳** — booking price flexes with demand. Two flavors Drew named: **demand pricing** (popular days/times priced higher) and **gap fire-sale** (an open slot between booked ones marked down close to the trip — 1:30 + 5:30 booked Saturday → the empty 3:30 drops 20%+ by Thursday — to fill the hole) | Grows revenue on the inventory the fleet already has; the gap fire-sale especially turns a dead slot into a discounted-but-filled one rather than an empty departure | **⚠️ Reopens a recorded drop.** "No dynamic pricing" was *deliberately shed* (customer-portal-sketch §2; availability-oracle §5 drop list) — part of the Xola sprawl the product cut. This doesn't kill it; it marks it a **pricing call** (owner domain, like deposit-vs-full and the refund schedule) that would consciously reverse that drop — **Spink + Drew decide, not design.** The gap-fire-sale half is narrower (a markdown rule on stale inventory, not a pricing engine) and could ship without full demand surge | parked — owner pricing decision; consciously reverses a recorded drop |
| 2026-06-18 (Eric) | **Time-format preference (12h ↔ 24h)** — render clock times in the viewer's preferred format; default AM/PM, but honor the device (`Intl…resolvedOptions().hour12`) or a future per-user setting. *(Format only — NOT timezone; vessel-local stays per DEC-032.)* | Eric (and some crew) run 24h devices and read "15:00" faster than "3:00 PM"; matching the device removes a small daily friction | Time is formatted **server-side** today (no device knowledge), so honoring the device needs **client-side** rendering for those time spots — a small architecture wrinkle, not hard. No per-user "settings" surface exists in v1 to hang an explicit preference on | parked — nice-to-have; AM/PM default ships (1.7), revisit with a settings surface |
| 2026-06-18 (Eric) | **Admin navigation — reach an off-board shift's cockpit** — once a shift leaves the At-Risk board (nudged → in-flight) and isn't in the outbox, there's no standing path back to its cockpit; the only link is the **one-shot** lean toast (DEC-026 redirect param), gone after you navigate away | A nudged shift you want to re-check has no entry point — the board correctly hides it (being worked), the breadcrumb only returns to the board, the toast link is ephemeral | Needs a global nav / shift list / search (an "in-flight / being worked" view, or `/admin/shifts`) — a surface v1 deliberately lacks (admin home links only board + outbox; roster/builder are later phases). All current behavior is correct by design | parked — out of slice; revisit when admin nav lands |
| 2026-06-19 (Eric) | **Operator "My shifts" in the admin session** — the operator who's also crew (Spink: captain + operator) can't see their own assignments while signed in as admin; `/crew` is `kind === "crew"`-gated, so today it's two sessions / two browsers. Want it all in one. | Spink is both roles; switching sessions just to check his own My Shifts is daily friction. The data's already there (his `crew-spink` assignments); the outbox already bridges one case (answer your own ask inline) | Admin & crew are deliberately separate sessions (one cookie, one `kind`). Options: a dual-role session, or an admin-side "My shifts" panel that reads the operator's `OPERATOR_CREW_MEMBER_ID` assignments. Keep the role separation honest (don't blur what's an operator action vs a crew action) | parked — quality-of-life; revisit post-slice |
| 2026-06-19 (Eric) | **Crew "living link" → My Shifts (+ calendar feed)** — give each crew member a **persistent** capability-URL that always lands on their current My Shifts (and shift cards): textable, no login, **bookmarkable forever**, always-current. Plus an **iCal / Google calendar feed** off the same link so shifts appear in their phone calendar (push, not pull — they never navigate). Crew *will* need easy re-entry to My Shifts (re-check call time / dock / manifest), and the placeholder root + single-use ask link don't give a durable home. | **The customer side already designed this** — `the-living-link.md` §6, "same capability-URL family as the crew magic-link auth (DEC-020)." So the primitive exists; this is applying the *persistent* flavor to crew. The calendar feed is the strongest re-entry: the shift is already in their calendar. | Today's crew magic link is **single-use** (24h, consumed, prefetch-safe); a living link is a **persistent bearer credential** — forward it and someone sees your shifts (the customer doc accepts that tradeoff; calendar-feed tokens carry it too). Decide token model (rotating? revocable?). **Cheap interim for the pilot:** session-aware root redirect (`/` → `/crew` for a crew session) + "bookmark / add to home screen" — the 14-day session cookie covers active crew until the real thing. | parked — but the re-entry *need* is real for the crew test; do the cheap interim first |
| 2026-06-23 (Eric) | **Crew time-off / sign-up — availability + blackout input** — crew mark "can't work this weekend" (blackout) or opt in to dates *ahead of asks*, so the oracle pool reflects stated availability before it fires | Stops dead asks at the source: today the pool is credential + reliability only, so the engine can ask people who were never going to say yes. Stated availability makes every ask land warmer and the at-risk picture honest earlier | New crew-side surface + a pool filter the oracle honors (an availability gate alongside credentials). Decide hard-exclude vs ranking-deprioritize. Watch it doesn't become a scheduling-app obligation ("now I HAVE to mark off") that erodes the no-babysitting stance (§2.6) | **HIGH** — improves the existing engine, not garnish; build candidate |
| 2026-06-23 (Eric) | **Shift editor** — a first-class edit surface for a formed shift: split/merge, adjust manning/seats, manual compose/override, retime. **The UX screen is already designed** | Consolidates the deferred Pass-C builder bits (split/merge, bulk lock) into one real surface instead of one-off actions; the operator already has the mental model (the screen exists) | Edits cascade into the seat machine + crew re-evaluation (same edges as a late booking / reassignment) — reuse the reconciliation rails, don't reinvent. A manual override that fights the automation wants the parked `automationPaused` lever (DEC-027 §2) once it can act on a seat carrying a live ask | **HIGH** — designed already; build candidate |
| 2026-06-23 (Eric) | **Calendar view of reservations / shifts** — a week/month grid of the weekend's trips + their shifts, read at a glance | The operator's missing "zoom-out": today it's the at-risk board + per-shift cockpit, with no single time-grid of "what's running this weekend." Pairs with the heatmap | A read-model over events + shifts (pure deriver); the work is the surface, not the data. Decide grain (day/week/month) and whether crewing state colors the cells | **HIGH** — named operator ask |
| 2026-06-23 (Eric) | **Filter-by-crew-on-boats** — a cross-shift roster: pick a crew member → see only their boats/shifts this weekend; or read each boat's assigned crew at a glance | Answers "where's Liam Saturday?" / "who's on Brew 3?" — assignment is legible only one-shift-at-a-time in the cockpit today | Pure projection over seats + assignments + shifts; shares the calendar's read-model. No new aggregate | **HIGH** — named operator ask |
| 2026-06-23 (Eric) | **Weekend staffing heatmap** — boats × time-slots colored by crewing health (green/yellow/red), folding calendar + at-risk into one operator home | One screen answers "is the weekend covered?" without walking the board; the board shows *problems*, this shows *the whole field* | Risks becoming the "anxiety dashboard" §2.5 deliberately avoids — keep it a calm zoom-out, not a blinking wall. Derives from the same shift-state read-model as the board | **MED** — composes the named views; build after the calendar lands |
| 2026-06-23 (Eric) | **Per-vessel crew qualification gate** — the oracle gates eligibility on which boats a crew is checked out on ("Liam isn't qualified on Brew 3"), not just credential + reliability | If the engine can ask an unqualified person, that's a correctness hole, not a nicety; real fleets have boat-specific checkouts | **Confirm whether the oracle already models this before building.** Likely a per-crew vessel-qualification field + a pool filter; small if the oracle's pool filter is already pluggable | **MED** — verify-then-build; correctness candidate |

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

## "View as crew" — the operator browsing the crew app as himself (parked 2026-06-11, DEC-030)

The operator is also crew (DEC-030's operator-as-crew clause covers *answering his own asks* inline
in the outbox), but he may also want to BROWSE the crew app as himself — my-shifts, the shift card,
the manifest. Today that means tapping his own crew magic link, which clobbers the admin session
cookie (the session is deliberately single-subject, DEC-020): he'd bounce between identities by
re-tapping links.

### What it would be
A "view as crew" affordance on the admin side — render the crew surfaces for
`OPERATOR_CREW_MEMBER_ID` under the ADMIN session (read-only or fully, to be decided), no cookie
swap. The session stays single-subject; the affordance is a render-as, not a be-as.

### Trigger / when to build
If the cookie-clobber actually bites mid-pilot — i.e. Spink reports whiplash from flipping between
his outbox and his own shift cards. (@architect parked it at 4.1; don't build speculatively.)

---

*Rule of thumb before promoting anything here into a spec v1.1: has the single-horizon vertical
slice run a real BrewBoat weekend yet? If no, the answer is "still parked."*
