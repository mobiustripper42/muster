# Audit — the operator's side of reservations against `docs/SPEC.md` §2.10, §3.3, §3.4

Read-only audit, 2026-11-14. Branch `audit/operator-reservations`, cut from `main` at **`0c4bddf`** (merge of pull request #1264). Nothing under `app/` or `src/` was changed. Probe tests were written as `*.audit-tmp.test.ts`, run with `npm test -- <file>` against the in-memory repository, reproduced below where they show a finding, and deleted. Postgres was not available: every claim about the Postgres adapter says "read, not run".

## 1. Summary

I checked **57 spec rules** from §2.10, §3.3 and §3.4, plus the §2.8 sentences they lean on:

| Outcome | Rules |
|---|---|
| Match | 41 |
| Differ | 8 |
| Not built | 8 |

There are **32 findings**: **1 S1, 5 S2, 19 S3 and 7 S4**. Ten of them are about code that decides something the spec says nothing about.

**The S1 (OR-1).** The customer can still pay while the operator cancels an unpaid phone booking, and the charge lands on the cancelled booking. The money can then only be returned from the Stripe dashboard.

**The S2s:**
- **OR-2:** A block saved over an unpaid phone booking hides the booking from the calendar, reports no conflict, and still lets the customer pay onto the blocked boat.
- **OR-3:** The payment link books and charges a trip that has already sailed.
- **OR-4:** The discount on an existing unpaid booking (DEC-194) is not built. Discounts exist only at booking time.
- **OR-5:** §3.4's dispute alert is not built. There is no deadline, no customer, no stored alert and no evidence attach.
- **OR-6:** "The season, the schedule grid — passes" is unreachable, because no screen offers an off-grid or out-of-season slot.

Known findings from earlier audits are cited by their ledger id and not re-reported.

## 2. Findings, most severe first

### OR-1 — S1 — A payment started while the operator cancels survives the cancel; the customer is charged for a cancelled trip, refundable only in Stripe — **tested**

**Spec.** §2.10.6: "Cancelling an unpaid phone booking, by the operator or by the customer on the link, also cancels any payment the link had started, so a customer mid-approval with their bank can't pay a cancelled trip."

**How the code gets there.**
1. `startPayByLink` reads the row as payable (`src/reservations/pay-by-link.ts:115-116`). It then hands off to `attachPaymentIntent` (`:130`), which calls Stripe's `createPaymentIntent` (`src/reservations/create-departure-payment-intent.ts:512`).
2. Only after Stripe answers does it append the new id, through `repo.recordCheckoutAttempt` (`:545`). That append is unconditional on status: `src/adapters/in-memory-repository.ts:869-878` writes the id even when `row.status !== "pending"`. The Postgres twin at `src/adapters/postgres-repository.ts:1897-1900` was read, not run.
3. The client secret is returned to the customer regardless (`create-departure-payment-intent.ts:547`).
4. Meanwhile `cancelUnpaidPhoneBooking` makes its cancel write (`src/reservations/cancel-reservation.ts:175`). It then re-reads the row once in `retireOpenIntents` (`:194`) and cancels only the ids present at that instant (`:198`).
5. The docstring promises "Re-read after the cancel so an intent minted between the caller's read and the write is included" (`:185-186`). That covers an intent whose id was *appended* before the re-read. It does not cover one whose Stripe call was in flight.

**What happens next.** When the charge settles, the confirm finds the row not pending. The webhook alerts "PAID but NOT booked … REFUND MANUALLY" and records no `Payment` row (`src/reservations/booking-webhook.ts:830-837`, `:851`). The booking pane's refund box therefore has nothing to refund, so the operator has to go to the Stripe dashboard.

The consequence alone is listed, unledgered, as money report §3 item 24. The race that produces it is new.

**Scenario.**
1. Thu 2027-05-13, 2:00pm: Eric books Dana Ruiz by phone for Sat 2027-05-15 3:30pm on Brew 1.
2. 6:41:10pm: Dana presses Pay on `/p/…`.
3. 6:41:11pm: while Stripe is still creating the payment, Eric presses "Cancel this booking" because Dana texted that she can't make it.
4. Dana's screen already holds a payable secret, so she completes 3-D Secure. She is charged $652.94 for a cancelled trip.

The same race applies when the customer cancels in a second tab.

**Probe** (`src/reservations/phone-link.audit-tmp.test.ts`, deleted). The payment port runs the operator cancel inside `createPaymentIntent`, before returning:

```ts
payments.createPaymentIntent = async (input) => {
  await cancelUnpaidPhoneBooking({ repo, now, payments }, row.id, "operator");
  return realCreate(input);
};
const start = await startPayByLink({ repo, payments, now }, row.id);
// then mark the intent succeeded and run confirmBookingFromIntent
```

```
P2 operator cancel result: {"ok":true,"alreadyCancelled":false} intents cancelled so far: []
P2 customer got: {"ok":true,"clientSecret":"pi_fake_1_secret_test","paymentIntentId":"pi_fake_1"} row: cancelled ["pi_fake_1"] live intents: ["pi_fake_1"] cancelled: []
P2 confirm: {"handled":true,"outcome":"unbookable"} alert: PAID but NOT booked - charge pi_fake_1 (65294 usd) ... (not_pending). REFUND MANUALLY ... payments rows: 0 refunds: 0
```

**Severity: S1.** The customer is charged and owed, and no screen can fix it. The window is about as long as a Stripe create call, which could not be measured here.

### OR-2 — S2 — A block saved over an unpaid phone booking hides it from the calendar, reports no conflict, and the customer can still pay onto the blocked boat — **tested**

**Spec.**
- §2.10.2: "`held` | Someone is at the checkout for this slot — a live `pending` reservation".
- §2.10.6: "An operator's booking does not expire, and this holds a boat until a person acts."
- DEC-125, as quoted at `src/reservations/block-impact.ts:9-11`: committed state beats blocks and is surfaced as conflicts, not silently dropped.

**Code.**
- `saveBlockAdmin` reads no reservations at all (`src/admin/block-admin.ts:65-117`).
- `saveVesselHoldAdmin` refuses only a *scheduled `Event`* at the exact slot (`:201-208`). An unpaid phone booking has no Event (§2.10.6, "Until then its Event does not exist"), so a Hold over it also succeeds.
- On the grid, `slotStatus` ranks `blocked` above `held` (`src/reservations/availability.ts:321-325`).
- The phone-booking card, the Unpaid chip and the List row all key on `held` (`app/(admin)/admin/calendar/calendar-view.tsx:1221-1222`, `:905-906`; `calendar-list.tsx:142`), so Dana disappears from the calendar.
- `computeBlockImpact` derives with `blocks: []` and no `asOf` (`block-impact.ts:61-68`). No pending row is live to it, so her slot counts as "removed", not as a conflict.
- When she pays, the flip (`bookPendingIfHullFree`) does not read blocks (in-memory `src/adapters/in-memory-repository.ts:659-790`). In Postgres, blocks appear only in list, save and remove (`postgres-repository.ts:1279-1320`, read, not run). Neither the pay link nor the confirm checks blocks.

**Scenario.**
1. Eric phone-books Dana on Brew 1, Sat 2027-05-15 3:30pm, at 2pm Thursday.
2. Friday 9am, a mechanic finds a fuel leak, and Eric marks Brew 1 out of service for 05-15. The blocks page says "Blocked. 1 departure is off the calendar." and shows no conflict badge.
3. The 05-15 grid shows "Blocked", Unpaid reads 0, and Dana is nowhere on the grid or the List. She can still be found on `/admin/purchases` → Awaiting payment.
4. Friday 7pm, Dana pays. The booking confirms onto the broken boat and a shift forms. Only now does the blocks page show a conflict.

A customer's live 15-minute web checkout behaves the same way (`src/reservations/claim.ts:454-458` names the risk and guards only the retry).

**Probe** (`src/reservations/blocks-slice.audit-tmp.test.ts`, deleted):

```ts
await bookForCustomer(repo, ask /* Dana Ruiz, Brew 1, 2027-05-15 15:30 */, now);
await saveBlockAdmin(repo, { id:"blk-1", kind:"vessel", vesselId:"brew-1", startDate:DATE, endDate:DATE });
computeBlockImpact(blocks[0], {...});
deriveVirtualAvailability({..., asOf: NOW}).map(s => s.status);
await saveVesselHoldAdmin(repo2, { id:"hold-1", vesselId:"brew-1", date:DATE, time:"15:30" });
```

```
block save: {"ok":true,"id":"blk-1"}
impact: {"removedSlots":1,"conflictCount":0,"conflictCents":0}
calendar slot status: [ 'blocked' ]
hold on held slot: {"ok":true,"id":"hold-1"}
```

**Severity: S2.** The operator's calendar and the blocks page say something untrue about a live booking. It is not S1, because the booking is still reachable from `/admin/purchases` and cancellable.

### OR-3 — S2 — The payment link books and charges a trip that has already sailed — **tested**

**Spec.** §2.10.6, operator table: "a departure that has already left | **refuses.** Selling a trip after it sails is a real case for some operators, not for this one." DEC-184 says the same.

**Code.**
- `claim.ts:343` refuses a departed trip only when the booking is written.
- Nothing on the paying side checks it: not `payLinkState` (`src/reservations/pay-by-link.ts:28-38`), not `startPayByLink` (`:111-133`), and not the flip (`src/reservations/write-booking.ts` has no departure test).
- The operator's "Send payment link" (`app/(admin)/admin/calendar/[reservationId]/actions.ts:226-260`) also sends for a past trip.
- A phone booking never lapses (DEC-163) and each link lasts 72 hours, so the window is real.
- `claim.ts:332-334` describes the result itself: the row confirms into a past `Event`, and the trip is sold with no crew.

**Scenario.** Eric books Dana at 8am on Sat 2027-05-15 for that day's 3:30pm. She pays from the text at 10am Sunday. She is charged, a booked Event is written for Saturday, and her confirmation goes out. The operator can refund it from the pane, which is what keeps this at S2.

**Probe output:**

```
P1 start after departure: {"ok":true,...,"paymentIntentId":"pi_fake_1"}
P1 confirm: {"handled":true,"outcome":"booked"} row: booked muster events: [["2027-05-15","15:30","scheduled"]]
```

### OR-4 — S2 — There is no way to discount a booking that already exists; the discount box is only on the booking form — **read**

**Spec.** §2.10.6 (DEC-194): "The operator can discount a booking that has not been paid … Saving it re-freezes the invoice, and it also settles the payment the link may already have started … an unpaid one is lowered to the new amount, and a comp cancels it. The guard is the reservation's status, `pending` versus `booked` … the save resolves the payment's state the way the link's own reuse does (`attachPaymentIntent`)." §2.8.4d says the same: "A discount on an unpaid booking lowers the quote and so the balance."

**Code.**
- The only discount input is `discountCents` on `bookForCustomer` (`src/reservations/operator-booking.ts:43-45,88-89,146`), read from the new-booking form (`app/(admin)/admin/calendar/book-actions.ts:48-49`).
- The pane's server actions are `createBalanceLink`, `cancelPhoneBooking`, `sendPaymentLinkAgain`, `cancelBooking`, `startRefund`, `refundBooking`, `resendConfirmation` and `reissueBookingLink` (`app/(admin)/admin/calendar/[reservationId]/actions.ts:86,177,226,262,313,343,456,563`). None takes a discount.
- `src/ports/repository.ts` has no discount or invoice re-freeze method.
- The pane renders the discount read-only (`reservation-detail-pane.tsx:643,670,692`).

Every clause about the save — the re-freeze, settling the open payment, the race resolution, a discount that turns the booking into a comp and confirms it there and then — therefore has no code behind it. No trail type exists for a discount either (`src/domain/reservation-trail.ts:37-163`).

**Scenario.** Eric books Dana for $500 and the link goes out. Dana calls back and Eric agrees to take $100 off. His only route is to cancel and rebook. That frees Brew 1 in between, so a web customer can take the slot. Dana's first link also opens on a cancelled booking.

**Severity: S2,** because the operator cannot do something §2.10.6 says they can. The plan rows that built 16.5 (issue #1073) covered only the booking-time box. Whether the edit is intended, or the spec paragraph should be narrowed to booking time, is the operator's call (§6).

### OR-5 — S2 — §3.4: a dispute raises an SMS and a ledger mark, but no admin alert with Stripe's deadline or the customer, and no evidence attach — **read**

**Spec.** §3.4: "A dispute creates an **admin alert** with the booking, customer, amount, and **Stripe's deadline**." "Eric can **attach evidence** … from inside the app." Acceptance: "creates a dated admin alert with the deadline visible; Eric can attach evidence without leaving Muster." §3.4 has no deferral marker. `docs/PROJECT_PLAN.md:346,525` park "disputes", and no decision record covers this (`grep -rli "dispute\|chargeback" docs/decisions/` returns DEC-188, DEC-199 and worksheets only).

**What is built.**
- `charge.dispute.*` is parsed (`src/adapters/stripe-payment.ts:477-507`).
- `recordDispute` marks the payment, writes a trail row and sends an SMS to admins via `alertMoneyProblem` (`src/reservations/booking-webhook.ts:1399-1452`; `app/lib/alert.ts:110-119`).
- `/admin/purchases` has a "Disputed" chip (`app/(admin)/admin/purchases/page.tsx:55`), and the pane says "Disputed — money pulled back by the bank" (`reservation-detail-pane.tsx:603-605`).

**What is missing.**
- **Deadline.** `DisputeUpdated` carries no deadline field (`src/ports/payment.ts:199-206`). Nothing in `src/` reads `due_by` or `evidence_details` (grep, non-test files). The SMS says only "RESPOND IN STRIPE before the deadline" (`booking-webhook.ts:1439`).
- **Customer.** The alert names the reservation id only (`:1432-1449`).
- **Dated, stored alert.** A `live` dispute writes no trail row (`DISPUTE_TRAIL_TYPE.live: null`, `:1327-1329`). The derived `dispute_opened` is undated (`src/domain/reservation-trail.ts:203-210`). An inquiry moves no ledger row (`:1367`), so it never reaches the Disputed chip.
- **Evidence attach.** Not built. The code says this is deliberate: "the evidence and the deadlines live in the Stripe dashboard … (issue #723 is deliberately record-only)" (`booking-webhook.ts:1375-1377`).

**Scenario.** Dana disputes $644 for Sat 2027-05-15. Eric gets an SMS with a reservation id and no due date. Nothing in Muster says when the response window closes, and he must leave Muster to answer.

**Severity: S2.** The spec states a capability the code chose not to build. It needs either a decision that amends §3.4 or the build.

### OR-6 — S2 — "The season, the schedule grid — passes" is unreachable from any screen — **read**

**Spec.** §2.10.6, operator table: "the season, the schedule grid | passes". The same section also says "It starts from the calendar click that already exists."

**Code.**
- The write does pass both (`OPERATOR_RULES`, `src/reservations/claim.ts:316-320`).
- But the calendar draws slots only inside the season and on the schedule's days and times (`availability.ts:572-581`).
- The Book pane offers only drawn `available` slots at that boat-time (`app/(admin)/admin/calendar/book-pane.tsx:88-91`). An off-grid date has no card, and a hand-built URL gets "That departure isn't open to book anymore" (`:92-98`).

**Scenario.** On Mon 2027-09-06 a caller wants Tue 2027-09-14 on Brew 1, two weeks after the season ends on 08-31. Eric cannot book it.

**Severity: S2 if the table row is the rule, S4 if "starts from the calendar click" is.** The two sentences cannot both hold today.

### OR-7 — S3 — The `booked` row for a phone sale names no operator; a comp, or a booking whose link reached nobody, records no admin at all — **tested**

**Spec.** §2.10.6: "Who sold it is recorded once, on the trail's `booked` row (`actorKind: admin`)". The trail's own contract goes further: "`admin` with the operator's id when they sold it" (`src/domain/reservation-trail.ts:49-50`, `:186-187`).

**Code.**
- Both `booked` writes set `actorKind: result.soldBy` with no `actorId`: the comp at `src/reservations/confirm-booking.ts:118-124`, and the paid path at `src/reservations/booking-webhook.ts:873-886`.
- `ConfirmResult.soldBy` is `"admin" | "customer"` only (`write-booking.ts:35,189`).
- `bookPhoneReservation` holds `subject.id` and writes no trail row (`app/(admin)/admin/calendar/book-actions.ts:36-126`), and `Reservation` has no created-by field.
- The only row with the operator's id is `payment_link_sent`, written only when a channel reads `sent` (`app/lib/payment-link.ts:63-78`), and never for a comp (`book-actions.ts:75-91`).

**Scenario.** Eric and a second admin share the phone. Eric comps Dana's Sat 2027-05-15 trip. The History reads "Booked · Operator", and nothing anywhere says which admin gave away a $500 trip.

**Probe output:**

```
P1 booked row: {"id":"booked:resv-comp","reservationId":"resv-comp","actorKind":"admin","type":"booked","metadata":{"via":"comp"},...}   ← no actorId
P3 trail after phone booking paid: [{"type":"booked","actorKind":"admin","actorId":null}]
```

### OR-8 — S3 — No screen shows which admin did anything — **read** (spec silent)

Every operator trail row except `booked` stores `actorId: subject.id`. Both renderers print only `TRAIL_ACTOR_LABEL[actorKind]`, "Operator": `src/admin/reservation-trail-list.ts:121`, `components/admin/trail-row.tsx:73` (the feed) and `:132` (the pane). The `/admin/booking-audit` "Who" filter is by kind only (`app/(admin)/admin/booking-audit/page.tsx:151-158`). The crew-side audit resolves the admin's name (`src/admin/audit-trail.ts:136-139`), so a reader expects the same here. Two admins are indistinguishable on every screen.

### OR-9 — S3 — "Booked by phone" rests on one swallowed write and one fallible read; either failure makes the pane say "Booked online" — **tested** (write), **read** (read)

**Spec.** §2.10.6: "where the booking's pane reads 'Booked by phone' once it is paid".

**Why it is fragile.** The confirm flips `admin` to `muster`, so the trail's `booked` row is the only place the fact survives.
- **The write.** `recordTrail` catches and logs (`src/reservations/trail.ts:56-66`, deliberate per its docstring), and it runs after the flip has committed. A redelivered webhook takes the `already` branch and never re-emits it (`booking-webhook.ts:860-872`).
- **The read.** The pane does `soldByPhone: trail ? soldByPhone(trail) : false` (`app/(admin)/admin/calendar/[reservationId]/page.tsx:477`). The fallback is `HOW_BOOKED[source]`, which is "Booked online" (`reservation-detail-pane.tsx:396-409`). A failed trail read therefore asserts the wrong channel instead of leaving it out.

The same swallow can lose which admin cancelled (`src/reservations/operator-cancel.ts:131-141`) or refunded (`:279-295`; `actions.ts:423-434`). `Reservation.cancelledBy` stores only the policy answer.

**Probe** (P4): `repo.appendTrailEvent` throws, then `confirmCompedBooking` runs.

```
[reservation-trail] could not record booked:resv-flaky — the fact happened, the trail did not get it Error: db blip
P4 status/source: booked muster soldByPhone: false trail types: [ 'confirmation_sent' ]
```

### OR-10 — S3 — Creating, editing or lifting a boat-out or closure leaves no record; lifting a hold from `/admin/blocks` writes no `slot_released` — **read**

**Spec.** §2.10.3 makes blocks the operator's deliberate acts, and DEC-184 says "A block is somebody's deliberate act".

**Code.**
- `saveBlock` and `liftBlock` (`app/(admin)/admin/blocks/actions.ts:30-113`) write no trail row.
- Lift is a hard delete (`postgres-repository.ts:1318-1320`), and an edit is an in-place upsert (`:1299-1302`).
- Only the calendar's hold and release write `slot_held` / `slot_released` with the admin's id (`app/(admin)/admin/calendar/actions.ts:68-82,108-121`).
- `liftBlock` → `removeBlockAdmin` deletes any kind, holds included (`src/admin/block-admin.ts:131-140`). So the same hold lifted from `/admin/blocks` leaves no `slot_released`.
- The `slot_held` row carries no block id, and stores the slot in repurposed fields (`wantedVesselId`, plus `reason` = "date time").

**Scenario.** A Sat 05-15 river closure is lifted at 11am and a sale lands on the water that afternoon. Nothing records who lifted it or when.

### OR-11 — S3 — A comp reads "unpaid" on `/admin/purchases`, the bucket the code itself defines as a defect — **tested**

**Spec.** §2.10.5: "what was paid, what was refunded, what is still owed". DEC-194 has a comp confirm without a payment.

**Code.**
- `stateOf` returns `"unpaid"` whenever `paidCents <= 0` on a booked row (`src/reservations/purchases-view.ts:130`).
- The same file defines `unpaid` as a booked row "whose payment never landed — a defect" (`:26-34`).
- The pane meanwhile says Booked, Paid $0.00, Owes "Settled" (`reservation-detail-pane.tsx:390-394,622-627`).

**Effect.** The Unpaid chip mixes intended comps with real lost-webhook defects.

**Probe:** `P1 purchases: unpaid 0 0 0`.

### OR-12 — S3 — Any refund at all turns a live, paid booking "refunded" in red — **tested**

`stateOf` puts `if (refundedCents > 0) return "refunded"` ahead of paid (`purchases-view.ts:129`). The amount refunded is computed (`:174`) but never rendered (`app/(admin)/admin/purchases/page.tsx:240-290`).

**Scenario.** Eric gives Dana a $50 goodwill refund on a $685 paid trip that is still going ahead. The row reads "refunded" in red, which looks like a full refund, and the trip drops out of the Paid filter.

**Probe:** `P2 purchases: refunded 54000 68500 5000 0`.

### OR-13 — S3 — An "Awaiting payment" row's Total is not what the link asks for — **tested**

**Spec.** §2.10.6: "its total off the frozen invoice".

**Code.** For a row with no Event, `orderTotal` returns `chargedFareCents(inv) + inv.taxCents` (`purchases-view.ts:145-147`). That leaves out the service fee, the tip and the insurance, although the invoice carries `totalCents` and `amountDueNowCents` (`src/domain/entities.ts:835-849`). The footer, "Total is fare + extra guests + tax. Tips aren't included" (`page.tsx:297`), labels the column but does not mention the fee or the insurance.

**Scenario.** Working the chase list the spec describes ("watches the purchases list"), Eric calls Dana about **$540.00**. Her link and the pane say **$685.00**.

**Probe:** `P3 purchases: awaiting Total 54000 link asks 68500`.

**Severity: S3.** The column is labelled, and it is the same fare-plus-tax figure every row uses, but it is misleading on the one list this workflow depends on.

### OR-14 — S3 — Customer lifetime value ignores the discount; a comp counts as $500 of revenue — **tested**

`bookingValueCents` is `event.price + extrasCents` (`src/customers/customer-view.ts:46-49`), used by `/admin/customers` and `[customerId]` (`:112-142`). The discount-aware `bookedFareCents` (`src/reservations/discount.ts:139`) is used by purchases and the pane but not here.

**Probe:** `P1 customer: 50000 [ 50000 ]`, while purchases shows 0.

### OR-15 — S3 — Purchases and booking-audit link rows that the pane answers with a 404 — **read**

Purchases links every row to `/admin/calendar/<id>` (`app/(admin)/admin/purchases/page.tsx:250`). The pane calls `notFound()` when there is no Event (`app/(admin)/admin/calendar/[reservationId]/page.tsx:224`), sparing only `source === "admin"` (`:221`).

So every public `pending` row in the Pending chip, live or lapsed (money F13), is a dead link. So is every `/admin/booking-audit` row about such a reservation (`payment_failed`, `hull_contended`, `checkout_details_changed`, `payment_superseded`), via `components/admin/trail-row.tsx:89-97`.

### OR-16 — S3 — Nothing serialises a block against a claim; a block saved mid-claim and the booking both succeed — **tested** (in-memory), Postgres **read, not run**

**Spec.** §2.10.6: "a block | **refuses — unblock it first**".

**Code.** The claim reads blocks first (`claim.ts:357-362,385`). It then writes through `savePendingIfHullFree`, which checks events and pending rows under the hull-day advisory lock but never blocks (`postgres-repository.ts:1740-1774`; in-memory `:792-815`). `saveBlock` takes no lock (`postgres-repository.ts:1283-1317`).

**Probe.** A repository subclass saves the block inside `savePendingIfHullFree`, before calling super. Output: `race: booking ok = true blocks = 1`.

The outcome is OR-2's state. The window is milliseconds, hence S3.

### OR-17 — S3 — A Hold stops only its exact departure time; another offering's overlapping trip on the same boat still sells — **tested** (spec silent on overlap)

**Spec.** §2.10.3: "vessel hold | a single slot | the boat is reserved for something that is not a customer booking".

**Code.** `isSlotBlocked` matches a `vesselHold` on its exact time (`availability.ts:403-406`). The hull-busy checks never read blocks (`src/reservations/hull-busy.ts`; `claim.ts:391-410`). `block-admin.ts:172-175` makes the exact-match choice on purpose for `slot_taken`, but the same rule then governs the sell side.

**Scenario.** Eric holds Brew 1 at 3:30pm on 05-15 for a private event. A second offering runs Brew 1 at 2:30 with a 100-minute trip. Dana books the 2:30, and the boat is out until 4:10, through the hold.

**Probe:** `14:30 booking over held 15:30 ok = true [ '15:30:blocked', '14:30:held' ]`.

### OR-18 — S3 — Block counts count one boat-departure once per offering — **read**

`computeBlockImpact` counts deriver slots, which are per offering (`block-impact.ts:80-91`; `availability.ts:563-567`). The Blocked chip counts per-offering cards (`calendar-view.tsx:566-569,593`).

**Scenario.** Brew 3 at 1:30 is sold by two offerings. Blocking it reads "2" under "Departures blocked" (`app/(admin)/admin/blocks/page.tsx:305`) and "Blocked 2" on the grid, for one boat at one time.

### OR-19 — S3 — The calendar's "All" chip counts departed slots — **read**

**Spec.** §2.10.2 says `departed` "should be counted nowhere."

**Code.** `all: data.slots.length` (`calendar-view.tsx:589`). The other chips exclude `departed`.

**Scenario.** At 6pm on a day with four empty past departures and one open slot, the chip reads "All 5".

### OR-20 — S3 — The block conflict badge is plain text, sums the fare rather than what was paid, and its comment is stale — **read**

- The "⚠ N booked ($X) conflict" tag is not a link (`blocks/page.tsx:366-370`).
- `$X` sums `Event.price`, the fare (`write-booking.ts:152`).
- `block-impact.ts:12-13` says the drill-down waits on a reservation detail page "not built yet", which now exists (`app/(admin)/admin/calendar/[reservationId]/`).

**Scenario.** Eric blocks Brew 2 for 05-14 to 05-16, sees "2 booked ($998) conflict", and has to search the calendar day by day to find who those two are.

### OR-21 — S3 — The operator can cancel a paid trip after it has sailed — **tested** (spec silent)

**Spec.** Silent for the operator. The customer's own cancel refuses a departed trip (money report §4), and §2.8.4c treats a no-show as an outcome ("a no-show | nothing").

**Code.** `cancelReservation` has no time check (`src/reservations/cancel-reservation.ts:240-259`). The pane offers "Cancel booking…" on any non-cancelled booking (`reservation-detail-pane.tsx:922-1016`).

**Probe.** Dana's 2026-10-31 3:30pm booking is cancelled at 2026-11-01 16:00Z.
- `by=operator`: `refunded: 64400`, and the customer is texted "we had to cancel your trip on Sat, Oct 31".
- `by=customer`, the only way to record a no-show: no refund, and the text says "your trip on Sat, Oct 31 at 3:30 PM is cancelled".

**Knock-on effects (read, not run).**
- Payroll counts tips only on booked reservations (`src/admin/gratuity-payroll.ts:125-132`), so the crew lose the tip.
- Before the shift completes, the re-form can text crew that they are off (`src/builder/tick.ts:343-354`; `form-shifts.ts:499-505`).

### OR-22 — S3 — When the customer pays mid-cancel, the operator is told "Try again in a moment" — **tested**

`cancelPhoneBooking` redirects with `cancelErr=now_booked` (`[reservationId]/actions.ts:197`). By then the row is a paid `muster` booking, so the paid pane renders (`page.tsx:221-224`). Its `cancelErr` copy has no `now_booked` case (`reservation-detail-pane.tsx:259-269`). The correct line, "The customer just paid — this is a booking now…" (`phone-booking-actions.tsx:52-53`), cannot be shown.

**Probe:** `actionMessage("cancelErr","now_booked")` → `"Couldn't cancel just now. Try again in a moment."`

**Scenario.** Eric cancels Dana's unpaid booking just as she approves 3-D Secure. He is told it was a transient failure, when she is now booked and charged.

### OR-23 — S3 — "The boat is free again and the crew have been told" prints whether or not either happened — **read**

The line is unconditional (`reservation-detail-pane.tsx:155`). `cancelReservation` swallows a re-form or relay failure (`cancel-reservation.ts:298-324`) and reports a non-release only as an absent `freedEventId` (`:261`). `cancelByOperator` passes neither fact to the pane (`operator-cancel.ts:296`).

### OR-24 — S3 — A comp that failed to confirm says "Reload in a moment"; nothing retries it — **read**

The copy at `reservation-detail-pane.tsx:467-471` reads "The comp was saved but didn't confirm … Reload in a moment; if it still reads Awaiting payment, cancel it and book it again." But `confirmCompedBooking`'s only caller is `book-actions.ts:83`, and no cron or pane action calls it again.

If the flip itself failed, the row stays pending, `admin` and $0 due, holding the hull indefinitely (DEC-163). It is not payable (`pay-by-link.ts:32-35`), and it sits in Awaiting payment at $0 (`purchases-view.ts:123`). Cancel and rebook is the only way out, which is why this is not S1.

### OR-25 — S3 — The pane's "Payment link sent" note leaves out an email that never went — **read**

With no email channel configured, the email outcome is `absent` (`app/lib/payment-link.ts:47-48`). `channelOutcomeLists` places `absent` in neither the sent nor the failed list (`app/(admin)/admin/calendar/[reservationId]/payment-link-message.ts:53-62`). The operator therefore reads "Payment link texted to (216) 555-0199." with no word about the email that §2.10.6 says goes out ("by text and email"). The cancel-notice copy handles this case (`:86-91`).

### OR-26 — S4 — A paid booking's cancel leaves an open balance-link Checkout session payable — **read**

The unpaid phone path retires open intents (`cancel-reservation.ts:175-176,190-217`); the paid path does not. A balance paid afterwards is recorded and alerted as "cancelled or unpriced" (`booking-webhook.ts:1507-1510`). The refund box still renders on a cancelled booking (`reservation-detail-pane.tsx:892`), so it can be fixed from a screen. Live only with deposits on; goes with money F29.

### OR-27 — S4 — `/b/<code>` itemises a discount differently from the pane and the link — **read**

**Spec.** §2.10.6: "The same trip never quotes two totals".

**Code.** `/b/` shows Fare as the discounted figure with no Discount line (`app/b/[code]/page.tsx:280`). The pane and `/p/` show the undiscounted fare plus a Discount line (`reservation-detail-pane.tsx:665-670`; `pay-by-link.ts:71-73`). The totals agree; only the itemisation differs.

### OR-28 — S4 — §2.10.6's deposit clauses are not built: the link takes `amountDueNowCents` frozen at booking, saves no card, and past-due balances do not join Awaiting payment — **read**

**Spec.** §2.10.6: "It takes the deposit … Paying it saves the card", and "past-due deposit balances join it (2.8.4d)".

**Code.** DEC-201 is `status: draft`, and `depositMode` defaults to `"full"` (`src/reservations/payment-config.ts:60`). Nothing in `src/` sets `setup_future_usage` or `off_session`. A booked row with a balance reads `deposit` (`purchases-view.ts:131`), with the move to Awaiting payment deferred in its docstring (`:36-39`). The plan rows are 19.1–19.3, unchecked (`docs/PROJECT_PLAN.md:984-986`). Goes with money F29.

### OR-29 — S4 — §2.10.2's "the words are fixed" is not what the code or the screen uses — **read**

The code uses `available/booked/held/departed/unavailable/blocked`, with cutoff as a `phoneOnly` flag (`availability.ts:264-275`, deliberate per issue #1071). The screen shows "open · 3:30 · phone only", the customer's name or "Booked", "Checking out", "Departed" and "Blocked". `busy` draws as a Booked card marked "· Xola" (`calendar-view.tsx:1071-1124`; `calendar-list.tsx:121-138`), and the word "busy" never appears on screen. The spec should say whether its words are state names or screen copy.

### OR-30 — S4 — Latent block gaps — **read**

- Two Holds pressed at once can create duplicate rows. `already_held` is a check-then-insert (`block-admin.ts:192-199`), and the blocks table has no unique index. Unblock has to be pressed twice.
- The deriver's materialised-Event branch never checks blocks (`availability.ts:583-612`). It is unreachable until a per-trip override exists, the same latency as money F18.
- `saveBlockAdmin` upserts on any posted id, so a hand-posted form could turn a hold row into a location block (`postgres-repository.ts:1299`). The editor never does this.

### OR-31 — S4 — Smaller trail and record gaps — **read**

- "Copy payment link" mints a fresh 72-hour link on every pane render (`app/(admin)/admin/calendar/[reservationId]/page.tsx:640-649`) with no trail row. Related to capability-URL A6.
- A send or resend that reaches nobody writes no row (`actions.ts:497-508`; `app/lib/payment-link.ts:61-65`). The operator sees the error on screen, but the History cannot show "tried, reached nobody".
- A phone booking has no `reservedAt` (`operator-booking.ts:6`) and `Reservation` has no created-at. Nothing can show how long a held boat has waited for payment, which the §2.10.6 "watches the purchases list" workflow wants. Spec silent.
- The derived `gratuity_added` labels a `post` tip as `admin` (`src/reservations/reservation-trail-view.ts:351`), but `post` means customer-added (`entities.ts:478-479`). Latent: nothing writes `post` today.
- Integrity checks that an `eventId` is set, not that the Event is live, and does not check a phone row's vessel or offering (`src/admin/integrity.ts:111-115`).

### OR-32 — S4 — An unpaid booking's details cannot be corrected — **read** (spec silent)

No server action under `app/(admin)/` edits a reservation's name, phone, email or party size. A mistyped phone on a phone booking means the link goes to the wrong number, and the only fix is cancel and rebook, which releases the boat in between (the same cost as OR-4).

## 3. Known findings met, not re-reported

- **money F1:** the hull is measured by trip time once paid (`hull-busy.ts:93`).
- **money F6:** booked-row readers recompute tax at the live rate (`calendar-detail.ts:218-222`; `purchases-view.ts:150-153`).
- **money F8:** the guard now sits in `cancelBookingAndRelease`. Confirmed by reading `postgres-repository.ts:1801-1859` and `in-memory-repository.ts:830-851`.
- **money F10:** no shift-level cancel exists. At-Risk Cancel is disabled with "Handle reschedule/cancel by phone for now" (`components/at-risk/risk-row.tsx:174-189`). The shift and shifts actions have no cancel, and nothing offers rebook or credit (grep `rebook|credit`).
- **money F12:** integrity goes red after cancelling an unpaid phone booking (`integrity.ts:113-114`), including a failed comp (OR-24).
- **money F13:** a lapsed pending row reads "Pending" forever on purchases. It is also a dead link (OR-15).
- **money F17:** the cutoff has no settings-page control.
- **money F18:** see OR-30.
- **money F19:** slots under a live pending row are hidden on the operator grid.
- **money F24:** abandonment's hold time is a summary.
- **money F26:** looks fixed; the partial notice uses `{movedCents, cents}` (`operator-cancel.ts:265-266`).
- **money F27, F28, F29:** met as described. F29 is with OR-26 and OR-28.
- **money U2, U3:** met as described.
- **money report §3 item 24:** the consequence of OR-1.
- **capability URLs A6:** the link page carries full phone and email, several links can be live, and Copy mints one per render.
- **capability URLs A12:** `/api/guest-contact`.
- **capability URLs A14:** the link is signed with `SESSION_SECRET`.

## 4. The four questions

**1. Can the operator reach a state no screen gets them out of?**
- **Bookings, holds, blocks and links: no.** Every unpaid booking shows Cancel, including a $0 comp whose confirm failed (`phone-booking-actions.tsx:82-83`). It is always findable at `/admin/purchases` → Awaiting payment, even when a block hides it from the calendar (OR-2).
- Every block is liftable from `/admin/blocks`, past ones via the Past tab. Every hold links to its release pane, which resolves from the blocks list rather than the drawn slots (`blocks/page.tsx:329-332`; `calendar-view.tsx:331-335,379-381`).
- A link cannot be revoked, but it dies at 72 hours and cannot pay a cancelled or booked row (`pay-by-link.ts:28-38`).
- **Money: yes, one.** A payment that lands on a cancelled phone booking (OR-1) has no `Payment` row and no refund box, so it can be returned only from the Stripe dashboard.
- **Recoverable only by cancel-and-rebook,** which releases the boat in between: changing a discount (OR-4), correcting details (OR-32) and a stuck comp (OR-24).
- Nothing reinstates a cancelled booking.

**2. Does every operator action leave a trail row naming who did it?**

Mostly, but not consistently.

These write a row with `actorKind: admin` and the admin's id:
- cancel, unpaid or paid (`actions.ts:201-213`; `operator-cancel.ts:131-141`);
- refund, and refund failure (`operator-cancel.ts:240-295`; `actions.ts:395-434`);
- balance link (`actions.ts:134`);
- confirmation resend, on success only (`:509`);
- link reissue (`:614`);
- payment-link send, on success only;
- calendar hold and release (`calendar/actions.ts:69,109`).

These write nothing or lose the who:
- **Booking by phone and comps:** no row at write, and the `booked` row has no id (OR-7).
- **Discounts:** not built, and no trail type exists (OR-4).
- **Boat-outs and closures:** create, edit and lift write nothing. Lifting a hold from `/admin/blocks` writes nothing (OR-10).
- **Copying a link,** and **a send that reached nobody** (OR-31).
- **A Xola pull:** derived `imported` with actor `engine`. Which admin pressed it is not recorded.

Every write is a separate, swallowed write (OR-9). Where the id is stored, no screen shows it (OR-8).

**3. Does what the operator sees match what is stored?**

On the pane and the link, yes. Both read the frozen invoice and agree after a discount and a comp (`calendar-detail.ts:186-201`; `pay-by-link.ts:53-90`; `discount-readers.test.ts`). After a cancel, the slot redraws open, because the Event is cancelled in the same write (`cancel-reservation.ts:259`; `availability.ts:502`). After a web lapse, the slot draws open (`pending.ts`).

The mismatches:

| After | Where | What is wrong | Finding |
|---|---|---|---|
| A block | Calendar | The unpaid booking under it vanishes | OR-2 |
| A block | Blocks page | Counts it as removed, not a conflict; counts per offering | OR-2, OR-18 |
| — | "All" chip | Counts departed slots | OR-19 |
| A comp | Purchases | Reads "unpaid" | OR-11 |
| A comp | Customers | Counts full price | OR-14 |
| A partial refund | Purchases | Reads "refunded" | OR-12 |
| — | Awaiting-payment Total | Understates what is owed | OR-13 |
| A cancel race | Pane | Says "try again" | OR-22 |
| Any operator cancel | Pane | Claims "the crew have been told" unconditionally | OR-23 |
| A trail failure | Pane | Reads "Booked online" | OR-9 |
| A cancelled phone booking | Integrity | Red | money F12 |
| A lapsed pending row | Purchases | Reads "Pending" | money F13 |

**4. Can two parties act on one booking at once and leave it inconsistent?**

**Booking against booking is safe.** It runs under the hull-day advisory lock plus the partial unique index `events_muster_slot_identity` (`db/migrations/20260718142705_claim_hold_mutex.sql:28-30`).

These pairs are guarded on status, read, not run on Postgres:
- **Cancel against cancel:** guarded, and losers write nothing (`operator-cancel.ts:117-119`).
- **Cancel against pay-confirm:** both require `pending` (`postgres-repository.ts:1784-1799`).
- **Paid cancel:** one conditional transaction (`:1801-1859`).
- **Refunds:** compare-and-swap on `expectedRefunded`.

**Three races get through:**
- **The customer's Pay press against a cancel (OR-1, S1):** the payment is created after the cancel's only re-read.
- **A block against a claim (OR-16):** blocks are read before the lock and never under it.
- **Two simultaneous Holds (OR-30):** check-then-insert with no unique index, so duplicate rows.

**The discount race §2.10.6 describes cannot occur,** because the discount save does not exist (OR-4).

## 5. Rules that match

**§2.10.1**
- "a reservation links through to the shift it produced. There is no link the other way": `reservation-detail-pane.tsx:527-530`; no calendar link under `shift/` or `shifts/`.
- "Week and month views do not exist": prev/next day and Grid/List only (`calendar-view.tsx:598-645`).

**§2.10.2**
- "Availability is computed, not stored": `deriveVirtualAvailability` (`availability.ts:488-662`).
- `cutoff` "Only ever a slot that would otherwise be `open`; every other state outranks it, `departed` included": `markPhoneOnly` runs only on `available` (`availability.ts:344-347`).
- "Every reader that asks whether a slot is open must say whose question it is": operator readers test `available` (`calendar-view.tsx:388,592`; `book-pane.tsx:89`). Customer readers drop `phoneOnly` (`availability-screen.ts:119-120,221-223`).
- "Exactly one materialised trip per boat-slot": the partial unique index (`20260718142705_claim_hold_mutex.sql:28`).
- "A booked slot is frozen … no operator surface that edits a booked trip's time or capacity": no `saveEvent` under `app/`.
- "Nothing under `app/(admin)/` writes an `Event`": grep confirms it.

**§2.10.3**
- The three block kinds: `block-admin.ts:72-117` plus the calendar hold (`:179-219`).
- "an operator's hold on a boat writes a block, never a trip": `block-admin.ts:210-217`.
- "A location block closes every departure that would be on the water during it … Measured by the offering's trip length … leaving exactly as it ends, is clear": `availability.ts:413-420`.
- "A block is another subtraction in the availability rule": `isSlotBlocked` in the deriver.

**§2.10.4**
- "Draft publishes no rule and generates no slots", and hidden likewise: `availability.ts:570`; `claim.ts:297`.

**§2.10.5**
- "Cards on file stay with Stripe": `Payment` has no card fields (`entities.ts:896-951`).
- "A trip is Open or Sold. It is never a seat count": `calendar-list.tsx:33`. The pane shows guests against capacity (`reservation-detail-pane.tsx:523-526`).
- "'Seat' is a crew word": no "seat" on the reservation screens (grep).

**§2.10.6**
- "It gains Book beside it": the Book pane from an open slot (`book-pane.tsx:80-99`).
- "The two surfaces compute the money from one model": the pane and the link both read the frozen invoice (`calendar-detail.ts:186-201`; `pay-by-link.ts:53-90`).
- "there is no field for one": `phone-booking-form.tsx:94-138`.
- "The reservation is written and holds the boat immediately": `operator-booking.ts:119-152`; `isLivePending` treats `admin` as always live (`pending.ts:87`; `postgres-repository.ts:455`).
- "minted fresh each time … `/p/<booking>.<expiry>.<sig>` … `PAYMENT_LINK_HOURS`": `src/reservations/payment-link.ts:38,54-61,76-103`.
- "It goes out by text and email the moment the operator books, and the operator can send it again or copy it": `book-actions.ts:98-104`; `phone-booking-actions.tsx:95-115`.
- "On the link the customer sees the trip, who it is booked for, the invoice … the card; they can also cancel": `app/(public)/p/[token]/page.tsx:140-221`.
- "A paid trip's link says so and points at booking recovery, never at `/b/<code>`": `p/[token]/page.tsx:269-283`.
- "A discount that makes a comp confirms the booking there and then … and no link is sent": at booking time, `book-actions.ts:75-91`; `write-booking.ts:98-113`.
- "the booking cutoff | passes freely": `OPERATOR_RULES.cutoff`, `claim.ts:142`.
- "a block | refuses": named `blocked` refusal, `claim.ts:261-266`; `book-pane.tsx:71`.
- "another trip overlapping the hull | refuses": `claim.ts:391-410`, plus the locked write.
- "the boat's capacity | refuses": `claim.ts:258`; `book-pane.tsx:124-133`.
- "an offering that is not live | refuses": `claim.ts:297`.
- "no fall-through to a bigger one … the hull, capacity and departed refusals are not parameters at all": `claim.ts:115-126,253-267`.
- "An operator's booking does not expire … Nothing frees it": the only pending→cancelled write is a person's press (`cancel-reservation.ts:175`). No cron cancels reservations, and abandonment skips `admin` (`abandonment.ts:79-84`).
- "So an unpaid phone booking reads Awaiting payment, with its own filter, its trip read off the booking itself": `purchases-view.ts:123,187-190`; `purchases/page.tsx:47`.
- "The confirm that books it turns it into `muster` in the same write": `postgres-repository.ts:1689-1697` (read); in-memory `:782`.
- "on the trail's `booked` row (`actorKind: admin`) … where the booking's pane reads 'Booked by phone'": `booking-webhook.ts:883`; `reservation-detail-pane.tsx:409`. Fragile (OR-9); no id (OR-7).
- "Until then its Event does not exist": `eventId: null`, `operator-booking.ts:121`.

**§2.10.7**
- "The one-party rule lives in the claim as a predicate, not as a uniqueness constraint": no unique index on `reservations` in `db/migrations/` (grep).

**§2.10.8**
- "no way for the operator to take money directly": no cash, paid-elsewhere or card field in any admin form.

**§3.3**
- "Operator-initiated cancel … full refund": `cancel-reservation.ts:89-90`.
- "notify the customer … update booking … state to Cancelled", per booking: `operator-cancel.ts:74-81`, with cancel and release in one write (`cancel-reservation.ts:259`).
- DEC-198 "A customer can cancel their own booking when the terms refund something": the customer path, out of scope here, met in passing.

**§2.10.6 / §2.8.4c**
- "An unpaid phone booking gets none" (no cancel notice): `actions.ts:177-215`.

## 6. What could not be determined

- **Postgres behaviour.** Every Postgres claim was read, not run: OR-1's append, OR-16's lock scope, the cancel and confirm conditional writes, and `append_trail_event`'s `on conflict do nothing` (`postgres-repository.ts:2434`).
- **How wide OR-1's window is in production.** That is the latency of a Stripe `createPaymentIntent` call, which cannot be measured here.
- **Whether the post-booking discount (OR-4) is wanted,** or §2.10.6 should be narrowed to booking time. The spec reads as an edit after the link has gone out; the plan row built booking time only.
- **Whether §3.4 is deferred.** The plan parks disputes, but no decision amends §3.4 (OR-5).
- **Which of the two §2.10.6 sentences governs off-grid booking (OR-6).**
- **What a block over an unpaid booking should do (OR-2):** refuse the block, show a conflict, or cancel the booking. The code does none of these.
- **Whether production runs `depositMode: "deposit"`,** which would make OR-26 and OR-28 live. This is not answerable from the repository.
- **A retired offering with an unpaid booking.** If the offering goes hidden or draft, the grid probably stops drawing the card, while the link still takes payment (`pay-by-link.ts:119-120`). The List view was not traced.
- **Whether a post-departure operator cancel (OR-21) actually texts crew "you're off".** The probe had no shift.
