---
id: DEC-151
title: "Retire the legacy booking write path rather than guard it — one write path, or the unguarded one outlives the guarded one"
topic: "Reservations & payments"
amends:
  - id: DEC-107
    relation: corrects
    scope: "the `writeBooking` citation only — the hosted-Checkout and deposit/balance decisions stand, and the balance flow it describes is unchanged"
  - id: DEC-122
    relation: corrects
    scope: "the `writeBooking` citation only — the stateless-HMAC capability URL and its non-interference with the race-critical CAS both stand"
  - id: DEC-131
    relation: corrects
    scope: "the named precedent only — a constraint the caller must react to is still exposed through the port as a typed result, which is the holding"
  - id: DEC-132
    relation: corrects
    scope: "the `writeBooking` citation only — booking-path customer linking is still in scope and still happens at the write, now on the surviving path"
---

## DEC-151: Retire the legacy booking write path rather than guard it — one write path, or the unguarded one outlives the guarded one

**Status:** Accepted (operator, 2026-08-08). Issue #693, found by `@code-review` while shipping #615/#691.

**Decision:** the 11.2/11.3 booking write path is **deleted**, not fixed. A Stripe session whose metadata carries an `eventId` instead of a slot is **refused and alerted**, never booked.

### What was there

Two write paths reached a booking. The slot-first path (12.1, DEC-125) materializes a virtual slot and claims it through `saveBookingIfSlotFree`. The legacy path took a pre-existing `Event` id and claimed it through `saveReservationIfUnclaimed`, a whole-boat mutex keyed on one `event_id`.

#615/#691 put the hull-overlap guard **and** the hull-day advisory lock on the slot path. The legacy path never received either. So it still behaved exactly as everything did before #691: two trips overlapping in time on one hull both succeed, silently — a clean reservation is written, so #613's paid-but-unbooked net never fires, and the first anyone knows is two parties at one slip.

### Why deleting beat guarding

Both options were live. Guarding is the smaller diff.

It was **already unreachable**: `createBookingCheckout` was the only producer of legacy-shaped session metadata and had no caller under `app/`. That is exactly what made it worth acting on rather than shrugging at — an **unguarded fallback rather than a removed path**, on the money path, reachable the moment anything started minting a legacy session again, and reverting to the failure #691 exists to close.

The operator's argument settled it: *"why would we keep an unused booking path?"* Guarding leaves two write paths to maintain forever, both needing every future money-path invariant applied twice — and the one nothing exercises is the one that quietly misses the next guard, exactly as it missed this one. Deleting means a future caller has to consciously build a path rather than inherit one.

### What went

- The webhook's `isSlotBooking` fork, replaced by a guard that refuses a slotless session **before** parsing money, and alerts REFUND MANUALLY.
- `createBookingCheckout` and its tests.
- `writeBooking`, `BookingRequest`, `BookingResult`.
- `saveReservationIfUnclaimed` from the port and both adapters, plus its seven contract cases.
- The webhook's anomalous-`unbookable` tail. **TypeScript proved this one dead:** with the legacy path gone, `result` is a `SlotBookingResult` (booked / already / lost), so that branch narrowed to `never`. Its own comment had already said it was "only reachable via the legacy seeded-Event path or a genuinely broken session" — and the broken-session half moved earlier, to the metadata guard, which is the better place for it because it fires before the money is reasoned about rather than after.

### What did NOT go

The DEC-109 whole-boat claim. `saveBookingIfSlotFree` takes the same mutex and adds what the retired one lacked. The guarantee is unchanged; only the number of places implementing it is.

Four tests were **converted rather than deleted**, because their contracts survive:
- the rival-race webhook test now asserts the slot path's *better* behaviour — keyed auto-refund plus a sold-out notice to the customer, where the legacy path only alerted a human to refund by hand;
- the two-buyers Postgres race now contends on the **same slot identity**, which the #691 sibling does not cover (that one contends on two different times against one hull). Same-slot is caught by the partial unique index plus the conditional insert; overlapping-times by the hull-day advisory lock. Different mechanisms, both worth a test;
- the `#613` orphan-payment guard kept its real FK by moving to the surviving deterministic non-booked outcome (a slotless session);
- one test — "paid-but-unbooked (event missing)" — was deleted outright, because a slot booking **materializes** its event, so a missing event is not a failure any more.

### Why this corrects four other decisions

DEC-107, DEC-122, DEC-131 and DEC-132 each cite `writeBooking` or `saveReservationIfUnclaimed` by name. **None of their holdings changed** — the amendments above are scoped to the symbol citations, so a reader who greps a name out of a decision record and finds nothing in the tree lands here instead of concluding the decision is stale. DEC-131's is the one that mattered most: it names `saveReservationIfUnclaimed` as *the precedent* for exposing a constraint as a typed port result. The precedent stands; it is now called `saveBookingIfSlotFree`.

**Touches** DEC-109 (the claim it retires one implementation of), DEC-125 (the slot-first model that replaced it), #613 (the paid-but-unbooked posture the refusal follows), #615/#691 (the guard the legacy path never got).
