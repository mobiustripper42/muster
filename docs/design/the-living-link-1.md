# The Living Link — Customer Coordination Surface

Status: draft v0.1 · Reservation-side design artifact. Working name: **Muster**.
Graduates `customer-portal-sketch.md` (which was a checklist, not a design). Worked example: BrewBoat.

> **Scope note — this is parked design, not build-now.** The customer-facing side is Tier 4
> (SPEC §4, off-season 26/27 → 2027). This doc captures the design while the grievances are fresh and
> Xola is still in daily use; it does **not** reopen §4 as build work. Nothing here ships before the
> crew engine has run a real season. The crew engine (SPEC §1–3) is unaffected.

---

## 1. The reframe: this is not a reservation system

Every booking product treats the reservation as the thing and bolts communication onto the side. The
operator becomes the integration layer between customer, crew, and the booking — retyping, reconciling,
relaying every change by hand. That clerical relay *is* what makes Xola admin hell.

Muster inverts it: **the coordination is the product; the reservation is just the seed it grows from.**
One living record, seen by three parties through different lenses, no party holding a copy — so nothing
needs syncing, and the operator is deleted as the relay.

The test for every screen and flow: if the operator is composing a message, copying a field, or
updating a second screen to say what the first already says, the design has failed. The operator
handles **judgment** (the weather call, an odd request) and never **clerk-work**.

---

## 2. The emit asymmetry (the load-bearing principle)

Communication is something the system **does** — emitted automatically when the record changes — not a
place anyone **goes**. An inbox is admin in a trenchcoat. The three parties are deliberately unequal:

- **Customer** — receives *active* emits (booked, moved, refunded, trip-cancelled), in the operator's
  voice. Never an inbox; a stream of true statements about their own booking.
- **Crew** — read a *live manifest*, not a notification feed. The shift card is always current; they
  pull truth from it. They get an actual **ping only for material day-of changes**.
- **Operator** — receives **nothing**, ever, except the handful of decisions that genuinely require a
  human (§3 human lane).

That asymmetry is the whole product. It is why the operator stops being the relay.

> **Warmth guardrail.** A wall of automated texts reads like Ticketmaster, not like a guy named Eric
> with a boat — and that warmth is part of why people book. Automation eats the *drudgery*; the
> *relationship* stays human. Emits are in the operator's voice; the few genuinely-human moments are
> kept deliberately human, not automated away.

---

## 3. The customer move-set (the spine)

Every customer action re-asks the availability oracle one question — *can the system act on this
alone?* — and a human is needed exactly when the answer is one the system isn't authorized to take.
That set is small and namable. Sorting the moves this way *is* the design; the emit map (§4) and the
human lane both fall out of it.

### System acts — re-asks the oracle, acts, emits, no operator
- **Book** (pick slot · party size · pay · waiver) → confirmation emits
- **Reduce party size** → refund freed seats per policy; manifest count drops
- **Increase party size within the boat's cap** → charge the difference; manifest count rises
- **Self-reschedule to an open slot** *(outside the staffing horizon — §8)* → re-query oracle
- **Cancel, free window** → refund per schedule (§5)
- **Cancel, penalty window** → system states the loss plainly, acts, computes the reduced refund
- **Take a rebook/credit/refund offer** after an operator cancel → slot pick re-queries the oracle
- **Update contact info** → edits the record; the link is theirs
- **No-show** → detected at trip close; policy applies; logged
- **Self-serve FAQ** (parking, what to bring) → static on the link; the question dies unasked
- **Post-trip** (receipt, rebook, tip) → self-serve

### Needs a human — routed once, to one person, in the operator's voice
- **Party size up past the boat's cap** → bigger boat / different time = a reassignment call
- **Refund / policy exception** ("kid's sick, can I get it back?") → judgment
- **"Are we actually sailing?"** → honest status on the link kills most; residual is the captain's call
- **Yes/no special request** (wheelchair, dog aboard, dietary) → can this boat/trip do it?

*Info-only special requests* (anniversary, bringing a cooler) attach to the manifest for crew to see;
nobody gatekeeps them.

Every item in the human lane is judgment or authority. Nothing is clerk-work. That is the thesis holding.

---

## 4. The emit map

*(read the asymmetry in §2 first or the rows look arbitrary)*

| Trigger | Customer | Crew manifest | Crew ping | Operator |
|---|---|---|---|---|
| Book | living link / confirmation | gains booking | — | — |
| Guest signs/pays via shared link | owner: quiet "9 of 13 in" | gains a named guest | — | — |
| Party size down | refund note | count drops | — | — |
| Party size up (within cap) | charge note | count rises | — | — |
| Self-reschedule (outside horizon) | new confirmation | old shift loses / new gains | — | — |
| Cancel, free window | cancellation + (full − fee) | drops | — | — |
| Cancel, penalty window | cancellation + honest reduced number | drops | — | — |
| **Operator moves departure time** | **ping** | updates | **ping** | — |
| **Operator cancels trip** (weather/mech/crew) | **ping + rebook/credit/refund offer** | shift gone | **ping** | — |
| Human-lane decision resolved | the reply emits back | (as applicable) | — | one ping in, reply out |

Only two events ping crew: a departure-time move and a trip cancel. Everything else updates the
manifest silently and crew pull it from the always-current card. Honors the crew-app rule that
information must never split across channels (SPEC §2.6 / §3).

---

## 5. Policy as code (BrewBoat's actual numbers)

Refund is a function, not a hardcoded rule — `refund_owed(who, when, paid, terms)`, consistent with the
oracle's policy/mechanism split. BrewBoat's current schedule, encoded:

- **Customer cancels ≥ 14 days out** → refund **minus $50** flat fee. Free window. System states
  "$150 of $200 — $50 cancellation fee," acts, done.
- **Customer cancels < 14 days, or no-shows** → **$0**, non-refundable. Penalty window. System states it
  plainly, acts. The "but my kid's sick" plea is the *exception* → human lane (§3).
- **Operator cancels** (weather/mechanical/can't-crew) → **full refund**, reschedule-offered-first.
  Confirms the topology default: operator-fault is always customer-whole. Reschedule-first / cash-if-not
  is the credit-first cascade already mapped (payments-topology §3–4).

### Cancellation insurance — a policy *selector*, not a product
$30 buys a **72-hour** free-cancel window in place of the 14-day one. Model it as a boolean on the
reservation that flips which tier `refund_owed` reads — no new machinery, it rides the existing `terms`
argument. (Also a real revenue line otherwise left on the table.)

### Weather is three operator states, not one cancel
The captain's call fans out to three honest outcomes — most systems collapse all three into "cancelled"
and phone-tree the rest:
- **Sails** (light rain, canopy up) → the honest-status answer. "Are we sailing?" reads *yes, rain or
  shine* on the link, **zero operator action**.
- **Delay** → a time-move. Same row as an operator departure-time change (customer ping + crew ping).
  Not a cancel.
- **Cancel** (thunder / lightning / heavy wind) → the full cascade (reschedule-first, refund-if-not).

> Weather is a *signal beside the captain's judgment*, never a gate. Cancelling on every "bad" forecast
> would put the operator out of business. Optional weather data informs the call; it never makes it.

---

## 6. The living link (the centerpiece)

Everything above presumes one object the customer touches: a **link** — textable, no login, no account,
no app. The URL *is* the reservation; the secret token in it *is* the credential (same capability-URL
family as the crew magic-link auth already built — DEC-020). Booking and managing are the same lever:
no portal to find, no code to enter — you open your own link and pull a lever. *This is the thing Xola
structurally cannot copy without tearing out its account model.*

The link is **one object across three temporal phases, with an orthogonal status field, seen through two
role lenses.**

### Phases are temporal; status is a separate field
Earlier framing had "Reserved" and "Confirmed" as phases — wrong. They're *status values* on the same
pre-trip phase. Corrected model:
- **Phases (time):** Reserved → Boarding Pass (day-of) → Receipt (post-trip).
- **Status (orthogonal, flips in any phase):** Confirmed (runs rain or shine) · Weather-call pending ·
  Delayed · Cancelled. Usually just "Confirmed" — BrewBoat sails rain or shine.

### Two role lenses (scoped by which token opened the link)
- **Owner** (Mary — booked it, on the hook, holds the management token): full control + group status.
- **Guest** (a friend Mary shared the link with): self-ID, sign waiver, pay a share, get their own
  boarding pass. **Cannot** manage the booking — that stays Mary's.

The shared link is how the group **assembles itself**: Mary shares one link, each friend opens it,
signs, optionally pays a share, is issued a boarding pass. Mary never keys in 12 contacts. *The shared
link is the group* — the single primitive under both waiver-self-ID and split-pay.

---

### Phase 1 — RESERVED (booked → day-of; the long idle phase)

**Owner view (Mary)**
```
BrewBoat · Sat Jul 18 · 5:00 PM sunset cruise            [ Confirmed ✓ ]
Party of 13 · paid $520

GROUP        9 of 13 signed · $320 of $520 collected
[ Share invite link ]        ← the group assembles through this

MANAGE
[ Change party size ]   [ Reschedule ]   [ Cancel ]
   reschedule/cancel show the refund consequence inline, before you commit

THE DETAILS
Dock: Whiskey Island Marina   [📍 map pin]
What to bring · parking · restroom            (FAQ, static — kills the question)
```

**Guest view (a friend on Mary's link)**
```
You're on Mary's BrewBoat cruise · Sat Jul 18 · 5:00 PM       [ Confirmed ✓ ]

[ Sign waiver ]                     ← turns an anonymous headcount into a name
[ Pay my share — $40 ]   (optional; Mary's already covered the boat)

(no management — this is Mary's booking)
```

Waiver **facilitated, never gated**: signing attaches a name to the manifest; crew see signed vs.
question-mark; a no-waiver guest still boards. A "no-waiver-no-board" gate is a per-operator toggle
shipped *dark* — BrewBoat doesn't want it.

---

### Phase 2 — BOARDING PASS (day-of; the link morphs)

The high-stakes screen. Same bulletproofing the crew card gets (SPEC §2.6.3), customer-side.

```
TODAY · BrewBoat sunset cruise                  [ Sailing — rain or shine ✓ ]
                                                 (or: Weather call by 4:00 PM ·
                                                      Delayed to 5:30 · Cancelled)
⏰ Arrive by 4:45 PM    ·    Departs 5:00 PM     ← arrival ≠ departure, labeled
📍 Whiskey Island Marina  [map pin]
⛵ Captain Eric
🎒 What to bring · where to park

Owner also sees:   11 of 13 signed · 2 still need a waiver
Each guest:        their own pass · tap-to-call the owner
```

The status line answers "are we actually sailing?" before it's asked — the residual unknown is the
captain's, and only that residual ever reaches the human lane.

---

### Phase 3 — RECEIPT (post-trip; the link morphs again)

```
Thanks for sailing! · BrewBoat · Jul 18
[ Receipt — itemized ]
[ Tip the crew ]            → crew-side reliability context (rescue / above-and-beyond)
[ Book us again ]          → one tap; re-queries the oracle for open slots

Owner: full booking receipt   ·   Guest: their own share receipt
```

`Book us again` is the rebook loop — the post-trip link is a warm lead, not a dead end.

---

## 7. Crew-side notes (mostly pointers — crew engine / Pass-D, not customer-side)

Captured here because they surfaced in the same conversation; they do **not** belong to the customer
link and most are parked.

- **Crew volunteering, flavor 1 — "put me down for July 4th"** → **KEEP.** A specific, one-time,
  expiring, untended crew-initiated **soft-hold** (the inbound mirror of the parked Pass-D soft-hold).
  A holiday premium for signed-up-**and**-worked is clean — paid on commitment honored, not on the
  score. → Pass-D parking lot.
- **Crew volunteering, flavor 2 — "I can work every Saturday"** → **KILL.** A crew-maintained standing
  positive-availability declaration — the exact Xola trap (state-machine §9). It rots, and paying for
  the *declaration* inverts the reliability score. The real want is already built: a Saturday regular
  floats up the Saturday pool **on his own** via completed-Saturday history in the score, pinned by the
  operator's manual boost/floor. Derived from what he *did*, never declared. If day-affinity ever
  matters, the *system* infers it from history — crew never type it in.

> Both are crew-side and Pass-D. Capture, don't build. The single-horizon slice runs first.

---

## 8. The one live weld — and what's deferred

### The self-reschedule horizon (the seam between the two halves)
There are **three** customer-facing time cutoffs, and conflating them is the trap:
- **14 days** → refund free-window (money). Drew's policy. Settled.
- **72 hours** → insured refund window (money). Drew's policy. Settled.
- **Staffing horizon** → how late a customer can self-*reschedule* before crew are committed and it
  becomes the operator's call (crew). **The only open one.**

The clean rule: a customer can self-**cancel** any time (system computes the right refund — money is
always handled); self-**reschedule** locks to operator's-call once inside the staffing horizon, because
the reschedule is the move that ripples into committed crew. One number does two jobs — the staffing
horizon is simultaneously the crew-asks trigger and the customer self-move cutoff. *No competitor welds
these because none has a crew engine underneath.*

BrewBoat ≈ **7 days** today ("staff a week out"). Don't hard-set it — watch how 7 days *feels* in the
e2e/pilot weekend, then set it against real feel. If crew drift to committing 2 weeks out, the horizon
moves with them.

### Deferred / open
- The whole thing is **Tier 4 / parked** until the crew engine runs a real season (SPEC §4). This doc is
  captured design, not a build trigger.
- **Drew decisions** still gating a full build: deposit-vs-full, exact refund tiers (14-day/$50 in hand;
  confirm), credit-vs-cash default ordering.
- **Split-pay** mechanics: owner stays firm and the operator is whole at booking; friend-shares are a
  *reimbursement layer* on the shared link, never a trip-state gate (no min-pax smuggled back in).
- **Guest identity persistence** — personal return link vs. device-remembered? Decide at build.
- **Insurance** as a checkout upsell vs. a managed setting — UI detail, later.
- **Min-pax / social-fill** ("needs 2 more — share to save it") — a walk-on-operator feature, **not
  BrewBoat** (single-group charters). Parked for the generalized product.
