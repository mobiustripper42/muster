---
id: DEC-153
title: "Cancel and refund from Muster — the operator keeps the discretion, both routes reconcile, and cancelling releases the event not just the reservation"
topic: "Reservations & payments"
amends_spec:
  - section: "3.3"
    scope: "the STATUS claim only — \"nothing in `src/` implements a cascade or a refund\" is no longer true, and neither is §0.2's reading that the whole refund surface is parked. The cascade's own design is untouched and still unbuilt: shift-level cancel from the At-Risk board, the per-booking fan-out, rebook-or-credit offered before cash, and the customer notification all stand exactly as written. What exists now is reservation-level cancel + refund from the calendar detail pane, which supplies §3.3's step 1 (the policy function, `refund-terms.ts`), its step 2 (operator-initiated ⇒ full refund) and half of step 4 (issue the refund, set the booking to Cancelled) for ONE booking at a time, with no fan-out and no customer notice"
---

## DEC-153: Cancel and refund from Muster — the operator keeps the discretion, both routes reconcile, and cancelling releases the event not just the reservation

**See also** — decisions this one changed part of:
- Revises DEC-107 — the refund MECHANISM only — its 2026-07-18 amendment's closing line, "Still manual (unchanged): every OTHER refund — operator-discretion cancels". Refunds stay operator-discretion; what changes is that the discretion can now be exercised in Muster, and a refund taken in the Stripe dashboard reconciles back instead of being invisible. Everything else in DEC-107 stands untouched: hosted Checkout, the deposit/balance model, the webhook-driven write, `balanceOwedCents` as the one balance authority, the DEC-109 residual-race auto-refund, and the §3.3 refund CASCADE staying parked

**Status:** Accepted (operator, 2026-08-10). Issue #616, which consolidates the action halves of #459 / #464 / #465.

**Decision:** Three things, and the third is the one that was not obvious.

1. **Cancel is an operator action in Muster**, from the reservation detail pane. It writes `status: "cancelled"` on the reservation **and on its Muster event**, then re-forms shifts and relays the crew notices.
2. **Refund is a separate, deliberate action** against an **editable amount**. The published terms compute a suggestion; they do not decide.
3. **`charge.refunded` is handled**, so a refund the operator takes in the Stripe dashboard — the thing every doc has told them to do — reaches the ledger.

### What was actually broken

Nothing in the product ever wrote `status: "cancelled"` on a reservation. The only `saveReservation` caller was the Xola importer. The pane said so about itself: *"NO actions in this slice (message / guests / change time / resend / refund / cancel all defer)."* The customer-facing "cancel" on `/reservations/manage` composes an **email** and persists nothing.

The ledger half was worse. `parseEvent` handled two event types. A dashboard refund was invisible: the reservation still read paid, the slot still held a boat, `balanceOwedCents` still billed the balance, `/admin/purchases` still counted the revenue.

### Cancelling the reservation does not free the boat

This is the finding the task turned on, and it is not visible from the reservation row.

Marking the reservation cancelled releases **its own slot** for re-sale — the claim check filters `status='booked'`. It releases nothing else:

- **The neighbouring departures stay blocked.** `hull-busy` and the overlap guard in `saveBookingIfSlotFree` count every event whose status is `scheduled`. A cancelled 13:30 booking keeps 14:00 unsellable on that hull, for a trip that is not happening.
- **The crew stay rostered.** `formShifts` collapses a shift to `Cancelled` only when *every* event on the vessel-day has cancelled. Leave the event scheduled and nobody is told the boat is not sailing.

So the event is cancelled too — which is exactly what the importer already does on the Xola side when a trip loses its last live booking. The Postgres test asserts both directions, because only the second half fails if you get this wrong, and the two halves are governed by different predicates on different rows.

### …and cancelling the event bricks the slot, unless the claim path resurrects it

`events_muster_slot_identity` is `on events (vessel_id, date, time) where source='muster'` — **status-agnostic**. A cancelled row keeps owning its slot identity, so the re-booking insert conflicts into a no-op, the `status='scheduled'` select finds nothing, and `saveBookingIfSlotFree` returns `lost` **forever**. Cancelling a booking would permanently destroy its boat-slot: the precise opposite of the point.

`saveBookingIfSlotFree` now re-materializes a cancelled row in place, inside the transaction that already holds the hull-day advisory lock. It carries the NEW booking's frozen `price`, `capacity` and `duration_minutes` (the previous customer's fare is not this customer's, DEC-125) and deliberately leaves `dock` alone, which belongs to the slot rather than the booking.

**The in-memory double could not have caught this and would have hidden it.** Its slot lookup filters on `scheduled`, misses the cancelled row, and then `#events.set(event.id, …)` overwrites it — accidentally correct whenever the deterministic id matches, and silently wrong for an operator override row carrying a different id, which it would leave in place while adding a second event at the same identity. That is a state the database index makes impossible. Same DEC-131 trap as #613: a green unit suite over a production-only failure. The double now resurrects explicitly.

### One amount, split across charges — because there is no total at Stripe

The operator types **one** editable figure. The first design refunded per payment row; the operator's objection was direct: *"cancel for so many reasons and who knows what the refund amount might be"*, and a per-row press pushes the allocation problem onto the person least able to solve it mid-cancellation.

But the figure cannot be refunded as a figure. Money arrived as separate charges — a deposit booking is two PaymentIntents, potentially two cards — `refund()` takes a `paymentIntentId`, and Stripe caps each refund at that charge's own amount. **The split is the translation, not a modelling choice.** Newest charge first, because unwinding in reverse of arrival is the only order an operator can predict without being shown it. In full-payment mode it does nothing.

The whole allocation is **planned and validated before any money moves** — enough refundable money, a PaymentIntent on every row it must draw from — so an impossible request is refused whole rather than discovered halfway with two refunds issued.

### The quote is conservative; the ceiling is real

Two different numbers, deliberately:

- **The prefill** is what the published terms owe — `SPEC.md` §2.8.4c.
- **The cap** is Stripe's real ceiling, `amountCents − refundedCents`. An operator who *chooses* to return more than the terms owe must be able to.


### Who cancelled is the discriminator, not when

The confirm screen asks *the customer asked* vs *we cancelled*, and **renders both figures next to their option**. With no client JS a single number could not follow the radio, and a figure silently belonging to the other choice is worse than none on a screen whose only job is deciding an amount.

The amounts are `SPEC.md` §2.8.4c. **What matters here is that the two branches are separate functions** — `refundOwedCents` and `operatorCancelRefundCents` — so no caller can reach the fee path by passing the wrong notice. Who cancelled decides which function runs; the notice only ever decides an amount inside one of them.

**The answer is not persisted.** `Reservation` has no cancellation-reason field and this task does not add one; the refund amount is the only record of which branch ran. Filed rather than smuggled in as a schema change.

### The double-submit is a money bug, and idempotency keys do not fix it

Stripe's idempotency key makes a *retry of one computed allocation* safe. It does nothing for a second press: that press computes a different cumulative total, keys differently, and is a genuine second refund. A disabled button is not a guard either — a no-JS form posts twice.

So the form carries the refunded total **it was rendered against**, and the action refuses when the ledger has moved. A compare-and-swap on money, the same posture as every other claim in this codebase. A malformed token is treated as stale, never as zero: reading it as zero would disarm the guard on exactly the path that needs it.

### `charge.refunded`, and why cumulative is the whole trick

Stripe's `charge.amount_refunded` is the charge's **cumulative** refunded total, which is already the contract `markPaymentRefunded(id, refundedTotalCents)` took. So redelivery, a second partial refund, and Muster's own refund arriving back through the webhook are all the *same write*, made idempotent by `greatest()` rather than by a guard.

Keyed on the PaymentIntent, not the charge: `Payment` records `stripePaymentIntentId` on both the hosted and the Elements path and has never carried a charge id. That needed `getPaymentByIntentId` and an index — `payments` had exactly one, on `reservation_id`, so the lookup would have been a sequential scan on the webhook hot path once per refund.

It is handled **outside the RESERVATIONS gate**, for the reason the gate was moved off the whole handler at #588: money that has already moved must be recorded in every deployment, flag on or off.

**Deployment dependency, and it is silent if missed:** the Stripe endpoint must subscribe to `charge.refunded`. None of this fires otherwise, and nothing in the repo can verify it (#544).

### Cancelling and refunding are ONE press, and the amount is an override

The first cut made them two deliberate actions: cancel, then refund, on the reasoning that
cancelling and moving money are different decisions. In use that was wrong, and the operator said
why — the two published-terms figures sit on the cancel confirm, and *"the $110 and $160 don't
really mean anything here anymore"* because the press that spends them happened on a later screen,
below the fold. A number shown at the moment of a decision it does not affect is worse than no
number.

So one press does both. The staging was the problem, not the separation: **refund remains a
standalone control** for the case that has nothing to do with cancelling — a goodwill partial on a
trip that is still sailing.

**The amount field is an OVERRIDE, not a prefill, and that is a correctness argument rather than a
style one.** The figure differs by reason ($50 fee or not), and with no client JS a prefilled box
cannot follow the radio. A prefill would mean: pick "We cancelled", fail to retype, and refund at
the customer rate from a field that looked already-correct. Blank has no wrong value to carry — it
means "compute the figure for the reason actually posted", server-side, from the same
`quoteCancelRefund` that rendered the labels. Typing is a deliberate override; `0` cancels without
refunding, which is a real outcome inside the 14-day window rather than a validation error.

**A client island fills the box, and nothing depends on it (DEC-147 rule 2).** `RefundAmountSync`
writes the figure for the selected radio and follows a change, so the operator sees what they are
about to send. It only ever writes the value the server would compute anyway, it retires itself
the moment a key is pressed in the field, and with JS off the box stays blank and the server path
is the one described above. An e2e runs the whole cancel with `javaScriptEnabled: false` to prove
that, rather than asserting it.

**Ordering: the cancellation is committed first and is never rolled back if the refund fails.**
Freeing the boat and telling the crew is the urgent half and is correct standing alone; money that
did not move can move on the next press, from a page that now shows what is still owed. The
reverse would leave a refunded customer holding a boat.

### Where the destructive control sits (DEC-152 applied)

The cancel confirm renders **last** in the actions block, below refund and resend. Measured at 375px, the first arrangement put "Resend confirmation" 8px into the coordinates "Cancel this booking" had just occupied — the #718 defect exactly, in a place where the second tap fires a different action against a booking that was just cancelled. Ordering the destructive block last means collapsing it moves nothing above it. An e2e asserts no interactive control overlaps the press point.

### Still parked

The **§3.3 cancel cascade** — shift-level cancel from the At-Risk board, rebook-or-credit offered before cash, the customer notification — is untouched and unbuilt. This is reservation-level cancel from the calendar. **Disputes (`charge.dispute.*`) and `payment_intent.payment_failed`** are named in #616's problem statement, absent from its acceptance, and filed separately: a dispute is an evidence-and-deadline workflow, not a refund variant.

## Amendment, 2026-08-21 (eric) — the prefill's gratuity/service-fee carve-out was wrong when written; the published terms deduct the $50 and nothing else

**What this changes:** the two bullets under *"The quote is conservative; the ceiling is real"* — the carve-out and the under-quoting argument that justified it. **What still stands:** everything else, and that is most of this decision. One editable figure split newest-charge-first across PaymentIntents; plan-and-validate before any money moves; who-cancelled as the discriminator with both figures rendered next to their radio; the cap at Stripe's real ceiling; the answer not persisted at #616 (added since, #724); the ordering that commits the cancellation first; the destructive control last. DEC-124 also stands untouched — a tip is still crew money.

**The published policy is `SPEC.md` §2.8.4c, and it names exactly one deduction.** The prefill deducted three — the gratuity, the service fee, and then the fee on the customer branch — so on the reported booking (#797) a weather cancel quoted $620.98 against $754.15 paid.

**This was not made wrong by a later change; it contradicted its own document on the day it was written.** Nine lines below the carve-out bullet, this decision records `operatorCancelRefundCents` as *"everything, at any notice"*, and SPEC.md §3.3 step 2 says *"principled default = full refund."* The two cannot both be true of one screen. `refundableCents` was the faithful implementation of the wrong one, and `operatorCancelRefundCents`'s own docstring — correct about the policy, describing an input it never received — is what the contradiction looked like in code.

**The under-quoting argument goes with it.** *"Under-quoting produces a complaint; over-quoting silently spends someone else's money. Only one of those is recoverable."* That trade is real when the amount is discretionary. It is not available where we have published the figure: under-quoting there is a term we do not honour, and because the prefill is what gets accepted without retyping, the shortfall is the default rather than the edge. A tip taken at checkout for a trip that never sailed is not pay for work anyone did, on either branch.

**So there is one base for both policies:** everything still refundable, `amountCents − refundedCents` gated on `countsAsPaid` — the same `refundableTotalFor` the cap already used. The quote and the ceiling are now the same number on the operator branch, which is what a full refund means; on the customer branch the quote is that number minus $50, which is what the term says. `refundableCents` is deleted.
