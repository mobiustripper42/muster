# Audit: what the plan says shipped vs. what the code has

**Commit audited:** `main` at `0c4bddf` (Merge pull request #1264), 2026-11-13. Read-only. The only file committed is this report.

## 1. Summary

I checked **160 plan rows marked done**:
- 154 rows marked `[x]` in `docs/PROJECT_PLAN.md`. There are 155 `[x]` marks; the extra one is in the Phase 4 total line.
- 6 rows of Phase 10, which is marked done in its heading ("✅ COMPLETE") instead of with `[x]`. Its row 10.4 is left open by the Phase 10 retro, so it is not counted.

Row verdicts: **133 built, 13 partly built, 13 superseded, 1 not built.** The one not built is 15.16, the reconciler, which the ledger already holds as money F3.

I also checked **99 spec criteria** in `docs/SPEC.md` (§2.8: 27 checkboxes and 17 "must" lines; §2.10: 45; §3.3: 7; §3.4: 3). Verdicts: **74 built, 12 partly built, 13 not built.** Of the 13 not built:
- 4 are deposits, which Phase 19 has not claimed.
- 5 are already in the ledger: money F2, F3 twice, and F10 for the §3.3 cascade.
- 4 are new. Two are §3.3 lines: rebook-or-credit, and the parts of the cascade beyond what F10 names. Two are §3.4 lines, and the plan parks all of §3.4.

**New findings by severity: S1 0 · S2 4 · S3 11 · S4 31.**

No new S1. **Money F3 is still the only case of a row marked done that was never built and can lose money.** The worst new finding is S2-1: a card charge that does not match the invoice frozen on the reservation becomes a booking with no alert, although plan row 15.6 says that case has its own named outcome. It would be S1 if it can happen in practice; whether it can is suspected, not shown.

How the evidence was gathered:
- I ran the existing tests for every slice with `npm test -- <files>`: about 1,500 tests across roughly 50 files, all passing.
- I wrote probe tests (`*.audit-tmp.test.ts`) for seven findings. They are reproduced below and have been deleted.
- There is no Postgres here, so every Postgres-adapter claim is marked *read, not run*.

## 2. Findings, most severe first

Known ledger findings are cited by id and not re-reported.

### S2

**S2-1 — 15.6: a charge that does not match the frozen invoice books silently, as "paid in full".** Confidence: *tested* that the code stays silent; *suspected* that it can happen.
- **Plan row** (`docs/PROJECT_PLAN.md:843`, 15.6 `[x]`): *"Confirm reads the row's frozen invoice; a capture that disagrees is a named outcome."* The same row warns that *"zeroes would make an underpaid booking read **paid**"*, and that *"the mismatch alert must be gated to `booked`."*
- **Code:**
  - The possible confirm outcomes are listed at `src/reservations/write-booking.ts:29-56`: `booked`, `already`, `lost`, `unconfirmable{no_row|not_pending|unusable_row|not_comp}`. None is a mismatch.
  - The amount Stripe received is passed through as the payment amount (`src/reservations/confirm-booking.ts:54`, `amountCents: pi.amountReceivedCents`) and written to `Payment.amountCents` (`src/reservations/booking-webhook.ts:1201`).
  - Tax and the other carve-outs come from the frozen invoice (`:1205-1211`).
  - `kind` is set from the invoice alone (`:955`).
  - Nothing compares the received amount with `invoice.amountDueNowCents`: searching `amountDueNowCents|mismatch` in `booking-webhook.ts` finds only `:955`.
- **What is missing:** the named outcome and its alert.
- **Effect:** an overcharge (the customer paid more than they were quoted) or an undercharge becomes a `booked`, `kind: "full"`, `succeeded` booking, and nobody is told.
- **How it could happen (read, not staged):**
  - Two submits on one holder token with different guest counts can interleave `updatePaymentIntentAmount` and `recordCheckoutAttempt` (`src/reservations/create-departure-payment-intent.ts:414,445`). The intent is then left at one amount and the row at the other.
  - Or the state read throws (`:394`). A new intent is minted, cancelling the old one fails (`:476-486`), and a stale tab pays the old intent at the old amount.
  - This is not money F2, which covers a superseded intent paying a row that is already booked.
- **Probe** (`src/reservations/p15-mismatch.audit-tmp.test.ts`, deleted). The row was frozen at `amountDueNowCents: 53625`; `payment_intent.succeeded` arrived with `amountReceivedCents: 35750`:
  ```ts
  const r = await processBookingWebhook(d, pi(35750), FAKE_SIGNATURE);
  expect(r).toEqual({ handled: true, outcome: "booked" });
  expect(alert).not.toHaveBeenCalled();
  expect(pays.map((p) => [p.amountCents, p.taxCents, p.kind, p.status])).toEqual([[35750, 3625, "full", "succeeded"]]);
  expect((await repo.getReservation(PEND))!.status).toBe("booked");
  ```
  Output: `Test Files 1 passed (1) / Tests 2 passed (2)`. Every assertion that the code stays silent held.

**S2-2 — 12.11: the reservation pane has no "change arrival" and no way to move a booking.** Confidence: *read*.
- **Plan row** (`docs/PROJECT_PLAN.md:579`, marked `[x]` at `:600`): *"per-reservation detail pane (roster, change arrival, cancel, refund, resend link, message)"*.
- **What exists:** the pane's actions in `app/(admin)/admin/calendar/[reservationId]/actions.ts` are cancel (`:262`), refund (`:343`), resend confirmation (`:456`) and reissue link (`:563`).
- **Search that came back empty:** `reschedul|changeArrival|moveReservation|moveBooking|change arrival`, case-insensitive, over `app/`.
- **Why the operator would notice:** §2.8.12 routes every customer change request to a person (*"the operator gets an email; nothing changes until a person acts on it"*, `docs/SPEC.md:2420-2421`). Nothing in admin can act on it. The only route is to cancel (which refunds) and then make a new phone booking (16.1), which sends the customer a second link.
- Customer-side rescheduling is deferred in the spec (`SPEC.md:2425-2426`). No deferral is recorded for the operator side.
- The "roster" part is a guest count only (`reservation-detail-pane.tsx:523-526`). That is reasonable now that the Phase 18 departure page lists the names.

**S2-3 — 12.12 and 12.11: "Message" via the customer sender is not built.** Confidence: *read*.
- **Plan row** (`docs/PROJECT_PLAN.md:580`, marked `[x]` at `:602`): *"customer contact record; **'Message' via the customer sender (#119)**, never the crew line"*.
- The pages say so themselves:
  - `app/(admin)/admin/purchases/page.tsx:35`: *"Read-only — refund is #472, message is #119"*.
  - `app/(admin)/admin/customers/page.tsx:24`: *"'Message' is blocked on #119"*.
  - `app/(admin)/admin/customers/[customerId]/page.tsx:21`.
- There is only one SMS sender (`app/lib/sms.ts:40-41,51-57`).
- `app/(admin)/admin/calendar/[reservationId]/actions.ts:43-44`: the payment link is *"Deliberately NOT emailed/texted to the customer: customer messaging needs the second sender number (#119)… Operator copies and sends."*
- The operator would notice the missing button. Nobody is misled, because the UI says it is not wired.

**S2-4 — 15.18: the success page still promises a post-trip tip.** Confidence: *read*.
- **Plan row** (`docs/PROJECT_PLAN.md:855`, `[x]`): *"Remove post-trip tipping … and what the manage page says about it."*
- The code is gone: `create-gratuity-checkout.ts` no longer exists.
- But every customer who pays reads, at `app/(public)/book/success/page.tsx:126`: *"your booking link — that's where you'll see your trip details, add a tip for your crew, or make a change."* There is no way to add a tip there.
- Stale comments describing the same removed feature: `app/b/[code]/page.tsx:4`, `src/reservations/manage-view.ts:6,10`, `app/api/webhooks/stripe/route.ts:8`.

### S3

**S3-1 — 15.12: no `payment_status` gate, no async-payment events, and no decision record for keeping the card lock.** Confidence: *read*.
- **Plan row** (`PROJECT_PLAN.md:849`): *"Gate hosted-session fulfilment on `payment_status` … handle `checkout.session.async_payment_succeeded`/`_failed` … **Carries the decision record for keeping the card lock**."*
- What was built: `payment_intent.processing` (`src/adapters/stripe-payment.ts:537-544`; `booking-webhook.ts:380-388`) and `src/adapters/stripe-payment.test.ts`.
- What is missing:
  - `grep -rnE "async_payment|payment_status|paymentStatus"` over `src app scripts e2e db` finds nothing.
  - `CheckoutCompleted` has no status field (`src/ports/payment.ts:49-55`).
  - `recordBalancePayment` writes `succeeded` unconditionally (`booking-webhook.ts:1478`).
  - `HANDLED_EVENT_TYPES` (`stripe-payment.ts:43-53`) lists neither async event, so the endpoint monitor would not notice them missing either.
  - No decision record mentions the card lock: `grep -rliE "allowed_payment_method_types|card-only|card lock|payment_method_types" docs/decisions/` returns only `_worksheets/DEC-138.md` and `DEC-139.md`.
- This is dormant while the card lock holds (`stripe-payment.ts:260`) and the balance path is unused (money F29). It becomes a money defect when deposits return (Phase 19).

**S3-2 — 15.17: the "REFUND MANUALLY" alert names no amount, and the tests the row promises are not there.** Confidence: *tested* (the amount) and *read* (the tests).
- **Plan row** (`:854`): *"The SMS names the amount. SMS unconfigured leaves one log line, and a test says so."* Spec criterion C21 (`SPEC.md:2532`) says the same.
- **The amount:**
  - The residual-race refund-failed alert (`booking-webhook.ts:700-703`) carries the charge id and the customer only.
  - The `amount` local variable (`:649`) is used only in the success alert (`:758`).
  - The 2026-08-29 conformance audit flagged this same branch (`docs/audit/2026-08-29-spec-2.8-conformance.md:1586`). It is unchanged.
  - Probe, with a rival booked and `payments.refund` throwing:
    ```ts
    const body = String(alert.mock.calls[0]![0]);
    expect(body).toMatch(/REFUND MANUALLY/);
    expect(body).not.toMatch(/536\.25|53625/);   // passed
    ```
- **The tests:**
  - No test drives `alertMoneyProblem` (`app/lib/alert.ts:110-124`) with SMS unconfigured. The only test reference is a wrapper-identity check (`app/lib/booking-deps.test.ts:37`).
  - No test drives `processBookingWebhook` with an alert that throws. Only the wrapper is tested (`booking-webhook.test.ts:2199-2252`).
  - Under DEC-170 an unconfigured channel also writes each admin's message to the console (`alert.ts:115-118`), so "one log line" is itself doubtful.

**S3-3 — 14.6 and SPEC C22: if the operator edits the offering while a customer is paying, the customer's retry after a declined card can be refused, or put on a second boat.** Confidence: *tested*.
- **The criteria:**
  - C22 (`SPEC.md:2536-2537`): *"Editing the offering's price, hold minutes, trip time or schedule while a reservation is pending changes neither what that customer is charged nor what their booking occupies."*
  - §2.8.7 row 1 (`:2220`): *"Same reservation, same boat, reserved time not touched."*
  - Plan rows 14.4 and 14.6 are `[x]` (`PROJECT_PLAN.md:801,803`).
- **Code:**
  - The row freezes its hold minutes (`create-departure-payment-intent.ts:195`).
  - But the retry re-checks the grid and the season against the live offering (`src/reservations/claim.ts:316-320`).
  - It also measures the asking interval with the live `candidateHoldMinutes(offering)` (`:382`).
  - So the reuse gate `vesselIsAvailable(mine.vesselId)` (`:462`) can reject the customer's own row.
- **Probe** (`p28-hold-edit-retry.audit-tmp.test.ts`, deleted):
  - Setup: trip 100 minutes, hold 100, departure 13:30. A Xola event sits on the boat at 15:20 for 60 minutes. The customer checks out at 12:00Z. The operator saves `holdMinutes: 120`. The same token retries at 12:02Z.
  ```ts
  const first = await createDeparturePaymentIntent(repo, pay, { ...req, shownDueNowCents: await shown(repo) }, () => T0);
  await repo.saveOffering(offering([SMALL], { holdMinutes: 120 }));
  const retry = await createDeparturePaymentIntent(repo, pay, { ...req, shownDueNowCents: await shown(repo) }, () => T2);
  expect(retry.ok).toBe(true);
  ```
  Output:
  ```
  ONE-BOAT RETRY → {"ok":false,"reason":"sold_out"}
  SCHEDULE-EDIT RETRY → {"ok":false,"reason":"off_schedule"} rows: 1
  TWO-BOAT ROWS → [["v-small","pending",100,"2026-07-04T12:00:00.000Z"],["v-big","pending",120,"2026-07-04T12:02:00.000Z"]]
  Tests  3 failed (3)
  ```
- **Effect:** a customer with a live pending row is told the trip is sold out. On a two-boat offering, one checkout ends up holding two boats until the first row lapses.
- No money moves and nothing is sold twice. It needs an edit inside the 15-minute window plus a declined card.

**S3-4 — 16.1: the write lets the operator book off-season or off the schedule grid, but no screen can reach such a slot.** Confidence: *tested*.
- **Plan row** (`PROJECT_PLAN.md:879`): *"Overlap and capacity refuse; cutoff, season and grid pass."* SPEC §2.10.6 says the same (`SPEC.md:3014`), and so does DEC-184.
- The write does pass them: `claim.ts:316-319`, with `OPERATOR_RULES.grid: "pass"` at `:140`.
- But both ways in are built from `deriveVirtualAvailability`, which yields only on-grid, in-season slots:
  - `app/(admin)/admin/calendar/calendar-view.tsx:385-397` opens Book only on an `available` slot.
  - `book-pane.tsx:88-99` filters to `status === "available"`.
- **Probe:** an off-season Saturday (2026-09-05 13:30) and an in-season off-grid time (16:00). `bookForCustomer` succeeds; the matching available slots number 0. `Tests 3 passed (3)`.

**S3-5 — SPEC §2.10.6: no discount on an unpaid phone booking once it has been written.** Confidence: *read*.
- **Spec** (`SPEC.md:2995-3006`): *"The operator can discount a booking that has not been paid … Saving it re-freezes the invoice, and it also settles the payment the link may already have started … A discount that makes a comp confirms the booking there and then."* DEC-194's ruling says: *"One dollar box on an unpaid operator booking."*
- The only discount input is on the booking-time form (`phone-booking-form.tsx:162` → `book-actions.ts:48-49`).
- The pane's actions (`[reservationId]/actions.ts:86-563`) include no discount, and the pane only displays one (`reservation-detail-pane.tsx:643-695`).
- `updatePaymentIntentAmount` is called only from checkout reuse (`create-departure-payment-intent.ts:414`).
- Plan row 16.5 says only *"from 16.1's booking page"*, so the row is built. The spec criterion is partly built.
- A customer who negotiates after booking needs a cancel and a rebook.

**S3-6 — #1021: the Stripe round-trip test only runs when someone runs it by hand.** Confidence: *read*.
- **Plan row** (`PROJECT_PLAN.md:888`, `[x]`): *"A Stripe round-trip test, so the booking path is not verified by hand every PR."*
- The suite is `src/adapters/stripe-payment.sandbox.ts:183-230`. It runs only under `npm run test:stripe` (`package.json:47`).
- `vitest.sandbox.config.ts:8-9` says it is *"run on purpose, never by `verify`"*.
- CI runs only `verify` and `test:e2e` (`.github/workflows/ci.yml`).
- Without keys, the suite skips itself (`describe.skip`, `:173`).

**S3-7 — SPEC §3.4 disputes: recorded and texted, but with no customer name, no deadline, no date and no evidence upload.** Confidence: *tested*.
- **The plan has not claimed this.** §3.4 is parked (`PROJECT_PLAN.md:346`, `:524-525`), and issue #723 built it as record-only (`booking-webhook.ts:1376-1377`).
- **Spec** (`SPEC.md:3181-3186`): *"A dispute creates an admin alert with the booking, customer, amount, and Stripe's deadline … Eric can attach evidence … from inside the app"*, and the acceptance criterion: *"a dated admin alert with the deadline visible."*
- What is built:
  - Parsing (`stripe-payment.ts:477-507`) and `recordDispute` (`booking-webhook.ts:1399-1452`).
  - A "Disputed" chip (`purchases/page.tsx:55`) and an SMS (`app/lib/alert.ts:110-124`).
- What is missing:
  - `DisputeUpdated` has no deadline field (`src/ports/payment.ts:199-206`), so `evidence_details.due_by` is dropped.
  - The alert names no customer.
  - A live dispute's trail entry is undated (`reservation-trail-view.ts:324`, *"no column records when the dispute opened"*).
  - An inquiry leaves purchases reading "paid".
  - There is no evidence path.
- **Probe output** (`p210-dispute.audit-tmp.test.ts`, deleted, `Tests 2 passed (2)`):
  ```
  PARSED {"stripeEventId":"evt_p","type":"dispute_updated","data":{"paymentIntentId":"pi_1","state":"live","amountCents":53625,"currency":"usd","reason":"fraudulent"}}
  INQUIRY ALERT: Stripe INQUIRY (reason: fraudulent) on 53625 cents (USD) for reservation resv-1. … RESPOND IN STRIPE before the deadline.
  PURCHASES STATE AFTER INQUIRY: paid
  LIVE ALERT: Stripe DISPUTE OPENED (reason: fraudulent) on 53625 cents (USD) for reservation resv-1. … RESPOND IN STRIPE.
  ```
  The inquiry alert says "before the deadline" without giving it.

**S3-8 — SPEC §3.3: what the per-booking cancel misses, beyond money F10.** Confidence: *read*.
- Step 4 (`SPEC.md:3161-3162`) asks the customer notice to give *the reason*. The notice says only *"we had to cancel your trip … We're sorry"* (`src/reservations/cancel-notice.ts:111`).
- Step 2's default for a cancel the operator starts is a full refund (`:3156-3158`). The booked-cancel radio defaults to "customer" (`app/(admin)/admin/calendar/[reservationId]/page.tsx:452`).
- Step 3, rebook or credit (`:3159-3160`), is not built: `grep -ri rebook` over `src app` is empty. It also contradicts §2.10.8's exclusion of store credit (`SPEC.md:3066`).
- The shift-wide cascade (`:3150-3151`, `:3172-3175`) is money F10.

**S3-9 — 18.2: BrewBoat's waiver text is not seeded as v1.** Confidence: *suspected*.
- **Plan row** (`PROJECT_PLAN.md:950`): *"seed BrewBoat's current text as v1"*.
- The only writers are the admin action (`app/(admin)/admin/waivers/actions.ts:51`) and a dev placeholder (`db/seed-departure-dev.ts:83`). No migration or script inserts BrewBoat's text.
- With no version in effect, confirmations carry no sign line (`src/checkin/trip-link.ts:107-111`).
- It may have been posted through `/admin/waivers` in production; the repository cannot say.

**S3-10 — 10.6: no first-contact message is sent when a crew member is added.** Confidence: *read*.
- **Plan row** (`PROJECT_PLAN.md:470`): *"first-contact when a crew member is added (… a plain 'what is Muster / how to answer an ask')"*.
- `grep -E "welcome|onboard|first.contact"` over `src app` finds nothing relevant.
- `db:crew add` (`src/crew/crew-cli.ts`) sends nothing.
- What exists is a paste-in document (`docs/CREW_QUICKSTART.md:3-5`).

**S3-11 — 10.7 and 13.0: the crew help page gives sign-in instructions that are no longer true.** Confidence: *read*.
- `app/(crew)/crew/help/page.tsx:47-49` says a text link *"opens the ask and signs you in, no code needed"*. Issue #1030 and DEC-174 retired that (`db/migrations/20260923180845_drop_magic_tokens.sql:5-7`).
- `:52-53` says *"we text you a 6-digit code"*. The code is emailed (`app/(crew)/crew/actions.ts:171`, DEC-081).
- `docs/CREW_QUICKSTART.md:18-21,28-32,36,58` repeats both errors. It also still says In/Out, which 13.0 renamed, and advertises Messages, which is off by default (`app/lib/flags.ts:24-33`).

### S4 — the plan or spec is stale; the code is fine

| # | Row or criterion (location) | What is stale | Evidence |
|---|---|---|---|
| 1 | 14.1 (`PROJECT_PLAN.md:798`) "One DEC … `supersedes: [DEC-109]`" | No such record exists. DEC-109 was withdrawn into a signpost, and the rulings live in the spec | `docs/decisions/archive/DEC-109-*.md:6,17`; `SPEC.md:2567-2573` |
| 2 | 14.1 and SPEC:2554 "the window stays 15 and env-overridable" | The code ignores the override on production deploys | `src/reservations/pending.ts:48-49` `if (isProdDeploy()) return HOLD_MINUTES_DEFAULT;` |
| 3 | 14.2 (`:799`) "gains `pending` and `expired`" | There is no `expired` state, by spec | `src/domain/entities.ts:619`; `SPEC.md:2570-2572` |
| 4 | 14.8 (`:805`) "Scripted abuse and real abandonment distinguishable in the data" | The spec says no field separates them | `SPEC.md:2269-2273`; `src/reservations/abandonment.ts:14-18` |
| 5 | 14.8, criterion 7's test | Asserts no Event, customer or code, but not "no message". This holds by construction (no channel dependency, `create-departure-payment-intent.ts:105-110`) | `create-departure-payment-intent.test.ts:1146-1148,1181-1183` |
| 6 | 14.9 (`:806`) "finds pending rows by overlap … one test asserts both sides" | The test's overlap case overlaps nothing; its own comment says so. A probe showed the code is correct | `src/reservations/claim.test.ts:813-840` |
| 7 | 15.7 (`:844`) "`purpose` survives … needs one record with `amends_spec`" | 15.6 removed even `purpose`: the charge sends `metadata: {}`, which matches `SPEC.md:2113` | `create-departure-payment-intent.ts:530-537` |
| 8 | 15.14 "One decision record" | Shipped as two, DEC-179 and DEC-180 | `docs/decisions/DEC-179-*`, `DEC-180-*` |
| 9 | 15.16 (`:853`) "beside `tick` and `doorbell-tick`" | `doorbell-tick` is unscheduled (DEC-167) | `vercel.json`; `app/api/cron/doorbell-tick/route.ts:7-16` |
| 10 | Comment | *"the metadata (incl. `purpose`) is what the `payment_intent.succeeded` webhook books from"* has been false since 15.6. Likely belongs with money F22 / capability A20 | `src/adapters/stripe-payment.ts:297-299` |
| 11 | 16.1 "a block passes but says so" | Superseded by DEC-184: a block refuses | `claim.ts:107-110,141`; `SPEC.md:3013` |
| 12 | 16.3 "`candidateVessels`" | The cutoff is a named refusal in `claimDepartureSlot`, as `SPEC.md:1666` requires | `claim.ts:352` |
| 13 | 16.8 "not taxed, not in the fee base" | Superseded by DEC-196 | `SPEC.md:1725,1758`; `src/reservations/discount.ts:72-74` |
| 14 | #1159 contact phone; `SPEC.md:1673-1677` "an operator setting" | No screen sets it; SQL only. Sibling of money F17 (issue #1166). S3 if production has no row | `src/reservations/contact-phone.ts:10`; `setContactPhone` has no non-test caller |
| 15 | 12.8 (`:576`) "photos" | Deferred. The spec (`SPEC.md:2913-2914`) does not ask for photos | `app/(admin)/admin/offerings/page.tsx:30` |
| 16 | 12.9 (`:577`) "take-out-of-service → block … block entry point" | Only the shortcut from the vessel and location pages is missing; `/admin/blocks` does it | `vessels/page.tsx:29`; `locations/page.tsx:27`; `src/admin/block-admin.ts:7-8` |
| 17 | Purchases header and empty-state copy | Says refunds are "not wired up", but the pane it links to refunds. The operator could believe refunds are impossible | `purchases/page.tsx:35,298`; `[reservationId]/actions.ts:343` |
| 18 | Phase 12 Outcome (`:587-588`) "All thirteen … shipped" | See S2-2, S2-3 and S4 rows 15 and 16 | — |
| 19 | Comment on checkout holds | `checkout_holds` was dropped in 14.7 | `src/reservations/availability.ts:466` |
| 20 | 18.0 "supersede [DEC-012]'s no-waiver half" | DEC-012 was rewritten in place, with no superseding record. `SPEC.md:72-73` still speaks of the sweep as pending | `docs/decisions/DEC-012-*.md:1-27` |
| 21 | 1.1 and §2.1's roster screens (`SPEC.md:531-537`) | No crew roster UI, by DEC-094 (the `db:crew` CLI). `buildRoster` and `renderRoster` have no caller | `src/admin/roster.ts:57,93` |
| 22 | 5.R (`:219`) `docs/PILOT_RUNBOOK.md` | The file was deleted | `docs/audit/2026-07-25/README.md:166` |
| 23 | 8.5 and 9.3 (`:383,:430`) manning override and trainee seat | Withdrawn from the UI after the 2026-07-15 incident. Only §2.3 records it (`SPEC.md:792-795`); the plan rows still read as shipped | `app/(admin)/admin/shift/[shiftId]/actions.ts:347-371`; `components/assignment/manning-section.tsx` has no caller |
| 24 | Phase 13 (`:717`) "The four calls (… DEC-144)" | DEC-144 is the doc-consistency ratchet | `docs/decisions/DEC-144-doc-consistency-is-a-ratchet-not-an-audit.md:3` |
| 25 | 6.5 and 2.2 | `tick-dev.ts` and `rankPool` do not exist. `tick/route.ts:18` cites the removed `db:tick` script | `src/oracle/reliability-score.ts:224,240,265` |
| 26 | C5 (`SPEC.md:2504`) "repeatedly" | Each Postgres race test runs once per CI run | `src/adapters/postgres-repository.test.ts:765-768,820-823` |
| 27 | C26 (`SPEC.md:2545`) "a live checkout hold"; `SPEC.md:2402,2411-2412` "the after-trip tip" | Both are gone (14.7, 15.18) | — |
| 28 | §2.10 `busy` state (`SPEC.md:2851,2862-2863`) | The operator calendar hides overlapped slots, by the operator's call on 2026-08-07. Money F19 covers only the pending case | `calendar-grid.ts:232-260`; `calendar-grid-draws.test.ts:31-35` |
| 29 | §2.10 "departed … counted nowhere" (`SPEC.md:2859`) | The "All" chip counts departed slots | `calendar-view.tsx:589` |
| 30 | §2.10.2 "nothing under `app/(admin)/` writes an Event" (`SPEC.md:2884-2886`) | `/admin/import` writes Xola Events | `src/import/import-reservations.ts:235-245` |
| 31 | §2.10.8 excludes gift cards and codes (`SPEC.md:3066`); plan `:780` | Checkout shows every customer "Apply gift card or discount code · Coming soon" | `components/checkout/checkout-form.tsx:393-401` |

Spec-internal, noted rather than counted:
- C22's literal *"changes neither what that customer is charged"* conflicts with DEC-200's reprice on reload (`SPEC.md:1647-1649`; `create-departure-payment-intent.test.ts:1512-1527`).
- §2.10.6's deposit and saved-card sentences (`SPEC.md:2985-2989`, `:3037-3038`) are written in the present tense for draft DEC-201 (Phase 19).
- SPEC puts the engine pause "global, at `/admin`", but the control is on `/admin/settings`.

### Ledger findings met and not re-reported

- **Money:** F1 (C6, C10), F2 (C14, 15.10), F3 (15.16, C17, and the §2.8 reconciler lines; `vercel.json` has only `tick`; `src/domain/reservation-trail.ts:259-260` says *"the reconciler is not built yet"*), F4 (15.3), F6 and F29 (C24, the balance path), F10 and F28 (§3.3), F12, F13 and F19 (14.3), F17 (16.3), F20 (C21), F21, F22, F23 and F24 (14.8, C9, C11), F8, F14, F26 and F27 (16.9).
- **U1–U2.**
- **Capability:** A4, A6, A7, A14 and A20.
- **Payroll:** F2 (C25), F3, F4, F7, F9, F11, F12 and F15.
- **Crewing:** S1-4, S2-1, S2-3, S3-7, S3-20, S4-4, S4-7 and S4-9.

## 3. Features the code has that neither the plan nor the spec mentions

Searched in `docs/PROJECT_PLAN.md`, `docs/SPEC.md` and `docs/design/check-in-*.md` by route, name, concept and issue number.

Booking and money first:
- `app/lib/alert.ts:69`, called from `app/api/cron/tick/route.ts:115`: a formation-failure SMS (issue #1001) to every admin on every tick, for a sold boat-day that could not form a shift. Deliberately not deduplicated.
- `app/(admin)/admin/booking-audit/page.tsx:27`: the "Booking audit" list of every trail event (issue #1049), linked in the nav (`app/lib/admin-links.ts:98`). The trail itself is 16.6; the screen is named nowhere.
- `app/(admin)/admin/calendar/[reservationId]/actions.ts:117-139`: a `balance_link_created` trail row (issue #1051).
- `db/backfill-customers.ts:1-15` (`db:backfill:customers`): a one-time backfill that creates customers and writes `customer_id` onto reservations.
- `app/api/cron/tick/route.ts:124-166`: the webhook-endpoint health monitor. It shipped under issue #984 in place of the reconciler (see money F3).
- `app/(admin)/admin/import/run/[id]/page.tsx:15-20`: detail of one import run (issue #128, DEC-056). Mentioned only in `docs/FUTURE_IDEAS.md:54`, as an idea.

Crew and operations:
- `app/(admin)/admin/asks/page.tsx:23`: `/admin/asks`, the crew audit trail (issue #400, DEC-118). Mentioned only in `docs/FUTURE_IDEAS.md:55`.
- `app/lib/sms-consent.ts:1-30` and `app/(crew)/crew/actions.ts:191`: 10DLC SMS opt-in on the crew login, with the disclosure text stored with each opt-in.
- `db/admin.ts:1-14` (`db:admin`): the only way to add or revoke an admin. No UI.
- `db/crew.ts:12-13` and `src/crew/crew-cli.ts:124` (`db:crew import-gusto --apply`): bulk-writes crew Gusto identities.
- `db/seed-fleet.ts:22` (`db:seed:fleet`): production bootstrap of vessels and role types.
- `db/xola-report-email.ts:1-16` (`db:xola:report:email`): an off-Vercel passenger-report email, marked temporary.
- `db/ops/600-close-losing-asks.sql:1-51`: a hand-run production data repair (issue #600).
- Dev-only scripts that mutate data: `db:pay`, `db:balance`, `db:paid-unbooked` and `db:reset:dev`.

Code that looks dead or unreachable:
- `app/api/cron/xola-pull/route.ts`: unscheduled, and the import action calls `runXolaPull` directly (`app/(admin)/admin/import/actions.ts:11,47`).
- `app/api/cron/doorbell-tick/route.ts`: unscheduled.
- `components/assignment/manning-section.tsx`: never rendered (S4 row 23).
- `app/(public)/book/cancel/page.tsx`: the P11 harness page, reached only as the cancel URL of the unused balance checkout (`[reservationId]/actions.ts:104`).

## 4. Every plan row marked done

Verdicts: **B** = built (with a superseded clause where noted), **P** = partly built, **S** = superseded, **N** = not built.

| Phase | Task | Verdict | Evidence |
|---|---|---|---|
| 0 | 0.3 | B | `package.json:45`; `src/adapters/in-memory-repository.ts` |
| 0 | 0.4 | B | `src/domain/entities.ts:1097,1099`; `src/domain/states.ts:57` |
| 0 | REV 2 channel port | B | `src/ports/channel.ts` |
| 1 | 1.1 M0 thin admin | S | Vessels admin exists; crew roster became the CLI (DEC-094); S4 row 21 |
| 1 | 1.2 CSV import | S | DEC-043; `src/import/import-reservations.ts:157` |
| 1 | 1.3 auto-form + lock | B | `src/builder/form-shifts.ts:192`; lock cut by DEC-082 |
| 1 | 1.4a oracle | B | `src/oracle/oracle.ts:124,187` |
| 1 | 1.4b Tier-1 loop | B | `src/asks/ask-loop.ts:210,541,639` |
| 1 | 1.5a stack | B | Magic link replaced by code (DEC-081); `20260923180845_drop_magic_tokens.sql` |
| 1 | 1.5b crew tap-in | B | `src/adapters/forward-asks.ts:59` |
| 1 | 1.6 manifest | B | `entities.ts:589`; `src/crewapp/shift-card.ts` |
| 2 | 2.1 scorer | B | `src/oracle/reliability-score.ts:168,192` |
| 2 | 2.2 rank pool | B | renamed, `reliability-score.ts:224,240,265` |
| 2 | 2.3 own standing | B | `src/crewapp/standing.ts:56` |
| 2 | 2.4 seat prune | B | `form-shifts.ts:574` |
| 3 | 3.1a horizon clock | B | `src/builder/derive.ts:314,709`; `tick.ts:223` |
| 3 | 3.1b token reaper | S | Table dropped, issue #1030 |
| 3 | 3.2a escalation trail | B | `src/asks/escalation-trail.ts:74` |
| 3 | 3.2b Tier-2 | B | `src/asks/escalate.ts:56` |
| 3 | 3.3 at-risk derivation | B | `src/admin/at-risk-board.ts:198` |
| 3 | 3.4 board + ping | B | `app/(admin)/admin/at-risk/page.tsx`; `tick/route.ts:242` |
| 3 | 3.5 lean | B | `src/asks/lean.ts:94` |
| 4 | 4.1 pilot channel / outbox | S | DEC-185; `20260924185525_drop_outbox_tables.sql` |
| 4 | 4.2 cockpit | B | `shift/[shiftId]/actions.ts:132,158,181,197` |
| 4 | 4.3 warming | B | `src/admin/warming.ts:73` |
| 4 | 4.4 crew bail | B | `ask-loop.ts:709` |
| 4 | 4.5 credential nudge | B | `src/crewapp/crew-view.ts:111` |
| 4 | 4.6 changed-since-reviewed | S | Retired by 9.1 / DEC-082 |
| 4 | 4.7 fills-by | B | `at-risk-board.ts:149-155` |
| 4 | 4.8 UI chassis | B | `components/ui/shell.tsx`, `notice.tsx` |
| 5 | 5.1 deploy + cron | B | `vercel.json` tick `*/15`; Neon moved to Crunchy (DEC-177) |
| 5 | 5.2 prod auth | S | DEC-174 |
| 5 | 5.3 vessel-local time | B | `src/config/tenant.ts` |
| 5 | 5.4 import surface | B | `app/(admin)/admin/import/actions.ts:33`; xlsx retired by DEC-043 |
| 5 | 5.R pilot runbook | S | File deleted; S4 row 22 |
| 5 | 5.5 e2e | B | `e2e/*.spec.ts`; `ci.yml:66,98` |
| 6 | 6.1 message store | B | `0008_messaging.sql`; off by default `app/lib/flags.ts:24-33` |
| 6 | 6.1b Subject | B | `src/domain/subject.ts` |
| 6 | 6.2 presence | B | `src/ports/presence.ts:23` |
| 6 | 6.3 interval spike | B | DEC-060; `tenant.ts:203` |
| 6 | 6.4 decider | B | `src/messaging/doorbell-decider.ts:199` |
| 6 | 6.5 harness | B | `doorbell-harness.ts:75`; S4 row 25 |
| 6 | 6.6a storage + port | B | `0010_doorbell_state.sql`; `src/ports/notification.ts:41` |
| 6 | 6.6b tick + cron + relay | B | Cron unscheduled (DEC-167); relay per DEC-185 |
| 6 | 6.7 crew messaging | B | `app/(crew)/crew/threads/actions.ts:77` (off by default) |
| 6 | 6.8 operator messaging | B | `app/(admin)/admin/messages/actions.ts:29` (off by default) |
| 7 | 7.0 front door | B | `app/(crew)/crew/actions.ts:85,171` |
| 7 | 7.1 nativeRole | B | `src/oracle/eligibility.ts:153`; `claimable.ts:70` |
| 7 | 7.2 claim service | B | `src/asks/claim.ts:83,212` (tests pass) |
| 7 | 7.3 /crew/open | B | `app/(crew)/crew/open/page.tsx` |
| 7 | 7.4 cascade coexistence | B | `cascade-coexistence.test.ts` passes |
| 8 | 8.1 split suggestion | B | `derive.ts:594` (tests pass) |
| 8 | 8.2 view mode | B | `app/(admin)/admin/shifts/page.tsx:289` |
| 8 | 8.3 manual split | B | `src/builder/split.ts:23` |
| 8 | 8.4 merge | B | `src/builder/merge.ts:37` |
| 8 | 8.5 manning override | S | Withdrawn from the UI (`SPEC.md:792-795`); S4 row 23 |
| 9 | 9.0 MCP loop | B | `.mcp.json`; Neon half moot (DEC-177) |
| 9 | 9.1 retire lock | B | `0022_drop_shifts_locked_at.sql` |
| 9 | 9.2 collapse notify | B | `form-shifts.ts:70-77` |
| 9 | 9.3 trainee seat | S | Unreachable, same withdrawal as 8.5 |
| 9 | 9.4 Twilio adapter | B | `src/adapters/twilio-channel.ts:76` |
| 9 | 9.5 two-pane builder | B | `components/admin/master-detail.tsx` |
| 9 | 9.6 board bundle | B | `seat-pips.tsx`; `shift-row.tsx:108-114` |
| 9 | 9.7 cockpit a11y | B | Manning part sits on a dead component |
| 9 | 9.8 polish | B | `role-glyph.tsx`; `admin-nav.tsx:61-64` |
| 9 | 9.9 civil send window | B | `tick.ts:427-434`; `tenant.ts:256-306` |
| 9 | 9.10 spawned cue | B | `shifts/page.tsx:348` |
| 9 | 9.11 crew reconciliation | B | `components/crew/*` |
| 9 | 9.12 navigation | B | `admin-links.ts:111`; `crew-menu.tsx` (DEC-148) |
| 10 | 10.1 migration↔deploy | B | A procedure, not code (`.claude/CLAUDE-context.md:156`) |
| 10 | 10.2 admin entity | B | `0018_admins.sql`; `src/admin/admin-cli.ts:124`; roles cut by DEC-092 |
| 10 | 10.3 security audit | B | `docs/SECURITY_AUDIT.md` |
| 10 | 10.5 support channel | S | DEC-094 |
| 10 | 10.6 crew onboarding | P | No first-contact message; S3-10 |
| 10 | 10.7 cheatsheet + quick-start | P | Help page wrong; operator manual deleted; S3-11 |
| 12 | 12.0 virtual availability | B | `availability.ts:457-477`; ownership mask retired (DEC-149) |
| 12 | 12.1 claim + hold | S | 14.7; DEC-109 withdrawn; `claim.ts:70,288` survive |
| 12 | 12.2 pricing | B | `src/reservations/pricing.ts:50-54`; `availability.ts:425-434` |
| 12 | 12.3 gratuity + Gusto | B | `20260718235345_gratuity.sql`; `gratuity-payroll.ts:48`; post-trip tip removed by 15.18 |
| 12 | 12.4 offerings + picker | B | `app/(public)/book/page.tsx:14-18,130-141` |
| 12 | 12.5 booking form | B | `checkout/page.tsx:243-253`; Checkout replaced (15.1, 15.19); consent replaced (DEC-188) |
| 12 | 12.6 manage page | B | `app/b/[code]/actions.ts:47,120` |
| 12 | 12.7 link recovery | B | `recover-booking-link.ts:113-146` (A7) |
| 12 | 12.8 offering catalog | P | No photos; S4 row 15 |
| 12 | 12.9 vessel + location admin | P | No block shortcut; S4 row 16 |
| 12 | 12.10 blocks | B | `src/admin/block-admin.ts:6-18`; `availability.ts:380-393` |
| 12 | 12.11 reservation calendar | P | No change arrival and no message; S2-2, S2-3 |
| 12 | 12.12 purchases + customers | P | No Message; S2-3 |
| 13 | 13.0 Yes/No | B | `forward-asks.ts:59` (the quick-start doc is stale; S3-11) |
| 13 | 13.1 punch domain | B | `src/crew/time-clock.ts:61,124`; `20260731180000_time_punches.sql:46-48` |
| 13 | 13.2 /crew/time | B | `app/(crew)/crew/time/actions.ts:58,87`; two buttons per DEC-152 |
| 13 | 13.3 admin time clock | B | `time-clock/actions.ts:94,148,190` |
| 13 | 13.3.5 crew self-edit | B | `src/crew/time-clock-crew.ts:35,91,140,187` |
| 13 | 13.4 report + gusto.csv | B | `gusto.csv/route.ts:38-43` (tests pass) |
| 13 | 13.5 no-punch warns | B | `src/admin/payroll-reconcile.ts:76-88,162` |
| 13 | 13.6 overlaps block | B | `payroll-reconcile.ts:82-88,101-114` |
| 14 | 14.1 decision record | S | Rulings went into the spec, not a decision record; S4 rows 1–2 |
| 14 | 14.2 status + nullable column | B | `20260904220345_*.sql:17`; `entities.ts:563,619,656`; no `expired` (S4 row 3) |
| 14 | 14.3 allow-list readers | B | `entities.ts:633`; `find-booking.ts:68`; `cancel-reservation.ts:240-241`; `integrity.ts:111-115`. The remaining deny-lists cannot see pending rows |
| 14 | 14.4 the pending write | B | `create-departure-payment-intent.ts:149-218`; `postgres-repository.ts:450-467,1743` (read) |
| 14 | 14.5 confirm flips the row | B | `write-booking.ts:72-84` (`confirmPendingRow`); random id at `create-departure-payment-intent.ts:554-556` |
| 14 | 14.6 retry on the same row | B | `checkout/actions.ts:117,134`; `claim.ts:442-475`; see S3-3 |
| 14 | 14.7 drop checkout_holds | B | `20260907120000_drop_checkout_holds.sql:28`; `claim.ts:483-540` |
| 14 | 14.8 expiry | B | `pending.ts:85-89`; no sweeper, by spec; S4 rows 4–5 |
| 14 | 14.9 calendar = write | B | `availability.ts:530-536,554-555`; `claim.ts:343`; S4 row 6 |
| 14 | 14.10 recordCheckoutAttempt | B | `postgres-repository.ts:1882-1925` (read); probe passed |
| 15 | 15.1 raw PaymentIntent decision | B | DEC-168, active |
| 15 | 15.2 pin API version | B | `stripe-payment.ts:244`; `package.json:94` `~22.6.2` |
| 15 | 15.3 confirmation marker | B | `20260912115606_confirmation_sent_at.sql`; `booking-webhook.ts:1106-1146` (F4) |
| 15 | 15.4 freeze amountDueNowCents | B | `entities.ts:849`; `create-departure-payment-intent.ts:374` |
| 15 | 15.5 notice reads the row | B | `booking-webhook.ts:643-647,756-761`; `sold-out-notice.ts:41-42` |
| 15 | 15.6 confirm reads the invoice | P | No mismatch outcome; **S2-1** |
| 15 | 15.7 one metadata key | S | 15.6 removed even that key; S4 row 7 |
| 15 | 15.8 reuse one PaymentIntent | B | `ports/payment.ts:124`; `create-departure-payment-intent.ts:389-449` |
| 15 | 15.9 attempts column | B | `20260915180000_checkout_attempts.sql:29`; `abandonment.ts:94` |
| 15 | 15.10 retire superseded intent | B | `create-departure-payment-intent.ts:476-510`; `booking-webhook.ts:595-635` (F2) |
| 15 | 15.11 idempotency key | B | `create-departure-payment-intent.ts:529`; no key on update (`stripe-payment.ts:386`) |
| 15 | 15.12 payment_status gate | P | **S3-1** |
| 15 | 15.13 stripeEventId | B | `ports/payment.ts:268-283`; `route.ts:62` |
| 15 | 15.14 synchronous webhook decision | B | DEC-179, DEC-180 |
| 15 | 15.15 late money | B | `write-booking.ts:72-83`; `booking-webhook.ts:637-774`; tests `:319,354` |
| 15 | 15.16 reconciler | N | **money F3** |
| 15 | 15.17 unmatched charge | P | **S3-2** |
| 15 | 15.18 remove post-trip tip | P | **S2-4** |
| 15 | 15.19 delete hosted checkout | B | `booking-webhook.ts:224,409-428` |
| 15 | 15.20 tip pool "and no others" | B | `gratuity-payroll.test.ts:186-230` |
| 16 | 16.1 operator books | P | `operator-booking.ts:119-152`; `payment-link.ts:54-61`; **S3-4** |
| 16 | 16.2 cutoff spec | B | DEC-193; `docs/dictionary.yml:172-182` |
| 16 | 16.3 cutoff build | B | `availability.ts:344-347`; `claim.ts:142,352`; S4 row 12 (F17) |
| 16 | 16.4 discounts spec | B | DEC-194; `confirm-booking.ts:110-128` |
| 16 | 16.5 discounts build | B | `operator-booking.ts:88-89,146`; `discount.ts:78-109`; see S3-5 for the spec |
| 16 | 16.6 audit trail | B | `src/domain/reservation-trail.ts`; `reservation-trail-view.ts` |
| 16 | 16.8 flex insurance | B | `booking-invoice.ts:83,107`; `20261009025804_payment_flex_cents.sql:13`; S4 row 13 |
| 16 | 16.9 self-cancel | B | `refund-terms.ts:33-94`; `customer-cancel.ts:95,242-247` |
| 16 | #1021 Stripe round-trip test | P | **S3-6** |
| 16 | #1079 list to sell from | B | `calendar-list.tsx:20` |
| 16 | #1082 payment link | B | `pay-by-link.ts`; `app/(public)/p/[token]/` (A6) |
| 16 | #1089 location-block overlap | B | `availability.ts:413-420` |
| 16 | #1090 blocks polish | B | `app/(admin)/admin/blocks/*` (judged from the title) |
| 16 | #1091 blocking for a new admin | B | `calendar-view.tsx:196,399-401,774-818` (judged from the title) |
| 16 | #1092 one checkout form | B | `components/checkout/*`; `p/[token]/page.tsx:37` |
| 16 | #1103 UI consistency | B | Lint rule `muster/button-kind` (judged from the title) |
| 16 | #1104 calendar and card UI | B | `book-pane.tsx:22-27` (judged from the title) |
| 16 | #1112 checkout agreements | B | DEC-188; `checkout/actions.ts:176` |
| 16 | #1128 sticky column tops | B | `calendar-view.tsx:941-946,982`; only at the `lg` breakpoint with a pane open |
| 16 | #841 refund never raises a balance | B | `payment-config.ts:200-207`; DEC-199 |
| 16 | #1159 contact phone | B | `contact-phone.ts:29-78`; no control (S4 row 14) |
| 16 | #1212 tell the customer on every cancel | B | `[reservationId]/actions.ts:279`; `app/b/[code]/actions.ts:142`; `cancel-notice.ts:76-138` |
| 16 | #1217 refuse a changed total | B | `create-departure-payment-intent.ts:167-172,245-250`; tests `:1312-1551` |
| 16 | #1228 cancel frees the boat | B | `cancel-reservation.ts:259`; `postgres-repository.ts:1801-1863` (read) |
| 18 | 18.0 doc sweep | B | S4 row 20 |
| 18 | 18.1 schema | B | `20260929183642_check_in_and_waivers.sql`; `check-in-contract.ts:394-398` |
| 18 | 18.2 templates + settings | P | No BrewBoat v1 seed; S3-9 |
| 18 | 18.3 trip links + rate limiter | B | `20260930150902_rate_limits.sql`; `login-code.ts:172`; hashing dropped by DEC-190 |
| 18 | 18.4 signing page | B | `src/checkin/signing.ts:41,128,144,158`; `e2e/signing.spec.ts:4` |
| 18 | 18.5 crew check-in | B | `src/checkin/check-in.ts:147,151,172-174`; `uqr` (DEC-191); undo dropped by design |
| 18 | 18.6 party page | B | `app/b/[code]/party/page.tsx:99,108-109,124` |
| 18 | 18.7 reminders | B | `tick/route.ts:177`; `20261003185242_waiver_reminders.sql`; `reminders.ts:112,147-151` |
| 18 | 18.8 per-trip view + integrity | B | `integrity/page.tsx:52-58,114-130`; `departure.ts:71-73,328` |
| 18 | 18.10 signing links | B | `src/reservations/booking-confirmation.ts:68-69`; `app/b/[code]/page.tsx:263,268` |

Spec criteria verdicts, in brief:
- **§2.8 C1–C27:** C6, C21 and C22 are P. C14 (F2) and C17 (F3) are N, and C24 is N but not yet claimed (Phase 19). The rest are B.
- **§2.10 C1–C45:** C4 (`busy`), C35 (discount after writing) and C39 (past-due deposits) are P. C33 (deposit on the link) is N, not claimed. The rest are B.
- **§3.3:** P on refund policy, default and notify. N on rebook or credit, and on the cascade itself (F10).
- **§3.4:** P on the alert. N on evidence and on the dated alert (S3-7).

## 5. What could not be determined from the repository

- **Whether S2-1 can happen:** the two-tab interleave and the failed cancel were read, not staged.
- **The Postgres adapter:** `pendingOverlapSql`, `bookPendingIfHullFree`, `recordCheckoutAttempt`, `cancelBookingAndRelease`, the rate limiter and the unique slot index were all read, not run. Liveness compares `reserved_at` as text (`postgres-repository.ts:455`), which holds only while every row stores the full `toISOString()` form.
- **The Stripe Dashboard:**
  - which events each endpoint subscribes to (`payment_intent.processing`, `.canceled`, `charge.dispute.*`);
  - the account's enabled payment methods;
  - whether wallets appear. The spec says *"No wallets (card only)"* (`SPEC.md:2454`), but the intent sends `automatic_payment_methods: { enabled: true }` (`stripe-payment.ts:304`) and the Element restricts nothing.
- **Whether Stripe emails a receipt for an intent that never succeeds:** the check 14.8 names. No trace of it in the repository.
- **Production settings and data:** whether a BrewBoat waiver version is posted, and whether `booking.contact_phone`, `booking.cutoff_hours` and the 8% tax row exist.
- **Production flags:** whether `TIME_CLOCK` and `MESSAGING` are on.
- **Whether the sandbox Stripe suite has ever run against a real account.**
- **What the title-only rows asked for** (#1090, #1091, #1103, #1104, #1112): judged from code citing them, not from their issues, which this audit did not open.
- **Whether the operator accepts cancel-and-rebook** in place of a move action (S2-2), **and whether §3.3 and §3.4 are wanted before 2027-02-01.**
- **History:** the clone is shallow, so deletion dates rest on `docs/audit/2026-07-25/README.md`.
- **Anything outside the repository:** whether anything calls the unscheduled `xola-pull` or `doorbell-tick` routes, and whether `db:xola:report:email` is still on a crontab.
