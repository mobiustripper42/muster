---
id: DEC-109
title: "Atomic capacity claim on public booking (the customer-side REQ-CLAIM-1)"
topic: "Reservations & payments"
---

## DEC-109: Atomic capacity claim on public booking (the customer-side REQ-CLAIM-1)

**Status:** Decided 2026-07-11 (@architect, under DEC-105). The correctness hinge on the public side.

**Context.** Selling a seat against COI max is the customer-side twin of REQ-CLAIM-1 (the atomic
first-come seat claim for crew). Two customers checking out the last seats of a boat must not both succeed.

**Decision.** The capacity check at the **webhook booking-write** (DEC-107) is **atomic at the data layer**
— a conditional/transactional claim (row lock / conditional update against remaining capacity), **never**
read-then-write. Contract-tested on both repository adapters, exactly as REQ-CLAIM-1 was for crew seats.
An over-capacity booking whose payment already captured is resolved as a **refund-and-notify** (manual in
Stripe at pilot volume), never a silent oversell. **Revisit if:** overbooking-with-waitlist is ever wanted
(explicitly not now).

**Amendment (2026-07-11, @architect, under DEC-105 — verified reservations model):** the claim **predicate**
is corrected from "remaining ≥ party" to a **whole-boat mutex** — *claim only if the event carries **no**
active `source='muster'` reservation* (and party ≤ `Event.capacity`). The **mechanism is unchanged**:
service-layer conditional/transactional CAS, contract-tested on both adapters, **no DB unique constraint on
`reservations.event_id`** — the schema stays n:1 deliberately, so multi-reservation-per-event is **not
precluded** (a future policy change in this predicate, not a migration) and **not designed for** (operator
directive, 2026-07-11). Only the capacity *function* changed (DEC-108 amendment), not this claim's design.

**Amendment (2026-07-17, operator + S56 — the P12 claim shape; mechanism `@architect`-gated at build):**
Two design changes the mockups forced, plus the answer to the Stripe-timing race.

1. **The customer never picks a boat.** They pick **offering + time + guest count** (never "party" — a
   guest/passenger count). A departure fans out to a *set* of same-time boat-`Event`s; **boat assignment
   happens inside the claim**: enumerate the departure's vessels that fit the guest count → pick one →
   claim it → on loss, fall back to the next fitting vessel → else sold-out. The claim predicate and the
   `(vessel, date, time, source='muster')` identity are unchanged; the new part is the fit-and-fallback
   loop over the departure's boats. **Boat-selection policy** (smallest-that-fits, to keep big hulls for
   big groups, vs largest-free) is an open question for the build pass.

2. **Optimistic 15-min hold + a permanent pessimistic backstop.** Lifted from **sailbook** (proven there).
   On checkout start, place a **15-minute soft hold** on the slot; others see it unavailable, so the common
   case is **collision-free** — the second customer never starts paying. The hold makes the refund-the-loser
   path the *rare* case, not the normal one.
   - **The pessimistic write-time claim NEVER leaves — this is load-bearing.** We cannot enforce the
     timeout *inside* Stripe (no server-side payment deadline), so a hold can expire while a payment is
     still in flight. Only the atomic write-time claim is defeat-proof by timing. The hold is an
     optimization on top of the CAS, never a replacement for it. Do not "optimize away" the backstop.
   - **The residual race** (a hold expires mid-payment, another buyer grabs the freed slot and pays, the
     first payment then completes): both captured money, one wins the atomic claim, the **loser is
     auto-refunded and told the slot sold out while they were paying** — an explicit customer-facing
     message, never a silent oversell. (This makes DEC-107's refund path customer-triggerable here, per
     [[customer-self-refund-reverses-manual]].)
   - **The identity guard applies at BOTH hold-acquire and write** — two buyers can't both acquire the
     same slot's hold, and the write is the final authority.
   - A **customer checkout-hold** (transient soft-reservation, 15 min, lazy-expiry) is a **distinct state**
     from the **admin/vessel hold** (a block-family row, no `Event` — DEC-125). Both subtract from
     availability; they are different rows with different lifetimes. Keep them separate.

**`@architect`-gated at build (NOT solved now):** the hold table shape, expiry handling (lazy-on-read
preferred — a >15-min hold reads as free, no cron), the pg lock strategy (row lock vs partial unique index),
the both-adapters contract, and the refund-on-loss webhook flow. This wants a dedicated pass reading
sailbook's real implementation, not an inline design — it's the highest-risk piece. **Supersedes** the
"Revisit if overbooking-with-waitlist" note only insofar as the waitlist itself stays parked (FUTURE_IDEAS,
DEC-109's own trigger); the hold is not a waitlist.
