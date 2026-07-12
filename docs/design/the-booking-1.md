# The Booking — The Reservation Front Door

Status: draft v0.1 · Reservation-side design artifact. Working name: **Muster**.
Companion to `the-living-link.md` — this is **Phase 0** (the birth) to that doc's Phases 1–3 (the life).
Worked example: BrewBoat.

> **Scope note — this is parked design, not build-now.** Customer-facing side is Tier 4 (SPEC §4,
> off-season 26/27 → 2027). Captured while Xola is in daily use; does not reopen §4 as build work. The
> crew engine (SPEC §1–3) is unaffected.

---

## 1. The reframe: we designed the life, not the birth

The living-link doc starts at *"already booked."* Everything we designed — the move-set, the emit map,
the policy-as-code, the three weather states — happens to a reservation *after* it exists. The one
customer-facing thing with zero design was the front door: how a reservation gets **born**.

This is that door. It is short by design. The whole product's value is what happens *after* booking
(coordination), so the funnel itself is the least clever part — find a slot, say how many, pay, done.
Cleverness in the funnel is how you get Xola.

---

## 2. The whole-boat fork (the load-bearing product decision)

BrewBoat sells **the whole boat to one group** — a private charter, not per-seat tickets. That single
fact shapes the entire funnel: it is *"reserve a slot the boat is free"*, **not** a per-seat ticketing
flow with seat maps, inventory-per-event, or strangers sharing a sailing.

- **v1 — whole-boat only.** One booking = one group = the boat. Party size checks against the COI cap,
  not against remaining seats sold to others.
- **Parked — per-seat / walk-on.** The generalized product eventually wants per-seat booking (public
  trips, strangers filling a boat). That drags in min-pax-to-run and the social-fill mechanic — **same
  parking lot as min-pax** (living-link §8). Not BrewBoat, not v1.

Designing the whole-boat funnel first is correct: it's BrewBoat's real shape, and per-seat is additive
later, not a rewrite of this.

---

## 3. The funnel

A few taps. Each step is a question the **availability oracle** already answers — the funnel is a thin,
friendly face over it (`mode: first-fail` for speed; availability-oracle §3).

```
┌─ 1. PICK A DATE ──────────────────────────────────────────────┐
│  Calendar of bookable slots. THIS is the oracle's customer     │
│  face. (see §4 — provisional state never leaks)                │
└───────────────────────────────────────────────────────────────┘
        ↓
┌─ 2. PICK THE SLOT ────────────────────────────────────────────┐
│  Sat 1:30 / 3:30 / 5:30 — whichever the boat is free.          │
└───────────────────────────────────────────────────────────────┘
        ↓
┌─ 3. PARTY SIZE ───────────────────────────────────────────────┐
│  Against the boat's COI max-pax (oracle pax rule). Whole-boat: │
│  no per-seat inventory. (A future gap-fire-sale markdown would │
│  surface as a discounted slot back in step 1 — flat v1.)       │
└───────────────────────────────────────────────────────────────┘
        ↓
┌─ 4. INSURANCE? ───────────────────────────────────────────────┐
│  $30 / 72-hr selector. The ONE upsell — and it's a policy flag │
│  on the reservation, not a product (living-link §5).           │
└───────────────────────────────────────────────────────────────┘
        ↓
┌─ 5. PAY + CONTACT ────────────────────────────────────────────┐
│  Stripe (full upfront — Drew's lean, still Drew's call).       │
│  Capture name + phone + email = Mary. (Same fields the         │
│  manifest needs — captured once, here.)                        │
└───────────────────────────────────────────────────────────────┘
        ↓
┌─ 6. DONE → THE LIVING LINK ───────────────────────────────────┐
│  The confirmation IS the link. Hand off to the-living-link.md  │
│  Phase 1 (Reserved). Booking ends exactly where life begins.   │
└───────────────────────────────────────────────────────────────┘
```

**Deliberate omission — no waiver in the funnel.** Waivers ride the *shared link* instead (Mary and her
guests sign there, living-link §6). Keeping the waiver out is what keeps booking short *and* lets the
group self-assemble. Mary books in six taps; she does not key in 12 contacts or chase 12 signatures.

---

## 4. The oracle is the customer face — and provisional state never leaks

The calendar (step 1) is literally the oracle run in `first-fail` mode against the customer's candidate
trip. The subtle correctness point:

A July slot booked in **February** is internally **provisional** — property rules pass, crew rules
**defer** (outside the staffing horizon; availability-oracle §4). The booking succeeds, carrying an
internal `recheckBy` date. **The customer never sees any of this.** They see "open" → they book → they
get a clean confirmation. The two-horizon machinery is an operator-side truth; leaking "provisional /
crew TBD" to a customer would be both confusing and a trust leak.

> **Rule:** the funnel shows **bookable / not-bookable**, never the internal `pass / fail / deferred`
> vocabulary. Deferred reads as bookable to the customer; it only matters to the crew engine.

This is also why the funnel needs no new constraint logic: if a slot implies a *new* rule, that rule
goes into the oracle's list (availability-oracle §5), not invented in the funnel. The face stays thin.

---

## 5. Pricing — flat v1, the calendar is where flex would land

- **v1 — flat pricing.** Published per-slot rate. No surge, no markdown.
- **Parked — demand / gap-fire-sale pricing** (Drew, 2026-06-15; logged in `FUTURE_IDEAS.md`). If built,
  it surfaces *here* — a discounted or premium slot renders in the step-1 calendar and step-3 total.
  The funnel is the consumer; the pricing rule would live beside the oracle, same policy/mechanism split.
  > **Flag:** dynamic pricing reverses a recorded *drop* (availability-oracle §5; customer-portal-sketch
  > §2). It's an owner pricing call (Spink + Drew), not a design default. See the FUTURE_IDEAS entry.

---

## 6. What stays dropped (the niche is the moat)

Carried from availability-oracle §5 / customer-portal-sketch §2 — the Xola sprawl deliberately shed, so
the funnel stays six taps:
- No OTA / channel distribution · no QR / ticketing · no POS · no loyalty tiers · no dynamic pricing
  (v1) · **no account** (the link is the credential; booking and managing are the same lever).

---

## 7. Deferred / open

- **Tier 4 / parked** until the crew engine runs a real season (SPEC §4). Captured design, not a build
  trigger.
- **Drew decisions** gating a real build: deposit-vs-full (lean full upfront), exact refund tiers,
  pricing-flex go/no-go (§5).
- **Per-seat / walk-on funnel** (§2) — generalized-product, same parking lot as min-pax / social-fill.
- **Guest-checkout vs. optional account** — lean guest-only (no account); a "see my past trips" account
  is a later optional nicety (customer-portal-sketch §1).
- **Exact contact fields + Stripe element layout** — UI detail, lift the known-good pattern from Xola's
  screens at build (functionality only — not assets/code/CSS).
- **Where insurance sits** — inline step 4 vs. a checkout add-on line — UI detail, later.
