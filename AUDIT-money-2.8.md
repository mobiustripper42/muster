# Audit — does the money code do what `docs/SPEC.md §2.8` says?

**Branch audited:** `task/16.9-self-service-cancel` at `fd62b4f` (= `main` at `f6ba4e5` + pull request #1214).
**Date:** 2026-11-02. **Read-only:** no code changed, no issue, no PR, no comment. This file is the only
artifact, on `audit/money-spec-2.8`, never to be merged.

**Method.** §2.8 (SPEC lines 1526–2353) was split by subsection across five parallel readers — charges
(§2.8.4/4a/4b), refunds (§2.8.4c/12/14 + the §3.3 reads), confirm and failure (§2.8.5/6/7/9), booking
state (§2.8.1/2/3/8/10/13), and the decision-record number sweep — each starting from the Money-moving
row of `.claude/CLAUDE-context.md` plus `src/reservations/customer-cancel.ts`, following imports to the
line that decides. Every finding below was re-read at its cited lines by the lead before it went in.
`npm test -- <file>` runs (vitest 4.1.8, in-memory repository); **Postgres was not available**, so the
advisory-lock SQL was read, not run, and **nothing about Stripe's behaviour is asserted** — where a
conclusion depends on it, it says so. Temporary `*.audit.test.ts` files were run and deleted; the tests
that demonstrate a finding are reproduced in the finding.

**Line numbers** are this checkout's. SPEC line references are `SPEC:<n>`.

---

## 1. Summary

**139 rules checked** (the enumeration is sections 2–4). **109 match** the code (section 4). **17
differ** — the code does something other than the sentence. **3 are not built** — the reconciler
(§2.8.9, with §2.8.7's two rows and the acceptance criterion that depend on it), the operator's cancel
cascade and its customer notice (§3.3 steps 3–4), and the cutoff's settings-page control (§2.8.4). **10
are spec defects** — the spec is stale, contradicts itself, or is silent where the code has chosen, and
the code is fine. **31 code behaviours decide an amount or a booking state with no §2.8 sentence**
(section 3). Three findings are S1: a *booked* trip occupies its hull for its trip time rather than its
hold minutes (two auditors, two tests); a superseded PaymentIntent that succeeds after the row is
`booked` is recorded as a second payment and a second tip with no refund and nobody told; and there is
no reconciler, so a customer whose webhook fails and who closes the tab is charged and never booked —
while `docs/PROJECT_PLAN.md:852` marks the reconciler shipped. Two decisions still carry customer-facing
numbers (DEC-194, DEC-197), all of which agree with §2.8 today; the `_worksheets/` directory carries
eight more, one of which (25% deposit share) the spec is silent on.

---

## 2. Findings, most severe first

Severity: **S1** a customer is charged or refunded the wrong amount, or a payment does not become a
booking / a booking exists with no payment · **S2** money stuck or a failure is silent · **S3** the
wrong thing is said to the customer or operator · **S4** spec stale or silent, code fine.
Confidence: **tested** (a test shows it, reproduced) · **read** (from the code) · **suspected**.

### F1 — S1 — A booked trip occupies its hull for its trip time, not its hold minutes — **tested** (twice, independently)

**Spec.** §2.8.3, SPEC:1585–1586: *"any other trip on that boat whose time window overlaps prevents the
sale — whatever its source, whatever its state, `pending` or `booked` or imported."* SPEC:1590:
*"Occupancy is measured in hold minutes, never in trip time."* §2.8.6 step 2, SPEC:1908–1909:
*"materializes the `Event` for that trip … carrying the frozen price, capacity, hold minutes and trip
time."* Acceptance criterion SPEC:2281–2283: *"given a fixture offering whose trip time is 100 and
whose hold minutes are 120, a trip booked at 13:30 refuses a rival at 15:15, which measuring in trip
time would sell."*

**Code.** A *pending* row occupies by its frozen `holdMinutes` — `src/reservations/hull-busy.ts:147`
`out.push({ start, end: start + r.holdMinutes })`, gated at `:137` `if (!isLivePending(r, liveSince))
continue;`. Once the row flips, the only occupancy record is its `Event`, and the flip writes trip time
onto it — `src/reservations/write-booking.ts:140` `const durationMinutes = row.tripMinutes;` and `:156`
`...(durationMinutes !== undefined ? { durationMinutes } : {})`. `Event` has no hold-minutes field
(`src/domain/entities.ts:565–609`). Events are measured by that duration —
`src/reservations/hull-busy.ts:93` `out.push({ start, end: start + (e.durationMinutes ??
XOLA_TRIP_MINUTES) });` — and the SQL twin does the same (`src/adapters/postgres-repository.ts:1638`,
`:1791–1802`, `coalesce(duration_minutes, $5)`). A booked row's `holdMinutes` column is read by no
occupancy code. The existing suite pins trip-time measurement for events (`src/reservations/claim.test.ts:367–371`,
`availability.test.ts:423–428`); every 13:30/15:15 test uses a *pending* rival, never a booked one.

**What differs.** The same booking is measured two ways over its life: 120 minutes while the customer is
at the card form, 100 minutes from the moment they pay.

**Scenario.** Offering: trip 100 min, hold 120, departures 13:30 and 15:15 on one boat. Ann books
13:30 and pays. Ben opens `/book`: 15:15 reads *available*; he pays; the flip wins. Two sales on one
hull with the boat due back at 15:30 and the next party boarding at 15:15. Also: a lapsed 13:30 row
confirming late against a live 15:15 rival books **both**. The spec's own note (SPEC:1600–1602) says
this is invisible on one offering at even spacing and appears the day a second departure time lands
inside another's turnaround.

**Tests** (state auditor, `src/reservations/claim.audit.test.ts`, deleted):
```ts
// offering: vesselIds [SMALL], departureTimes ["13:30","15:15"], tripLengthMinutes 100, holdMinutes 120
// BOOKED 13:30: Event{ id: eventIdForSlot(SMALL,DATE,"13:30"), durationMinutes: 100, status "scheduled", source "muster" }
//               + Reservation{ status "booked", eventId, holdMinutes 120, tripMinutes 100 }
it("claim at 15:15: SPEC says refuse", async () => {
  const res = await claimDepartureSlot(repo, { offeringId: OFF, date: DATE, time: "15:15", guestCount: 2 }, builder("15:15"), now);
  expect(res).toEqual({ soldOut: true });
});
it("calendar at 15:15: SPEC says not available", async () => {
  const s = deriveVirtualAvailability({ offerings:[offering()], vessels:[vessel], dateRange:{start:DATE,end:DATE}, blocks:[], events, reservations, asOf: NOW }).find(x => x.time === "15:15");
  expect(s?.status).not.toBe("available");
});
it("confirm: a LAPSED 13:30 row confirming late against a LIVE 15:15 rival", async () => {
  const a = await confirmPendingRow(repo, "pi_A", now); const b = await confirmPendingRow(repo, "pi_B", now);
  expect({ a: a.outcome, b: b.outcome, booked }).toEqual({ a: "lost", b: "booked", booked: ["B-1515@15:15"] });
});
it("control: a PENDING 13:30 row with the same numbers DOES refuse 15:15", …) // passes
```
```
FAIL claim at 15:15 — expected { soldOut: true }, received { claimed: { time: "15:15", vesselId: "v-small", status: "pending", holdMinutes: 120, … } }
FAIL calendar at 15:15 — expected 'available' not to be 'available'
FAIL confirm — received { a: "booked", b: "booked", booked: ["A-1330@13:30", "B-1515@15:15"] }
PASS control (pending rival refused)
```
The confirm auditor's independent probe (`write-booking.audit.test.ts`, deleted) showed the same:
`savePendingIfHullFree(15:15)` → `lost` while A is pending; after `confirmPendingRow(A)` the event has
`durationMinutes 100` and no hold field; `savePendingIfHullFree(15:15)` → `won`.

Noted before: `docs/audit/2026-08-29-spec-2.8-conformance.md` (Criterion 3, note 2) — *"Hold minutes has
to be frozen onto the `Event`, not only onto the reservation."* The fix is not `durationMinutes =
holdMinutes`: that field sets the shift's end (`write-booking.ts:153–155`).

### F2 — S1 — A superseded PaymentIntent that succeeds after the row is `booked` is recorded as a second payment and a second tip; nothing is refunded; nobody is told — **tested**

**Spec.** §2.8.7, SPEC:2008: *"A superseded payment succeeds late — stale tab, old client secret | Its id
still resolves to the reservation (2.8.5). If that reservation is already `booked`, this is a second
charge for one sale: refund it and tell the customer, same path as the row below."* Criterion
SPEC:2295–2296: *"A superseded payment that succeeds late still resolves to its reservation and is
refunded rather than silently dropped."*

**Code.** The lookup resolves — `src/reservations/write-booking.ts:77` `const row = await
repo.getReservationByPaymentIntentId(paymentIntentId);` — and `:81` `if (row.status === "booked")
return { outcome: "already", reservation: row };` with no notion of *which* intent paid. The webhook
then runs the `booked || already` branch for the stale intent — `src/reservations/booking-webhook.ts:851`
— which: `:897` `await retireSiblingIntents(deps, result.reservation, charge.paymentIntentId)` (treats
the stale id as the paid one and tries to cancel the intent that actually paid); `:918–933`
`saveGratuity({ id: \`grat_pre_${charge.key}\`, … amountCents: gratuityCents })` — a second tip row keyed
on the stale id; `:954–956` `recordPayment(deps, charge, kind, reservationId, invoice)` — a second
`succeeded` ledger row. The only refund on the confirm path is `compensateResidualRaceLoss`, reached
only on `lost` (`:967–969`). The block's own comment (`:889–893`) quotes the spec row and relies on
`retireSiblingIntents` to make it rare; `:591–593` admits a sibling that already succeeded is not
fixed by it.

**Reachability.** Needs a second payable intent on the row that the best-effort sibling cancel did not
cancel: the mint path cancels the prior intent and swallows refusals
(`src/reservations/create-departure-payment-intent.ts:443–453`); the booked path cancels siblings
best-effort (`booking-webhook.ts:602–614`). Whether Stripe refuses a cancel on an intent already
`succeeded`/`processing` is **Stripe-dependent, unverified** (adapter comment
`src/adapters/stripe-payment.ts:386–397`). A stale tab confirming intent A while intent B's webhook is
in flight, or any cancel refused by a provider outage, reaches it.

**Scenario.** Fare $500 + tax $36.25 + tip $100 = $636.25 captured twice = $1,272.50. Ledger: two
`succeeded` rows; `/admin/purchases` reads $1,272.50 paid; the crew pool carries $200 of tip; the derived
balance reads −$636.25 and nothing alerts on it; the customer sees two charges and one confirmation.

**Test** (confirm auditor, `booking-webhook.audit.test.ts`, deleted) — row has `paymentIntentIds
[STALE, PAID]`, tip 10000, fake payment port refuses the sibling cancel:
```ts
payments.cancelError = new Error("stripe: cannot cancel a succeeded intent");
expect(await processBookingWebhook(deps, succeeded(PAID), FAKE_SIGNATURE)).toEqual({ handled: true, outcome: "booked" });
payments.cancelError = undefined;
const second = await processBookingWebhook(deps, succeeded(STALE), FAKE_SIGNATURE);
expect(second).toEqual({ handled: true, outcome: "already" });
expect(payments.refunds).toHaveLength(0);           // no refund
expect(soldOut).not.toHaveBeenCalled();             // customer not told
expect(alert).not.toHaveBeenCalled();               // office not told
expect(rows.map(p => [p.id, p.amountCents, p.status])).toEqual([["pay_pi_paid",63625,"succeeded"],["pay_pi_stale",63625,"succeeded"]]);
expect(tips.map(g => [g.id, g.amountCents])).toEqual([["grat_pre_pi_paid",10000],["grat_pre_pi_stale",10000]]);
expect(balanceOwedCents(50000, 725, rows)).toBe(-53625);
expect(payments.cancelled).toEqual([{ paymentIntentId: PAID, reason: "duplicate" }]); // tried to cancel the intent that actually paid
```
`Tests 1 passed (1)`.

### F3 — S1 — The reconciler is not built; three §2.8.7 rows, §2.8.6's "three places" and an acceptance criterion depend on it — **read** (not built)

**Spec.** §2.8.9, SPEC:2065–2090: *"The reconciler exists so that no human is ever the one who notices."*
Primary: *"Any reservation still `pending` past its window is a work list … ask Stripe about the payments
recorded against it and confirm any that succeeded."* Fallback: *"Stripe's undelivered-event feed."*
*"Cadence: minutes, not hours."* *"The operator's pause does not stop it."* §2.8.7 rows 6–7
(SPEC:2006–2007): *"The reconciler confirms it."* §2.8.6, SPEC:1916–1917: *"It is called from the
success page …, the `payment_intent.succeeded` webhook, and the reconciler. All three run the same
function."* Criterion SPEC:2299–2300: *"Kill the webhook, close the browser, then wait past the payment
window. The customer is still booked, by the reconciler."*

**Code.** The only scheduled job is `/api/cron/tick` (`vercel.json`, `*/15 * * * *`). Its legs are
formation, a four-hourly **webhook-endpoint registration check** (`app/api/cron/tick/route.ts:126–166`),
waiver reminders, the pause gate, then `tick()`. Nothing queries pending rows past their window and
nothing calls `confirmBookingByPaymentIntent` from a job. `src/adapters/stripe-payment.ts` has no
event-listing method. `src/domain/reservation-trail.ts:252`: *"the reconciler is not built yet."*
`ConfirmOptions.via` admits `"reconciler"` (`booking-webhook.ts:536`); no caller passes it. Issue #984
("15.16 Is the webhook endpoint still doing its job?") was re-scoped from the reconciler to the endpoint
monitor at 3 points and closed; **`docs/PROJECT_PLAN.md:852` still reads** `| 15.16 | **The
reconciler.** … | 8 | 15 | [x] #984 |` — a stale `[x]` that says the reconciler shipped.

**What the monitor cannot see.** `src/reservations/webhook-health.ts:79–85`: the endpoint check carries
no signing secret, so a rotated or mis-set `STRIPE_WEBHOOK_SECRET` makes every delivery a
`PaymentSignatureError` → **400** (`app/api/webhooks/stripe/route.ts:55–59`) while the monitor reports
healthy. Whether Stripe retries a 4xx is **unverified**.

**Scenario.** $536.25 paid at 14:00 on a day the webhook secret is wrong in one place. She closes the
3-D-Secure return tab before `/book/success` renders (the page is *"the fast path, not the guarantee"*,
`app/(public)/book/success/page.tsx:48–50`). Her row stays `pending`, lapses at 14:15, the boat returns
to the calendar, someone else books it at 14:20. She has a receipt, no booking, no text, no admin alert;
the only trace is the Stripe dashboard.

### F4 — S2 — A confirmation send that fails keeps the claim; the customer is booked, charged and never told, and no retry can send — **read**

**Spec.** §2.8.6, SPEC:1954–1959: *"a sender claims that record rather than reading it: one conditional
write … A sender whose send then fails gives the claim back."*

**Code.** The claim and release are right: `src/reservations/booking-webhook.ts:1106` `if (await
deps.repo.claimConfirmationSend(reservationId, deps.now()))`, `:1112` `told = await
deps.sendConfirmation(reservation)`, release at `:1135–1145` when `!told`;
`src/adapters/postgres-repository.ts:1902–1916` `… where id=$1 and confirmation_sent_at is null returning
id`. But the production `sendConfirmation` is `app/lib/booking-confirmation.ts:24–119`, whose core
(`src/reservations/booking-confirmation.ts:91–132`) returns `void` and routes each channel's throw to
`onFailure` (a `console.error`), and the wrapper then returns `:112` `return Boolean(email) || live;` —
*true if an email channel is configured or Twilio is configured*, regardless of whether a send
succeeded. Its own comment, `:109–111`: *"An email SEND failure still reads as told … Narrowing that is
15.3's ground, not this issue's."*

**Scenario.** Booking with phone only; Twilio returns 503. `told = true`; `confirmation_sent_at` stays
set; the Stripe redelivery and the success page both get `false` from the claim and send nothing. The
customer is booked, charged, never told; the only record is one console line.

### F5 — S2 — A self-service refund that fails leaves no durable work item; the operator email is best-effort; the customer is told "Our team has been told" regardless — **read**

**Spec.** §2.8.4c, SPEC:1875–1877: *"a refund that does not go through leaves the booking cancelled,
and the operator is emailed to send it from the booking while the customer is told the team will."*

**Code.** `app/b/[code]/actions.ts:152` `if (outcome.ok) await emailOperatorOfCancel(booking,
outcome.refund);` → `:157–185`: returns silently when `readEmailEnv()` or `OPERATOR_NOTIFY_EMAIL` is
absent (`console.error` only when `NODE_ENV === "production"`, `:161–165`), and `catch (e) {
logSwallowed(…) }` at `:182–184`. The customer notice, `app/b/[code]/page.tsx:206–209`: *"Your booking
is cancelled, but your $X refund didn't go through yet. Our team has been told and will send it."* —
rendered from the trail row alone (`src/reservations/customer-cancel.ts:268–290`), not from whether the
email went. The durable record is the `refund_failed` trail row (`customer-cancel.ts:195–204`), which
surfaces only inside that booking's own history panel; nothing lists bookings owing a refund.

**Scenario.** $658 paid, uninsured, 24 days out; press → cancelled, boat freed, crew told; the $608
Stripe refund throws; `OPERATOR_NOTIFY_EMAIL` unset or the mail provider down → nobody is pushed; the
customer reads "Our team has been told." Deployed env values are the host's and not readable here.

### F6 — S3 (latent S1) — Booked-row readers recompute tax and the balance from the **live** tax rate; a change to the rate gives every paid booking a balance and a mintable Stripe Checkout — **tested**

**Spec.** §2.8.4, SPEC:1655–1658: *"'Freeze' means write the computed values onto the reservation and
never recalculate them. Every later reader — the confirmation, the receipt, the balance, a refund —
reads those stored values. Nothing recomputes from live settings, because a tax rate … can change
between the quote and the payment, and the customer must get what they were shown."*

**Code.** `src/reservations/calendar-detail.ts:200` takes `taxRateBps` as an input; `:208` `const
taxCents = taxCentsFor(fareCents, taxRateBps) + …`; `:248` `balanceCents: balanceDueCents(r.status,
fareCents, taxRateBps, payments)` → `src/reservations/payment-config.ts:174` `const total = fareCents +
taxCentsFor(fareCents, taxRateBps);`. Every caller hands in live config: `app/b/[code]/load.ts:157`
`taxRateBps: config.taxRateBps` → the manage page prints it at `app/b/[code]/page.tsx:307` *"Balance ·
due before your trip"*; `app/(admin)/admin/calendar/[reservationId]/page.tsx:190`;
`app/(admin)/admin/purchases/page.tsx:134`; `src/reservations/create-balance-checkout.ts:45–53`. The
balance button is offered on exactly `balanceCents > 0 && status === "booked"`
(`reservation-detail-pane.tsx:729–734`), a plain button with no confirmation. The frozen
`invoice.taxCents`/`taxRateBps` exist and are not what these readers use. The refund quote is
unaffected (it reads payments). Unpaid rows and the pay link read the invoice.

**Scenario (tested).** $499 fare, 20% tip, frozen at 7.25% → charged 65294 (tax 3618). Live
`payment.tax_rate_bps` later set to 800 — the rate SPEC:1712 says applies. Admin pane and manage page:
tax $39.92, **balance $3.74**; purchases list: `state: "deposit", balanceCents 374`;
`createBalanceCheckout` → `{ ok: true, amountCents: 374 }`, a payable Stripe session for a booking paid
in full. Reverse (frozen 8%, live 7.25%): receipt tax understated at $36.18, balance −374 hidden by
`paidInFull`. Already named as dead ruling text in `docs/decisions/_worksheets/DEC-155.md:35` and tracked
as issue #574. Latent today only because live and frozen rates are both the fallback (F15).

```ts
it("admin pane / manage page: live 8% on a booking frozen at 7.25% shows a $3.74 balance", () => {
  const v = buildReservationDetail({ reservation: booked, event, payments: [paid], gratuities: [], taxRateBps: 800 });
  expect(v.money.taxCents).toBe(3992); expect(v.money.balanceCents).toBe(374);
});
it("createBalanceCheckout mints a $3.74 Stripe session for a fully paid booking", async () => {
  await repo.setPaymentConfig({ taxRateBps: 800 }, NOW);
  expect(await createBalanceCheckout(repo, new FakePaymentPort(), RESV, urls)).toMatchObject({ ok: true, amountCents: 374 });
});
```
Both pass (`booking-invoice.audit.test.ts`, 9/9, deleted).

### F7 — S3 (S1 combined with F3) — `/book/success` tells a residual-race loser they were refunded and texted before either has happened — **read**

**Spec.** §2.8.7, SPEC:2009: *"Refund the full amount automatically … and tell the customer … The refund
and the message are one path."*

**Code.** `src/reservations/confirm-booking.ts:94` `confirmBookingFromIntent(deps, pi, {
notifyOnResidualRaceLoss: false, via: "success_page" })` — deliberate (`:63–72`: a public, repeatable
GET must not refund or send). The page then renders `app/(public)/book/success/page.tsx:96–100`: *"Your
card was charged and refunded in full right away. … We've texted you this as well."* Both are claims
about work the signed webhook will do later (`booking-webhook.ts:717–772`); if the webhook refund call
fails, the office is told "REFUND MANUALLY" and the customer notice is skipped (`:687–705`).

**Scenario.** Secret rotated (F3); customer loses the residual race at 14:12; the page says refunded and
texted; neither occurs; she learns otherwise from her statement.

### F8 — S3 — Two concurrent self-cancel presses: one refunds (correct), the other reports a *failed* refund to both parties — **tested**

**Spec.** §2.8.4c, SPEC:1877: *"Money is refunded only by the press that did the cancelling."*
SPEC:1875–1877 (the operator email and the customer's "didn't go through" are for a refund that *did not
go through*).

**Code.** `src/reservations/cancel-reservation.ts:236–247` — the status write is unconditional
(`alreadyCancelled = reservation.status === "cancelled"` from a plain read, then `saveReservation`, an
upsert at `postgres-repository.ts:1533–1542`). Two requests that both read `booked` both "did the
cancelling", both write a `cancelled` trail row (`customer-cancel.ts:183–189`), both reach
`refundAfterCancel`. The second gets `stale` from the lease (`refund-payment.ts:153–162`) while the
first is inside its Stripe call; `customer-cancel.ts:237–247` then checks `refundedSince(...) >=
quote.refundCents`, which reads 0 because `markPaymentRefunded` (`refund-payment.ts:253`) has not run
yet → `{ kind: "failed", movedCents: 0 }` → the action emails *"Refund needed — … The refund of $608.00
did not go through — refund it from the booking"* (`booking-change-request.ts:103–110,136–138`) and the
page shows the failed notice until a `refunded` trail row lands after it (only the `charge.refunded`
webhook writes one, `booking-webhook.ts:1305–1312`; its timing is Stripe's). Pull request #1214's own
receipt names the race.

**Scenario.** $658 uninsured, 24 days out, double-tap on the no-JS form. One $608 refund (correct).
The operator gets "Refund needed … refund it from the booking"; the pane's refundable now reads $50 (the
kept fee) and the refund box permits exactly that — the email nudges a person toward refunding the fee
the terms keep.

**Test** (refund auditor, `customer-cancel.audit.test.ts`, deleted; `Promise.all` of two
`cancelByCustomer` with the same posted quote): `fake.refunds` length 1 — PASS; refunded 60800 — PASS;
outcomes `["ok:failed","ok:issued"]` — PASS; two `cancelled` rows, one `refund_failed` row — PASS;
`cancelledNoticeFrom(rows)` → `{ kind: "failed", cents: 60800 }` — PASS.

### F9 — S3 (latent S1) — The admin "Release the boat" repair press after a customer self-cancel writes a second, misattributed `cancelled` row, quotes the kept $50 at the operator rate, and fails with copy claiming a refund already went through — **read** (precondition tested)

**Spec.** §2.8.4c, SPEC:1811: *"Who cancelled is the discriminator, not when."* Table row SPEC:1819
(operator → everything).

**Code.** The repair form (`app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx:907–922`)
posts to `cancelBooking` with `<input type="hidden" name="by" value="operator" />` and no `amount` /
`expectedRefunded`. It is shown when `reservation.status === "cancelled" && event.source === "muster" &&
event.status === "scheduled"` (`page.tsx:407–410`) — the state a customer self-cancel leaves when the
hull release throws (`customer-cancel.test.ts:504–524`). `actions.ts:277–290` → `cancelReservation`
returns `{ ok: true, alreadyCancelled: true, freedEventId }` (`cancelledBy` kept, `cancel-reservation.ts:240`).
`:322–335` then writes a `cancelled` row with `reason: "cancelled by operator"` unconditionally — its
comment *"a second one cannot re-cancel anyway"* is false for the repair path. `:369–383` computes
`quoteCancelRefund({ by: "operator", … })` = everything still refundable = the kept $50; `:389–390`
blank box → `refundCents = quotedCents`; `:418–422` `expectedRefunded` absent fails `/^\d+$/` →
`refundErr: "stale"`, whose copy (`pane.tsx:272`) says *"Nothing was refunded — this page was out of
date (a refund had already gone through)…"*. If refundable is 0, `pane.tsx:157` says *"Nothing was paid
on this booking"* — false for a fully refunded one.

**Tested precondition:** a row `status: "cancelled", cancelledBy: "customer"` with `refundedCents:
60800` and a scheduled event → `cancelReservation(..., "operator")` → `{ ok: true, alreadyCancelled:
true, freedEventId }`; `cancelledBy` stays `customer`; `quoteCancelRefund({ by: "operator" })` →
**5000**.

**Scenario.** Customer self-cancels $658 ($608 lands); hull release throws; pane shows "Release the
boat"; press → trail reads "cancelled by operator" after "cancelled by the customer"; a $50 refund at
the operator rate is attempted and refused as "stale" with copy about a refund that already went
through. **Latent S1:** adding `expectedRefunded` to the repair form — the natural fix for that message —
would refund the kept $50 on every repaired customer cancel.

### F10 — S3 — The operator's cancel tells the customer nothing; §3.3's cascade and its customer notice are not built — **read** (not built)

**Spec.** §3.3, SPEC:2915–2943 (the admin-facing cascade: step 1 reads refund amounts from §2.8.4c;
later steps notify the customer). §2.8.4c is silent on what an operator-cancelled customer is told.

**Code.** `app/(admin)/admin/at-risk/actions.ts` exports only `leanOn` (`:21`);
`app/(admin)/admin/shift/[shiftId]/actions.ts` exports no cancel (`:132–428`);
`src/admin/at-risk-board.ts` mentions cancel only in a comment. The one operator cancel is `cancelBooking`
on the calendar pane, which reads §2.8.4c correctly (`actions.ts:375–382`) and sends the customer **no
message** — a repo-wide search for a customer-facing cancellation notice finds only the self-cancel
notice (`app/b/[code]/page.tsx:203,207`). Whether Stripe emails a refund receipt is **unverified**.

**Scenario.** Weather cancel at 11pm from the pane: boat freed, crew told, $658 refunded; the customer
learns nothing from Muster and finds a refund on their statement with no explanation.

### F11 — S3 — The offering admin form says the tip is exempt from the service fee; it is in the fee base — **read**

**Spec.** §2.8.4a table SPEC:1701 (fee base *"fare + extras + insurance + tip"*); SPEC:1717–1720 *"A
customer who tips more pays a larger fee."*

**Code.** `app/(admin)/admin/offerings/offering-sections.tsx:434`: *"…crew and is exempt from tax + the
service fee (DEC-124)"*. The charge is right: `src/reservations/discount.ts:74` `feeCentsFor(ours +
lines.gratuityCents, …)` (tested: fee 1796 on $499 + $99.80 tip).

**Scenario.** The operator tells a caller the 3% is not on the tip; a $99.80 tip carries $2.99 of fee.

### F12 — S3 — `/admin/integrity` goes red, permanently, after the operator cancels an unpaid phone booking — **tested**

**Spec.** §2.8.10, SPEC:2128–2129 (the report must not go red for a null `eventId` that is the
contract); §2.8.8, SPEC:2014–2015: an `admin` pending row *"never lapses … Only a person ends it."*

**Code.** `src/admin/integrity.ts:111–115`: `if (r.eventId !== null) { … } else if (r.status ===
"booked" || r.status === "cancelled") { v.push({ … missingId: \`(null on a ${r.status} row)\` }); }`.
The comment at `:108–110` says *"cancel keeps it"* — true for a booked row, false for
`cancelPendingIfUnpaid` (`cancel-reservation.ts:171` → `postgres-repository.ts:1839–1841` `update
reservations set status='cancelled' … where id=$1 and status='pending'`), which leaves `event_id` null
by design (`src/ports/repository.ts:398–400`).

**Test** (`integrity.audit.test.ts`, deleted): save `{ source: "admin", status: "pending", eventId: null
}`, `cancelPendingIfUnpaid(id, "operator", at)` → `true`, expect `violations` `[]` → received `[ {
entity: 'reservation', id: 'resv-phone', missingId: '(null on a cancelled row)', ref: 'eventId' } ]`.

### F13 — S3 — `/admin/purchases` renders a lapsed pending row as "Pending" forever — **read**

**Spec.** §2.8.1, SPEC:1564–1567: lapsed *"is computed from the clock against the reserved time every
time it is asked"*; §2.8.8, SPEC:2026: *"Lapsed is derived, every time, by every reader."*

**Code.** `src/reservations/purchases-view.ts:123` `if (reservation.status === "pending") return
reservation.source === "admin" ? "awaiting" : "pending";` — no `isLivePending`, no clock in
`PurchasesInput`; the comment at `:34–35` still says *"Lapsed is not distinguishable here until the row
carries a reserved time (14.4)"* — it has since `db/migrations/20260905031117_reservations_pending_slot.sql:35`.
Chip "Pending", tone `warn` (`app/(admin)/admin/purchases/page.tsx:58,75`).

**Scenario.** Nothing reaps lapsed rows (§2.8.8), so every abandoned checkout since launch sits under a
warn-toned "Pending N", indistinguishable from someone at the card form now.

### F14 — S3 (minor) — `cancel_closed` says "too close to your trip" for every reason the quote became null — **read**

**Spec.** §2.8.4c, SPEC:1872–1875: refused *"by name, never silently re-quoted"*.

**Code.** `src/reservations/customer-cancel.ts:142` `if (!quote) return { ok: false, reason:
"quote_changed", newRefundCents: 0 };` → `app/b/[code]/page.tsx:47–52` *"It's too close to your trip to
cancel online now."* `customerCancelQuote` returns null also for departed (`:82`) and for `refundCents
<= 0` (`:92`), including "fully refunded by the operator between render and press". Nothing is cancelled
(correct); the reason is wrong.

### F15 — S4 (S1 conditional, unverifiable here) — The tax rate: the spec says 8%, its own worked example is at 7.25%, the code fallback is 7.25%, nothing seeds or edits the row, and a malformed row falls back silently — **read / suspected**

**Spec.** SPEC:1712–1713: *"it is 8% where BrewBoat operates. There is no admin surface to change it
today; the code carries a fallback … and that fallback is not the rate."* Three lines earlier,
SPEC:1707–1709, the only worked example in §2.8.4a: *"a $499 fare with a 20% tip ($99.80) at 7.25% is …
$652.94; with insurance … $686.01."* Both totals are 7.25% (re-derived; the code reproduces them
exactly at `taxRateBps: 725`, and `src/reservations/flex-insurance.test.ts:34,43` pins them).

**Code.** `src/reservations/payment-config.ts:62` `taxRateBps: 725, // Ohio state sales tax 7.25%
(operator-adjustable)`. Read at `src/adapters/postgres-repository.ts:1385–1388`: an absent *or
unparseable* `payment.tax_rate_bps` falls to the default with no log (contrast `booking-cutoff.ts:26–30`,
which logs). No `setPaymentConfig` caller under `app/`; no migration seeds the key. Spec and code agree
the fallback is not the rate; whether any deployment carries `payment.tax_rate_bps = 800` is not
answerable from the repo. If production has no row, every booking collects 7.25% while the spec says
8% — $3.74 under on the $499 example — with no signal.

### F16 — S4 — §2.8.7 rows 1–2 say a retry "creates a second payment … its id recorded alongside the first"; §2.8.8 and the code reuse one PaymentIntent — **read**

SPEC:2001–2002 vs SPEC:2057–2060 (*"A retry reuses the PaymentIntent the checkout already has rather
than minting a second one"*). Code follows §2.8.8: `src/reservations/create-departure-payment-intent.ts:347`
`const priorIntentId = pending.paymentIntentIds?.at(-1);`, `:374–416` reuse +
`updatePaymentIntentAmount`; a fresh mint only when the prior is unreadable or refused (`:443–505`). The
money half of row 2 holds (`:412` re-freezes the invoice each attempt).

### F17 — S4 — "The value is an operator setting, edited on the settings page" — no such control exists — **read** (not built)

SPEC:1641–1642. `app/(admin)/admin/settings/page.tsx` holds only the engine pause control;
`src/reservations/booking-cutoff.ts:10`: *"No screen edits it yet. It is set by SQL until the settings
page (issue #1166) ships."* Storage, read and fallback exist (`booking-cutoff.ts:15,23–25`;
`postgres-repository.ts:1419–1422`).

### F18 — S4 (latent S1) — The read side exempts a Muster override `Event` at the asker's own slot; the write does not — the customer is shown the override total and charged another hull's base total — **tested** (in-memory), **read** (SQL)

**Spec.** §2.8.3, SPEC:1608–1610: *"the code that decides what to show … and the code that decides what
to refuse at the write ask the identical question."* §2.8.4, SPEC:1658: *"the customer must get what
they were shown."*

**Code.** Read exempts: `src/reservations/claim.ts:385–387`, `availability.ts:586`. Write does not:
`src/adapters/in-memory-repository.ts:808–814` ("No self-exemption against events"),
`postgres-repository.ts:1791–1806`. Pinned as a known disagreement by `claim.test.ts:373–405` (issue
#945). The checkout page prices the first open boat (`checkout/page.tsx:241–267`); the claim re-prices
per hull (`claim.ts:467–473`). **Latent:** the only production `saveEvent` caller is the Xola importer
(`src/import/import-reservations.ts:245`), so no unbooked `muster` override event can exist today.

**Scenario (tested).** Offering $499 on v-small(6) and v-big(12); override Event on v-small at $615.
Page: v-small *available* at 61500, pay bar **80473**. Submit: v-small lost at the write, fell to v-big,
intent **65294**. Whether Stripe's Elements confirm proceeds at 80473 against an intent at 65294 is
**unverified**.

### F19 — S4 — The slots a live pending row overlaps are hidden on the operator grid, not drawn `busy` — **read**

SPEC:2132–2134: *"The other slots the row's trip overlaps on that boat show as `busy` (§2.10.2)."* The
deriver marks them (`availability.ts:530–536,620–624` → `unavailable`), but `calendar-grid.ts:252–259`
returns `false` from `drawsOnCalendar` for an `unavailable` slot with no scheduled event at that time,
so they are dropped before the grid, the list and the "Booked" count. The hide rule is the operator's
2026-08-07 call (`calendar-grid.ts:232–246`), made for Xola overlaps; the spec sentence postdates it.

### F20 — S4 (with a residual) — A `payment_intent.succeeded` that resolves to no row is acked silently; the class is prevented by construction, not detected — **read**

SPEC:1967–1970: *"a payment that should have matched and does not … must never pass quietly."*
`booking-webhook.ts:825–827` `if (result.outcome === "unconfirmable" && result.reason === "no_row") {
return { handled: false }; }` — no alert, no trail row. The construction holds for our charges (row
before Stripe, `claim.ts:478`; id appended before the secret is returned,
`create-departure-payment-intent.ts:512–514`). A hosted balance session's bare PI, a dashboard charge,
and a hypothetically lost row all land on the same silent `handled: false`; the §2.8.9 fallback feed
that the spec says turns an unmatched entry into *"2.8.6's alert"* is unbuilt (F3).

### F21 — S4 — The customer record is created before the flip, not in step 6 — **read**

SPEC:1913 puts *"the customer record"* in step 6 after step 5. `write-booking.ts:161–165`
`resolveCustomerId(…)` runs inside `flipPendingRow` before `bookPendingIfHullFree` (`:175`). A
residual-race loser gets a `Customer` row; a non-collision throw there 500s before the hull is
arbitrated (Stripe retries — acceptable).

### F22 — S4 — Stale docstrings and one withdrawn decision still state the pre-DEC-196 fee base and an untaxed insurance — **read**

`src/domain/entities.ts:822–823` ("On fare + extras."), `:829–831` (flex "Untaxed and outside the fee
and tip bases"), `:496`; `src/reservations/checkout-quote.ts:46–50`; `payment-config.ts:176–177`
("insurance a flat untaxed $30"); `pricing.ts:19`; `payment-config.ts:26,62` ("Ohio rate" 7.25%);
`docs/decisions/DEC-124…md:24` (`status: withdrawn`, "exempt from tax and from the service fee"). The
code (`discount.ts:72–75`) is right.

### F23 — S4 — "Nothing else is created at checkout … nothing durable and nothing outbound" is broader than the code — **read**

SPEC:1791–1793. Durable at the public pending write: trail rows `hull_contended` (`claim.ts:499–518`),
`sold_out` (`:540–555`, "deliberately not throttled"), `checkout_details_changed`
(`create-departure-payment-intent.ts:268–280`), `payment_superseded` (`:464–476`). Outbound at the
*operator's* pending write: the payment-link SMS + email (`app/lib/payment-link.ts:42–80`). The named
items hold (customer record `write-booking.ts:161`; booking code only confirm-side; confirmation only
via `formAndConfirm`).

### F24 — S4 — Abandonment: "how long it held the boat" is a summary, not a per-row column — **read**

SPEC:2048–2050 lists it per row. `app/(admin)/admin/abandonment/page.tsx:124–129` columns are
Departure, Boat, Guests, Started, Card form, Session; hold time is `total × windowMinutes`
(`:88–91`, `src/reservations/abandonment.ts:156`) with the caveat (`:103–107`) that the window is not
recorded per row — the open question at SPEC:2336–2340 already accepts this.

### F25 — S4 — "14 days" is 336 clock hours; across DST the boundary moves an hour — **tested**

SPEC:1833 *"Exactly 14 days out is refundable."* `refund-terms.ts:55` `STANDARD_CANCEL_DAYS_BEFORE *
HOURS_PER_DAY`; `:87` strict `<`; hours from instants in `TENANT_TZ` (`cancel-reservation.ts:85–86`).
Departure 2026-03-15 15:30 ET vs now 2026-03-01 15:30 ET (14 calendar days, across spring-forward) →
**335 h, refund 0**; fall-back → 337 h, refundable. Reasonable reading; the spec should say hours or
local days.

### F26 — S4 (latent) — After a partial refund failure the customer notice quotes the whole figure — **tested**

SPEC:1876–1877. `customer-cancel.ts:280` `const cents = rows[cancelledAt]!.metadata.quotedCents!;` —
never `refund_failed.actualCents`. Rows `[cancelled{quotedCents:60800}, refund_failed{actualCents:45800}]`
→ `{ kind: "failed", cents: 60800 }`. The operator email is right (`booking-change-request.ts:106–109`).
Two-charge bookings need deposit mode, which is dormant.

### F27 — S4 — The confirm's "That's what you paid, less the $50" nets prior partial refunds; the terms paragraph says "$30" while the confirm prints the discounted insurance — **read**

(a) `refund-payment.ts:89–92` `amountCents - refundedCents`; `customer-cancel.test.ts:233–236`;
`app/b/[code]/page.tsx:494`. SPEC:1821 says "everything paid", silent on money already returned.
(b) `refund-terms.ts:122` *"less the $30 insurance"* beside a confirm printing `dollars(quote.keptCents)`
($27.50 for a discounted insurance, `page.tsx:495`). SPEC:1838 says kept is "what was charged for it";
SPEC:1797 calls the terms published. One page shows both numbers.

### F28 — S4 — §3.3 says the policy is "tenant-configurable"; §2.8.4c rejects a policy engine — **read**

SPEC:2920–2922 vs SPEC:1797–1801. Spec-internal.

### F29 — S4 — §2.8.10's admitted balance-path defects are present as described and reachable by the operator only — **read**

Tax recomputed from live settings: `create-balance-checkout.ts:45–53`; `booking-webhook.ts:1517–1525`;
balance payment written with `taxCents: 0` (`:1474`). Owed derived from payment rows alone:
`payment-config.ts:157–210`. Caller: admin-only `createBalanceLink`
(`app/(admin)/admin/calendar/[reservationId]/actions.ts:91–120`). Never creates or confirms a
reservation: `recordBalancePayment` (`booking-webhook.ts:1463–1533`) touches no status; its bare PI lands
on F20's silent `no_row` (`confirm-booking.test.ts:246–266`).

### F30 — S4 — Small gaps — **read**

SPEC:1673 "Add-on lines when they exist": `BookingInvoice` has no add-on line. SPEC:1627 step 2 omits
the insurance box checkout carries (`checkout-form.tsx:339–351`). SPEC:1677 "the deposit split lives in
payment configuration, which is live and editable": no surface edits it. SPEC:1726–1730 already admits
the gratuity "Collect"/"Required" checkboxes have no reader (`offering-sections.tsx:457–463,485–493`;
no `.required` reader in `src/reservations/`). `src/domain/reservation-trail.ts:221–223` documents
`quotedCents` as a `refund_issued_by_operator` field; 16.9 writes it on the customer `cancelled` row.

---

## 3. Code that decides an amount or a booking state with no §2.8 sentence

One line each, `path:line`. None is a defect on its own; each is a choice the spec does not record.

**Amounts**
1. Rounding: tax, fee and tip each rounded half-up independently; the total is the sum of rounded parts — `payment-config.ts:68–70,76–78`, `pricing.ts:75–77`, `discount.ts:75` (tested: base 33333 → 6667 / 2417 / 1200 / 43617).
2. Tax on insurance is carved into `Payment.flexCents` with the insurance — `discount.ts:158–162`, `booking-webhook.ts:1210–1211`.
3. Included-guest count falls back to the boat's COI cap when the offering sets none — `pricing.ts:97–102`.
4. Override `Event.price` wins the slot; first-match price variations — `booking-invoice.ts:61–68`, `availability.ts:428–434`.
5. Discount parsing: `Math.trunc`, clamped 0…fare+insurance; `invalid_discount` for non-integer/negative — `discount.ts:104`, `operator-booking.ts:88–89`.
6. The $2 comp floor fires only when a discount was requested; a trip priced under $2 with no discount is not comped — `discount.ts:101,107`.
7. Tier config validation: integers, 0 < t ≤ 10000, default ∈ tiers; default-not-a-tier → first tier preselected — `offering-admin.ts:106–111`, `checkout-quote.ts:102`.
8. `Payment.kind` derived as `deposit` iff `amountDueNowCents < totalCents` — `booking-webhook.ts:954–955`, `pay-by-link.ts:58`.
9. Deposit mode, if a single `app_settings` row turns it on: deposit = base × pct + full tax + full fee + full tip + full insurance; `depositPercent` unbounded; the client's due-now subtracts an undiscounted balance — `payment-config.ts:95`, `booking-invoice.ts:114–115`, `components/checkout/money.ts:49`.
10. Prior refunds are netted before the terms apply ("everything paid *and not yet had back*") — `refund-payment.ts:89–92`, `cancel-reservation.ts:64,84`.
11. A multi-charge refund is split newest-charge-first and refused whole if any row lacks a PaymentIntent — `refund-payment.ts:174–200`.
12. Disputed / dispute-lost charges are excluded from the refund base — `payment-config.ts:129–130,151–155`.
13. Refund attribution inside `balanceOwedCents` is tip-and-fee-first — `payment-config.ts:195–207`.
14. Operator cancel: `by` defaults to `"customer"` (the lower rate) on an absent/unknown radio value — `[reservationId]/actions.ts:271`.
15. Operator cancel has no quote-changed guard: a window crossed between render and press silently yields $0 — `[reservationId]/actions.ts:369–383`.
16. Event `capacity` is read from the **live** vessel COI at confirm, not frozen — `write-booking.ts:138,148`.
17. Stripe idempotency keys: `refund_${pi}` for the residual race, `refund_op_${paymentId}_${cumulativeRefunded}` per operator leg — `booking-webhook.ts:660–663`, `refund-payment.ts:223–231` (semantics Stripe's, unverified).
18. `receiptEmail` is passed to the intent when an email was given (Stripe's own receipt) — `create-departure-payment-intent.ts:292–295`.
19. Payroll: pools summed per event across kinds; `poolCents <= 0` skipped silently; crew with tips but no Gusto id warned and dropped from the CSV — `gratuity-payroll.ts:49–53,64,143–145,169`.

**Booking state**
20. `source` flips `admin → muster` in the booking write — `postgres-repository.ts:1738`, `in-memory-repository.ts:784`.
21. A customer's live pending row cannot be ended by anyone; only the clock — `cancel-reservation.ts:166–168`.
22. The confirm flip ignores blocks, season and grid; only hull overlap and the whole-boat mutex — `postgres-repository.ts:1612–1664`.
23. With no `asOf`, the deriver treats no pending row as live and nothing as departed; `/book/checkout/page.tsx:159–169` and `block-impact.ts:61–68` pass none — `availability.ts:289–293,530,544`.
24. A `payment_intent.succeeded` resolving to a **cancelled** row (`not_pending`) alerts "REFUND MANUALLY", issues no refund, tells the customer nothing — `booking-webhook.ts:828–837`.
25. Residual-race refund call fails → office told, `refund_failed` row, customer notice skipped — `booking-webhook.ts:687–705`.
26. Comp confirm refuses a row that ever minted an intent — `write-booking.ts:107–110`; `payLinkState` refuses $0 due — `pay-by-link.ts:34`.
27. `unusable_row` (pending row missing slot/invoice) → alert, no auto-refund — `write-booking.ts:123–136`.
28. `payment_intent.processing` pages every admin, undeduped on redelivery — `booking-webhook.ts:380–388`.
29. A hosted balance payment against a **pending** row is saved and alerted as "cancelled or unpriced" — `booking-webhook.ts:1502–1513`.
30. `/book/success` renders "You're booked! Payment received." for every outcome except `lost`, including `ignored` (Stripe says the intent did not succeed) — `app/(public)/book/success/page.tsx:79,113–141`, `booking-outcome-view.ts:44–48`.
31. Self-service cancel requires `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` before anything is cancelled; the departure instant counts as departed (`<=`) — `app/b/[code]/actions.ts:127–129`, `availability.ts:171–173`.

---

## 4. Rules that match

One line each: subsection — rule — where. 109 lines.

**§2.8.1**
1. Three states only, no `expired`, no sweeper writes one — `src/domain/entities.ts:619`; `src/reservations/pending.ts:85–89`.
2. Reserved time stored; the window is a setting; expiry derived — `pending.ts:26,63,66,73–75`; `db/migrations/20260905031117_reservations_pending_slot.sql:35`.
3. Lapsed never stored; one predicate (`isLivePending`) and its SQL twin — `pending.ts:85–89`; `src/adapters/postgres-repository.ts:452–453`.
4. `isBooked` is the allow-list helper; no `!== "cancelled"` deny-list in SQL; the two TS deny-shapes (`src/checkin/departure.ts:218,244`) are shielded by the null-`eventId` contract — `entities.ts:633–635`.

**§2.8.2**
5. `eventId` null until confirm; both writers set null; only the flip computes it, in the same statement as `booked` — `entities.ts:655`; `create-departure-payment-intent.ts:162`; `operator-booking.ts:121`; `write-booking.ts:139`; `postgres-repository.ts:1737–1739`.
6. Availability from the schedule; an abandoned checkout materializes nothing — `availability.ts:569–581`; `postgres-repository.ts:1815–1819`.
7. Nothing lists pending rows by event, and every by-event reader also allow-lists `booked` — `postgres-repository.ts:1550–1555`; `src/crewapp/shift-card.ts:249` and five siblings.

**§2.8.3**
8. Pending rows occupy by their own frozen `holdMinutes` — `hull-busy.ts:147`; SQL `postgres-repository.ts:462`. (Booked rows: F1.)
9. The asking side is `candidateHoldMinutes`, one function for claim and deriver — `hull-busy.ts:158–160`; `claim.ts:373,399`; `availability.ts:620–624`.
10. Source-blind: every `scheduled` event counts — `hull-busy.ts:81–82`.
11. Calendar and write share predicates — `claim.ts:39–55` imports them; agreement suite `claim.test.ts:807–939`.
12. Hull-day advisory lock on `vessel|date`, held across check and insert, at the pending write and the flip — `postgres-repository.ts:1789,1590–1592` (Postgres-only tests `postgres-repository.test.ts:720,770`, not runnable here).
13. Off-grid refused at the write before any read — `claim.ts:307–311`.

**§2.8.4 — the flow**
14. Step 1: schedule minus booked, live pending, blocks; cutoff → "Call to book" — `availability.ts:321–347`; `app/(public)/book/page.tsx:77,105,192–204`.
15. Step 2: name, phone, optional email, tier, terms box not recorded, one button — `checkout-form.tsx:333–338,410–422,475–483`; `checkout/actions.ts:165–167`.
16. Step 3 refusals in order: not live, guests, off-grid/season, departed, cutoff by name, overlap, CAS — `claim.ts:287–345,382–401,478`.
17. Smallest fitting hull; the customer never picks — `claim.ts:81–93,153–155`.
18. Pending written with `reservedAt` **before** Stripe; money and both durations frozen in one insert — `create-departure-payment-intent.ts:171–180,203–216,479–505`.
19. Step 4: intent for the frozen `amountDueNowCents`; id appended to the row before the secret is returned — `create-departure-payment-intent.ts:327–332,479–514`; `postgres-repository.ts:1872–1875`.
20. Cutoff: hours in `app_settings`; fallback = no cutoff; measured like `departed`; checked on `/book`, the re-check and the write; named refusal; gates the claim only; operator passes — `booking-cutoff.ts:15,23–25`; `availability.ts:187–190`; `claim.ts:138–144,343–345`; `operator-booking.ts:155`.
21. The invoice is one JSON value with every component in cents and each rate; discount/insurance lines only when present; two totals stored separately — `entities.ts:799,807–850`; `booking-invoice.ts:94–116`.
22. Times are columns; durations not in the invoice — `entities.ts:741,795–805`.
23. Booking charge sends no metadata; `description` carries offering/trip/party/who — `create-departure-payment-intent.ts:289–291,504`; `stripe-payment.ts:303,309`.
24. Pending/unpaid readers read the frozen invoice: intent amount, pay link, unpaid pane, Event price/extras at the flip, gratuity row — `create-departure-payment-intent.ts:327–332`; `pay-by-link.ts:53–90`; `calendar-detail.ts:153–193`; `write-booking.ts:152,172`; `booking-webhook.ts:918–932`. (Booked readers: F6.)
25. Screen total and charge are the same function — `checkout-quote.ts:75–101`; `components/checkout/money.ts:36–42`.

**§2.8.4a — what the customer is charged**
26. Fare = the trip's price; taxed; in the fee base — `booking-invoice.ts:61–68`; `discount.ts:72–74`.
27. Extras per head beyond the included count — `pricing.ts:50–55,97–102`.
28. Insurance flat $30, taxed, in the fee base, not in the tip base, charged in full with the first payment, its own line only when bought — `refund-terms.ts:37`; `booking-invoice.ts:83,107,114–115`; `discount.ts:72–74,84–85`.
29. Tip: a tier of fare+extras only, untaxed, in the fee base, charged in full, no decline, tier must be one the offering sells; defaults 15/20/25 with 20 preselected — `discount.ts:73–74,85`; `pricing.ts:60–62`; `create-departure-payment-intent.ts:104–110`; `operator-booking.ts:93–95`.
30. Service fee 3% on everything but tax, tip included, untaxed — `payment-config.ts:63`; `discount.ts:73–74`.
31. Tax on fare + extras + insurance only — `discount.ts:72–73`.
32. The worked example reproduces: **65294** and **68601** through `priceBooking` (tested).
33. Discount in dollars, off fare+extras then insurance; tax/fee/tip recomputed at frozen rates; cap fare+extras+insurance; stored as its own line with fare undiscounted — `discount.ts:82–92,104`; `booking-invoice.ts:84–103`.
34. Under $2 due → comp; the box says so; a comp zeroes the tip; no `Gratuity` row for $0 — `discount.ts:20,85,107`; `phone-booking-form.tsx:121,175–179`; `booking-webhook.ts:919–920`.
35. Full charge at booking; `amountDueNowCents === totalCents` in full mode; deposit config dormant — `payment-config.ts:59–65,91`.
36. Both durations frozen; turnaround not stored — `create-departure-payment-intent.ts:178–179`; `operator-booking.ts:132–133`.
37. Tipping cannot be turned off (as the spec admits) — `pricing.ts:83,90`.

**§2.8.4b — where the tip goes**
38. Equal split among Confirmed holders of required seats, deduped; supernumerary excluded — `src/admin/gratuity-payroll.ts:112–117`.
39. Integer cents; remainder to the first `pool mod n` crew sorted by id — `gratuity-payroll.ts:62,69–73`.
40. Zero-crew pool reported unsplit as a warning the operator sees — `gratuity-payroll.ts:65–68`; `app/(admin)/admin/payroll/page.tsx:190–193`.
41. No post-trip tipping — `pricing.ts:64–72`; `offerings/actions.ts:112–118`.
42. Customer record, booking code and confirmation belong to confirm — `write-booking.ts:161`; `app/lib/booking-confirmation.ts:80,163`; `recover-booking-link.ts:134`.

**§2.8.4c — what comes back**
43. Uninsured ≥14 days: paid − $50 — `refund-terms.ts:86–90`; `refund-terms.test.ts:35–37`.
44. Uninsured <14 days / no-show: nothing — `refund-terms.ts:87`.
45. Insured ≥72 h: paid − insurance charged, no $50 — `refund-terms.ts:88`.
46. Insured <72 h: nothing — `refund-terms.ts:87`.
47. Operator, any notice: everything, insurance included, no fee — `refund-terms.ts:103–105`; `cancel-reservation.ts:87–90`; `cancel-reservation.test.ts:328–343,389`.
48. Who cancelled is the discriminator; `cancelledBy` persisted once, never rewritten — `cancel-reservation.ts:87–90,240–247`.
49. "Everything paid" = captured amounts (fare, tax, tip, fee, insurance, its tax), never recomputed — `cancel-reservation.ts:84`; `refund-payment.ts:89–92,107–109`.
50. Inside the window keeps everything, fee included — `refund-terms.ts:87`.
51. $50 floors at zero — `refund-terms.ts:89`; `refund-terms.test.ts:53–58`.
52. 14-day and 72-hour boundaries inclusive — `refund-terms.ts:87` strict `<`.
53. Insurance kept = what was charged after discount; a comp keeps $0 and the 72-hour window — `discount.ts:114–116,145–147`; `booking-invoice.ts:47–55`.
54. The insurance's tax comes back; the $50 is flat with no tax gross-up — `refund-terms.ts:88` (`chargedCents`, `CANCELLATION_FEE_CENTS`).
55. The policy reads a number, never the invoice line — `refund-terms.ts:68–70`; `cancel-reservation.ts:56–59`.
56. Not sold inside 72 h: boxes hidden, writes refuse `insurance_closed` by name, "you have not been charged" — `availability.ts:201–204`; `create-departure-payment-intent.ts:112–116`; `operator-booking.ts:96–99`; `checkout/actions.ts:69–70`.
57. The terms follow the box on checkout, the link, the manage page and the SMS clause — `refund-terms.ts:119–128,152–155`; `booking-confirmation.ts:73`.
58. Self-cancel offered only outside the window with >$0; the confirm states the refund and what is kept — `customer-cancel.ts:81–92`; `app/b/[code]/page.tsx:151–158,492–497`.
59. The press cancels, frees the boat, tells the crew, then refunds — `customer-cancel.ts:152–160,191`; `cancel-reservation.ts:241–311`.
60. Inside the window or at $0 → the request form — `app/b/[code]/page.tsx:372–379`.
61. Recomputed at the press; a changed figure >$0 re-opens the confirm; $0 → request form; refused by name — `customer-cancel.ts:139–148,296–308`.
62. Cancel first, then refund; a failed refund leaves it cancelled with a `refund_failed` row; a throw after the status write is carried on — `customer-cancel.ts:152–204,161–175`.
63. Only the press that cancelled refunds: lease + compare-and-swap, one Stripe refund under concurrency (tested) — `refund-payment.ts:152–168`.
64. Manage page and admin pane quote through the same function — `customer-cancel.ts:85–91`; admin `page.tsx:292–295`.
65. The operator's radio reaches the amount; a blank box is the policy figure; a typed figure is bounded by refundable and recorded with `quotedCents` + `actualCents` — `[reservationId]/actions.ts:271,375–390,492–511,556–559`.
66. Disputed charges excluded from the refund base; the customer cancel is then not offered — `payment-config.ts:129–130,151–155`.

**§2.8.5**
67. Many payment ids per reservation; containment lookup — `entities.ts:754`; `postgres-repository.ts:1851,1872–1875`.
68. A superseded id still resolves — `write-booking.ts:77`. (What happens next: F2.)
69. Only booking payments resolve this way; the balance never does — `booking-webhook.ts:401,1463–1533`.
70. Retry matched by the httpOnly holder token, never typed identity — `claim.ts:430–459`; `holder-token.ts:30–40`; `checkout/actions.ts:121–123`.

**§2.8.6**
71. Idempotent; a second run is `already`, not an error — `write-booking.ts:81`; `booking-webhook.test.ts:187–200`.
72. Step 1 lookup by payment id — `write-booking.ts:77`.
73. Step 2 materializes at slot identity and re-materializes a cancelled slot row in place — `write-booking.ts:139–157`; `postgres-repository.ts:1665–1724`.
74. Steps 2–3 in one transaction under the lock with a `pending AND not exists booked` guard — `postgres-repository.ts:1583–1761`.
75. Step 4 forms the shift with `notifyTripChanges: true`, best-effort — `booking-webhook.ts:1053–1082`.
76. Step 5 gated on a claimed record: one conditional write, released on failure (the mechanism) — `booking-webhook.ts:1106–1145`; `postgres-repository.ts:1902–1916`. (The return value: F4.)
77. People first, bookkeeping last; the payment record throws, unwrapped — `booking-webhook.ts:897–956`.
78. Reports booked / already / lost — `write-booking.ts:185–193`.
79. Success page and webhook call the same function; the success page resolves the id against Stripe first — `confirm-booking.ts:46–58,88`; `app/api/webhooks/stripe/route.ts:47`.
80. Comp confirm: second lookup by reservation id, refuses unless pending + `admin` + $0 due, shares the flip, `via: "comp"`, no payment record — `write-booking.ts:98–113`; `confirm-booking.ts:110–128`.
81. Nothing re-validated at confirm except hull overlap — `write-booking.ts:117–194`.
82. Confirm at a lapsed row is not an error — `postgres-repository.ts:1657`; `booking-webhook.test.ts:319–336`.
83. The alert never throws; zero admins is logged as a failure; no SMS → the log line is the alert; every active admin, amount + purchases link — `booking-webhook.ts:152–166`; `app/lib/alert.ts:110–124`; `src/adapters/forward-money-alert.ts:44–97`.

**§2.8.7**
84. Row 1: reserved time untouched on a retry — `create-departure-payment-intent.ts:161,171`.
85. Row 2: money re-frozen on a tip change — `create-departure-payment-intent.ts:144–155,412,512`.
86. Row 3: `payment_failed` does not expire the row — `booking-webhook.ts:316–344`.
87. Row 5: a late webhook → `already` — `write-booking.ts:81`.
88. Row 9: success after expiry, boat taken → full refund keyed `refund_<pi>`, customer told on the row's phone/email that they were charged **and** refunded with no amount, office told every time — `booking-webhook.ts:643–663,721–772`; `sold-out-notice.ts:62–70`; `booking-webhook.test.ts:354–382`.
89. Row 10: boat free → re-check under the lock, book it — `postgres-repository.ts:1612–1664`.
90. Operator (`source: admin`) rows have no window — `pending.ts:85–89`.

**§2.8.8**
91. Abandonment branches on `source` first; admin excluded — `abandonment.ts:78–85`.
92. No sweeper, no reaper: only the flip and `cancelPendingIfUnpaid` (admin rows) leave `pending` — `postgres-repository.ts:1743,1838–1844`.
93. Every occupancy reader tests `pending AND reserved + window > now` with one clock per read — `hull-busy.ts:137`; `availability.ts:547`; `claim.ts:316,436`; `abandonment.ts:84`.
94. Attempts and minted intents are two numbers — `entities.ts:755–770`; `abandonment.ts:40,48`.

**§2.8.9**
95. The webhook endpoint monitor runs above the pause gate — `app/api/cron/tick/route.ts:126–166`. (The reconciler: F3.)

**§2.8.10**
96. Xola rows arrive `booked`/`cancelled` with `eventId` set — `src/import/import-reservations.ts:75,286`.
97. No occupancy decision consults a payment row — `availability.ts:280–298`; `claim.ts:348–353`.
98. Blocks are their own entity, occupy a hull, refused by name — `availability.ts:393–423`; `claim.ts:85–88,252–257`.
99. Crew manifest reads by event and `isBooked` — `src/crewapp/shift-card.ts:249`.
100. The tip pool pays on `booked` — `gratuity-payroll.ts:127`.
101. Purchases view does not render pending as Cancelled — `purchases-view.ts:122–123`. (Lapsed: F13.)
102. Integrity has a `pending` null branch — `integrity.ts:111–112`. (Cancelled-unpaid: F12.)
103. Customers view, at-risk board and block impact each say what they show — `src/customers/customer-view.ts:56–58`; `src/admin/at-risk-board.ts:212–227`; `block-impact.ts:61–68`.
104. Calendar: live pending → `held` ("Checking out"); lapsed → nothing; booked and block outrank held — `availability.ts:543–550`; `calendar-view.tsx:1251–1268`.
105. Cancellation, refund and balance are never handed a pending row — `cancel-reservation.ts:237`; `customer-cancel.ts:81,134`; `refund-payment.ts:139`; `create-balance-checkout.ts:40`.
106. The balance path is dormant and never creates or confirms a reservation — `payment-config.ts:59–60`; `booking-webhook.ts:1463–1533`.
107. The public recovery lookup returns nothing for a pending row — `find-booking.ts:68,81`.

**§2.8.13**
108. Party size first and in the address; "all too small" its own state; smallest fitting boat quoted; floor 1, ceiling the largest boat — `availability-screen.ts:117–121,178–182,262,283–286,304–312`.

**Route**
109. Signature verified → 400; a handler throw after a valid signature → 500 so Stripe retries — `app/api/webhooks/stripe/route.ts:33–36,55–63`; `stripe-payment.ts:426–434`.

---

## 5. Customer-facing numbers still in `docs/decisions/`

Rule: `.claude/CLAUDE-context.md:84`. Tracking issue #816 (open; last activity 2026-08-26) named six
files — DEC-107, 113, 124, 134, 153, 155 — and all six are now clean (five in `archive/` as tombstones,
DEC-124 rewritten and `withdrawn`). Two top-level records written after the issue carry numbers; the
issue does not list them, nor `_worksheets/`.

### Top-level `docs/decisions/DEC-*.md`

| DEC | `path:line` | Number | `status` | §2.8 |
|---|---|---|---|---|
| DEC-194 | `DEC-194-a-discount-is-dollars-off-the-fare-and-a-comp-confirms-by-name.md:8,19,30–31` | **$2** comp floor; **$0.50** Stripe minimum | active | SAME — SPEC:1748–1750 |
| DEC-197 | `DEC-197-insurance-is-not-sold-inside-the-72-hours-it-buys.md:4,8,14,17,24–26,28` | **72 hours** (title, ruling, `revisit_if`, `amends_spec`, body); **$30**; "71 hours" | active | SAME — SPEC:1699,1817,1851 |

Both agree with the spec today. The exposure is the one the rule names: DEC-197 holds "72 hours" in
five places in an `active` file that `check:decisions` keeps as long as anything cites it, so a change
to §2.8.4c leaves five stale copies. Clean by contrast: DEC-195:41 ("The amounts and the window are
§2.8.4c's"), DEC-196, DEC-198 (no numbers), DEC-161:35, DEC-163:35, DEC-188:37.

### `docs/decisions/_worksheets/` (returned by the rule's own `grep -rli --exclude-dir=archive`)

| Worksheet | `path:line` | Number | §2.8 |
|---|---|---|---|
| DEC-107 | `_worksheets/DEC-107.md:39` | 8% tax; evidence cell records the 725 fallback | SAME (SPEC:1712); fallback "is not the rate" (SPEC:1713) |
| DEC-109 | `_worksheets/DEC-109.md:34` | 15-minute hold | SAME (SPEC:2325–2328) |
| DEC-113 | `_worksheets/DEC-113.md:29` | 72 hours / 14 days | SAME (SPEC:1815–1818) |
| DEC-134 | `_worksheets/DEC-134.md:34` | 3% "of the fare … not on the tip" | **Same number, different base** — SPEC:1717–1720 puts the tip in the base (DEC-196); spec is current |
| DEC-134 | `_worksheets/DEC-134.md:37` | tiers 15/20/25, 20 preselected | SAME (SPEC:1722–1724) |
| DEC-153 | `_worksheets/DEC-153.md:36` | 14 days / $50, inclusive | SAME (SPEC:1805,1815,1833) |
| DEC-155 | `_worksheets/DEC-155.md:30` | **25% deposit share** | **Spec silent** — SPEC:1757–1759 names no share; code `payment-config.ts:61` `depositPercent: 25` |
| DEC-155 | `_worksheets/DEC-155.md:34` | `balanceDueDaysBeforeEvent` 14 | Spec silent; code `payment-config.ts:64` |

`docs/decisions/archive/` carries no customer-facing number.

### Where the code defines each spec number

| Spec number | Defining constant | Agrees |
|---|---|---|
| $30 insurance (SPEC:1699) | `refund-terms.ts:37` `FLEX_INSURANCE_CENTS = 3000` | yes |
| 72 hours (SPEC:1817,1851) | `refund-terms.ts:43` `FLEX_CANCEL_HOURS_BEFORE = 72`; `availability.ts:203` (`>=`) | yes |
| 14 days, inclusive (SPEC:1815,1833) | `refund-terms.ts:40` `STANDARD_CANCEL_DAYS_BEFORE = 14`; `:87` strict `<` | yes (F25: hours, not local days) |
| $50 fee (SPEC:1805,1815) | `refund-terms.ts:33` `CANCELLATION_FEE_CENTS = 5000` | yes |
| 3% service fee (SPEC:1717) | `payment-config.ts:63` `serviceFeeBps: 300` | yes |
| 8% tax (SPEC:1712) | `payment-config.ts:62` `taxRateBps: 725` (fallback) | **no** — F15 |
| Tiers 15/20/25 @ 20 (SPEC:1723) | `pricing.ts:60,62` | yes |
| $2 comp floor (SPEC:1748) | `discount.ts:20` `COMP_FLOOR_CENTS = 200` | yes |
| Cutoff, no number (SPEC:1643) | `booking-cutoff.ts:15`; absent key = no cutoff (`:23–25`) | yes |
| 15-minute window, env-overridable (SPEC:2325–2329) | `pending.ts:26` `HOLD_MINUTES_DEFAULT = 15`; `:49` **ignored on a production deploy** | 15 yes; "env-overridable" only off production |
| Deposit share (spec silent) | `payment-config.ts:61` `depositPercent: 25` | spec silent |

---

## Could not determine

- **Stripe** (all unverified, none assumed): retry on a 4xx (F3); refusal of a cancel on a succeeded
  intent (F2's reachability); full-refund semantics without `amount` (`stripe-payment.ts:284–291`);
  idempotency-key lifetime (`confirm-booking.ts:68–69`); dedupe of `refund_op_*` keys; delivery timing of
  `charge.refunded` (how long F8's notice stays wrong); whether a refund receipt is emailed (F10);
  Elements confirming at an amount other than the intent's (F18); redirect to `return_url` on a failed
  confirmation (section 3, item 30).
- **Postgres**: the hull-day lock, `for update` and `on conflict` paths (`postgres-repository.ts:1562–1769`)
  and the three concurrency criteria (SPEC:2278–2280, 2304–2305) were read, not run; F8's race was shown
  on the in-memory adapter and the Postgres upsert has the same shape by reading.
- **Production state**: whether `app_settings` carries `payment.tax_rate_bps` (F15), `OPERATOR_NOTIFY_EMAIL`
  and the email channel (F5), the webhook secret (F3) — the host's env, not the repo's.
- Whether measuring a *booked* trip by trip time (F1) was ever an operator decision: DEC-161 and SPEC
  say hold minutes with no pending/booked carve-out; the suite pins trip time for events without saying why.
