# Audit: paired saves — two writes that must agree

**Audited:** `main` at `0c4bddf` (Merge pull request #1264). Read-only. Proposed in `docs/audit/README.md` § To do, item 8.

## Summary

I examined **70 write sequences**: two or more writes that must agree, across server actions, the Stripe webhook, the cron jobs and the core. **20 port methods are already one write**, one transaction or one guarded statement; I read the SQL for each and list them in §3.

Of the 70 sequences:
- **2 are already one write** at the call site.
- **19 could be one write** today, as one transaction or one port method: 15 are new here and 4 are known ledger findings.
- **48 must stay two** (a Stripe call, a message send or a cookie). Of those, 32 fail safe, 13 fail unsafe, and 3 are known findings.
- **1 has no second write at all** (payroll F3).
- **22 fail unsafe** in total, meaning a failure between the writes leaves a state nothing repairs, or one repaired only late or best-effort: 9 that could be one write and the 13 above.

There are **35 findings: 1 S1, 7 S2, 12 S3 and 15 S4**. The S1 is the customer cancel's refund leg, which nothing records as owed. It is the worked example's own sequence, one write further on.

No Postgres was available. Every adapter claim was **read, not run**, and every test ran against the in-memory repository. Thirteen of the findings are backed by probe tests: 19 probes in nine files. Their output and code are in §6. The probe files were deleted before this commit.

---

## 1. Findings

### S1

#### PS-1 — The customer's cancel commits, then the refund never runs, and nothing records that the refund is owed

**Writes**
1. `cancelBookingAndRelease` at `src/reservations/cancel-reservation.ts:259`.
2. The shift re-form, crew SMS relay and form audit, all awaited before control returns (`cancel-reservation.ts:283-309`).
3. The `cancelled` trail row (`src/reservations/customer-cancel.ts:190`).
4. The Stripe refund (`customer-cancel.ts:198` → `src/reservations/refund-payment.ts:223`).
5. The customer notice (`customer-cancel.ts:200` / `:215`), then the operator email (`app/b/[code]/actions.ts:155`).

**State left between them.** After write 1 commits, the booking is `cancelled` and its boat is free. If the process dies, the function times out or the connection drops anywhere before write 4, nothing else is written:
- no refund;
- no `refund_failed` row and no `cancelled` row;
- no notice and no operator email.

The window is not milliseconds. It contains a whole shift re-form and an SMS relay to crew. No `maxDuration` is set (cited by the cancel reader from DEC-179; the host's timeout was not read).

One variant is reachable without a crash. Write 1 commits and then throws, for example on a connection dropped after the commit. The fallback re-read at `customer-cancel.ts:173-178` is meant to handle this. If that re-read also fails, `:179` rethrows, and the customer is shown "Couldn't cancel just now. Nothing changed — try again" (`app/b/[code]/page.tsx:54-57`, cited by the reader) about a booking that is cancelled.

**What repairs it: nothing.**
- The customer's retry is refused before it reaches the refund: `reservation.status === "cancelled"` → `already_cancelled` (`customer-cancel.ts:132`). The comment there states the rule: "Money is refunded only by the press that did the cancelling".
- No reconciler exists (money F3).
- `/admin/integrity` has no check for a cancelled, paid, unrefunded booking (`src/admin/integrity.ts:113` checks only F12's case).
- `/admin/purchases` shows the row as cancelled with `refundedCents` 0 and flags nothing as owed (`src/reservations/purchases-view.ts:122,174`).
- A second error follows if the operator does notice. Their refund box prefills the full refundable amount, including the $50 the terms keep, because `owedAfterCustomerCancel` reads only the lost `cancelled` row (`app/(admin)/admin/calendar/[reservationId]/page.tsx:103-112`).

**Scenario.** A customer cancels a $640 charter 20 days out on the manage page. The cancel commits. The crew relay to Twilio is slow and the function is killed. The customer sees an error or a blank page, reloads, and the badge reads Cancelled. No refund is issued and nobody at the operator is told. The customer is owed $590.

**Can it be one write?** No. The refund is a Stripe call and cannot join the transaction. Cancel-first is the right order, and it is documented (`src/reservations/operator-cancel.ts:150-154`). What is missing is a durable record that a refund is owed. A proposal, not in the codebase: `cancelBookingAndRelease` writes the quoted refund cents (or a `refund_owed` marker) in the same transaction, and a retry or a sweep resumes the refund from it. The re-form could also move after the refund, which shrinks the window.

**Not a known finding.** Money F5 is a refund that ran and failed: it leaves a `refund_failed` row and a best-effort email. Here the refund never runs and nothing is written.

**Severity S1. Confidence: tested** (probes PS-1a and PS-1b, §6.1).

### S2

#### PS-2 — A residual-race loser that was refunded can later be booked as if it had paid

**Writes**
1. The Stripe refund (`src/reservations/booking-webhook.ts:660-663`).
2. The `auto_refunded` trail row (`:672-679`).
3. The write that should pair with them does not exist: nothing marks the loser's reservation non-pending. The comment at `:706-713` notes that "nothing reaps lapsed rows".

**State left.** The loser's row stays `pending`, still carrying a PaymentIntent that Stripe reports as `succeeded`. The flip guards only on the row's own status (`src/adapters/postgres-repository.ts:1562`). The live-pending overlap check exempts the row's own id (`:1610-1611`), and nothing checks that the row's own hold is still live.

If the rival's booking is later cancelled, the hull-day is free again. A later confirm of the loser's intent then wins the flip (`:1655-1668` resurrects the Event). That confirm can come from `/book/success?payment_intent=<loser>` (`src/reservations/confirm-booking.ts:84-94`), or from a webhook redelivery if the first delivery died after the refund. The booking then reads `booked`, with a `succeeded` Payment and no refund on the ledger. The customer holds both the refund and a confirmation, after an earlier "sold out, you've been refunded".

**What repairs it: nothing.** The `charge.refunded` for the auto-refund already arrived and was acked with no write while the row was pending (`booking-webhook.ts:1257-1258`, cited by the booking reader). `cancelPendingIfUnpaid`'s only caller is the unpaid phone-booking cancel (`src/reservations/cancel-reservation.ts:175`).

**Scenario.** Two buyers race for the 14:00 sunset trip, and B loses. B is refunded and texted "sold out". Next day A cancels. B's phone still has the success-page tab open and B reloads it. B is now booked, paid on Muster's ledger, refunded in Stripe, and confirmed. The operator runs a free trip and `/admin/purchases` counts the revenue.

**Can it be one write?** Not with the refund, which is external. The safe order is to mark the row `cancelled` first, then refund. If the refund then fails, the existing "REFUND MANUALLY" alert fires (`booking-webhook.ts:700-703`), and a redelivery lands on `not_pending`, which alerts again.

**Assumption, not verified.** This relies on Stripe keeping a refunded PaymentIntent at status `succeeded`, which is Stripe's documented behaviour. `getSucceededPaymentIntent` gates on that status (`src/adapters/stripe-payment.ts:334`, cited by the reader).

**Related but distinct:** money F7 (the success page's wording) and F13 (lapsed rows read "Pending").

**Severity S2.** The customer is not left owed, but the operator's books and screens say paid and booked. **Confidence: tested** (probe PS-2, §6.2).

#### PS-3 — The operator's cancel-and-refund has the same gap as PS-1

**Writes**
1. `cancelBookingAndRelease` (via `src/reservations/operator-cancel.ts:87`).
2. The trail row (`:131`).
3. The Stripe refund (`:217`).
4. The customer notice (`:79`).

**State left.** A crash after write 1 leaves the booking cancelled with no refund and no customer notice. The operator gets an error page.

**What repairs it: a person, if they notice.** The pane's standalone refund still works. Nothing records the refund as owed, and the customer is never told their trip is cancelled.

**Scenario.** The operator cancels a booking for weather, the function dies during the crew relay, and the operator moves on to the next booking.

**Can it be one write?** No; same proposal as PS-1.

**Severity S2.** The operator is the one who acted, so it is not S1. **Confidence: read.**

#### PS-4 — A comp flips to booked, then the confirmation claim throws; the operator is told it is not booked and the customer is never told

**Writes**
1. `confirmCompedRow` (`src/reservations/confirm-booking.ts:114`).
2. The `booked` trail row (`:117-125`).
3. `formAndConfirm` (`:126`), whose `claimConfirmationSend` sits outside any `try` (`src/reservations/booking-webhook.ts:1106`).
4. The send.

**State left.** Suppose the claim throws, or the process dies anywhere between write 1 and write 4. Then `confirmCompedBooking` rejects. `app/(admin)/admin/calendar/book-actions.ts:85-87` swallows the error and leaves `comped = "error"`, and the pane says the comp "didn't confirm, so it isn't booked yet" (`reservation-detail-pane.tsx:467-471`, cited by the reader). The row is in fact `booked`, with `confirmationSentAt` unset and no message sent.

**What repairs it: nothing automatic.** A comp has no webhook to redeliver it. `book-actions.ts:83` is the only caller of `confirmCompedBooking`. The same claim gap on the paid path heals by redelivery, which is why it is not a finding there.

**Scenario.** The operator comps a party of 4 for a make-good. A brief database blip throws at the claim. The pane says "not booked", so the operator cancels and books again, or rings the customer to say it failed. Either way the operator is working from a false status.

**Can it be one write?** Partly. The pane message should read the row's status, not the exception. The claim-and-send step should be best-effort inside `formAndConfirm`, the way the paid path treats the send.

**Related:** money F4 is the paid path's "failed send keeps the claim". This is a different trigger, with a false operator screen as well.

**Severity S2. Confidence: tested** (probe PS-4, §6.3).

#### PS-5 — The customer's `cancelled` trail row is best-effort, but the money screens read it as the truth

**Writes.** `cancelBookingAndRelease`, then `recordTrail` at `src/reservations/customer-cancel.ts:190`. `recordTrail` swallows every error (`src/reservations/trail.ts:56-65`).

**State left.** The `quotedCents` on that row is the only input to `cancelledNoticeFrom` and `owedAfterCustomerCancel` (`customer-cancel.ts:285-332`). Those two functions feed the manage-page notice (`app/b/[code]/load.ts:184-190`) and the operator's refund prefill (`app/(admin)/admin/calendar/[reservationId]/page.tsx:103-112`).

Lose the row, and then have the refund fail. A `refund_failed` row exists, but:
- the customer's manage page shows no refund notice;
- the operator's box prefills the full refundable amount, including the kept $50 or the insurance. That is one press away from the "Refund needed" email.

**What repairs it: nothing.**

**Scenario.** A trail-table hiccup coincides with a Stripe decline on the same cancel. The customer sees nothing about their refund. The operator, acting on the email, refunds $50 too much.

**Can it be one write?** Yes. Insert the trail row inside the `cancelBookingAndRelease` transaction, or store the quoted figure on the reservation in the same `update`.

**Severity S2. Confidence: tested** (probe PS-5, §6.1).

#### PS-6 — A merge that dies halfway drops side B's confirmed crew, and nobody is told

**Writes**
1. Side B's seats are deleted one by one (`src/builder/merge.ts:80-82`).
2. The side-B shift row is deleted (`:83`).
3. The canonical shift is saved with its cut cleared (`:91`).
4. The day is re-formed (`:99`).
5. The "you're off" texts and the `crew_removed` rows go out only if `mergeShift` returns (`app/(admin)/admin/shifts/actions.ts:110-145`, cited by the reader).

**State left after write 2.** Side B's row and seats are gone, but the canonical shift is still split (`splitCutTime` set).

**What repairs it: the tick, wrongly.** The next re-form rebuilds side B with fresh `Open` seats. A retried merge finds side B empty, so `freed` is empty. Side B's confirmed crew are never texted, and no audit row records their removal.

**Can it be one write?** It must be. Neither order is safe: saving the uncut shift first leaves a live side-B ghost, because the Postgres `removeShift` does not cascade to seats (`postgres-repository.ts:2104-2106`). A proposal, not in the codebase: a `mergeSplitDay` port method that does the teardown and the uncut save in one transaction, with the texts sent after the commit.

**Scenario.** The operator merges a split Saturday. The function dies after the delete. The evening deckhand is still expecting to work, the seat now reads Open, and the drip asks someone else.

**Severity S2. Confidence: tested** (probe PS-6, §6.4).

#### PS-7 — An import that dies in pass 3 hides cancellations from the operator

**Writes**
1. Events are saved with their derived status, `cancelled` when no reservation on them is booked (`src/import/import-reservations.ts:241`, `:245`).
2. Reservations are then saved one at a time (`:306`).

**State left.** Some events are `cancelled` while their reservations still read `booked`. The failed run writes no import-run row (`app/(admin)/admin/import/actions.ts:46-61` redirects before `persistImportRun`, cited by the reader).

**What repairs it: partly, a person.** A manual re-pull fixes the rows; `app/api/cron/xola-pull/route.ts` has no schedule attached (`:10-16`, cited by the reader). The re-pull does not fix the signal. Its `newlyCancelled` list compares against the stored row, so it leaves out every cancellation whose event already committed. That list is the "11pm call" signal (`import-reservations.ts:91-94`) and feeds the run audit (`app/lib/import-audit.ts:73-74`).

**Scenario.** Xola cancels a 20-person booking. The pull dies mid-pass. The retry reports no cancellation, and nobody calls the captain.

**Can it be one write?** Yes, as one transaction per pull. Alternatively, derive "newly cancelled" from import-run history rather than from the stored row.

**Not S1:** Xola holds the money.

**Severity S2. Confidence: tested** (probe PS-7, §6.5).

#### PS-8 — The flip commits, then the delivery dies; the `booked` trail row is never written

**Writes.** The flip, `bookPendingIfHullFree` (via `src/reservations/write-booking.ts:175`, cited by the reader), then the `booked` trail row (`src/reservations/booking-webhook.ts:872-887`).

**State left.** Suppose the commit lands and the caller then sees a throw (a commit acknowledgement lost, or the process dying). Stripe redelivers, and the redelivery resolves `already`. The `booked`-only guard is load-bearing by design (`:860-871`), so it skips the trail write forever. A trail outage at that moment loses the row too, because `recordTrail` swallows errors.

**What repairs it: nothing.** The redelivery heals the Payment and the confirmation, but not this row. The booking's history then has no sale entry. `soldByPhone` reads false for a paid phone booking (`src/reservations/reservation-trail-view.ts:408-409`, cited by the reader).

**Can it be one write?** Yes. Insert the trail row inside the flip's transaction (`postgres-repository.ts:1689-1715`).

**Severity S2 (low impact). Confidence: tested** (probe PS-8, §6.2).

### S3

#### PS-9 — Stripe refunds, then a local write throws, and the result is reported as "nothing moved"

**Writes**
1. `payments.refund` (`src/reservations/refund-payment.ts:223`).
2. `markPaymentRefunded` (`:253`), which sits outside the `try` at `:222-250`.
3. `releaseRefundLease`, in a `finally` (`:208`); if it throws, that error replaces a successful result.

**State left.** It depends on which path ran the refund:
- **Customer path:** the result is `{kind:"failed", movedCents:0}`, with a `refund_failed` row at 0. The operator is emailed "Refund needed… did not go through", although the money moved.
- **Operator path:** the result is `refundErr=unreachable` ("Nothing moved"), with no `refund_failed` row.
- **Two-leg refund:** if the second mark throws, the whole call rejects although both legs moved.
- **Comment:** the standalone refund's comment says "so no refund was issued" (`app/(admin)/admin/calendar/[reservationId]/actions.ts:374-376`, cited by the reader), which is false here.

**What repairs it:**
- The ledger is repaired by the `charge.refunded` webhook (`booking-webhook.ts:1279`). The route returns 500 on a throw, so Stripe redelivers (`app/api/webhooks/stripe/route.ts:54-63`).
- A same-day operator retry is deduped by the idempotency key (probe PS-9d).
- Nothing retracts the email or the "Nothing moved" copy.

**Can it be one write?** No, because the refund is external, and the order is right. The fix is in error accounting: report the mark per leg, and log a failed lease release rather than letting it override the result.

**Severity S3. Confidence: tested** (probes PS-9a–d, §6.1, §6.6).

#### PS-10 — A comp's pending row is written, then the confirm fails before the flip

**Writes.** `savePendingIfHullFree` writes the admin row at $0 (`src/reservations/operator-booking.ts:104`), then `confirmCompedBooking` (`app/(admin)/admin/calendar/book-actions.ts:83`).

**State left.** A throw before the flip (the vessel read, `resolveCustomerId`, or process death) leaves an admin `pending` row at $0. It holds the hull, never lapses (DEC-163, `operator-booking.ts:4-7`), and cannot be paid.

**What repairs it: a person.** The pane tells the operator to cancel and rebook. If the process died, there is no pane, only a failed request.

**Can it be one write?** Yes: a booked-at-claim variant of the flip for comps.

**Severity S3. Confidence: read.**

#### PS-11 — Sweeping a silent ask can charge the −3 twice

**Writes.** `ask_ignored` is logged (`src/asks/ask-loop.ts:612`), then the ask is closed (`:613`).

**State left / repair.** The event id includes `now`, so the next sweep logs a second −3. Nothing repairs it.

**Can it be one write?** Close the ask first, or make it one write.

**Severity S3. Confidence: tested** (§6.7).

#### PS-12 — A "Yes" is used up before the seat is claimed

**Writes.** The ask is stamped `accepted` (`ask-loop.ts:357`), then the claim compare-and-swap runs (`:411`).

**State left.** The seat stays `Asked`. A re-tap gets `already_answered`, and the person is barred from further asks. The drip keeps working the seat. This is not crewing S2-1, which fails after the claim.

**Can it be one write?** Yes: one port method.

**Severity S3. Confidence: tested** (§6.7).

#### PS-13 — A bail logs the penalty and leaves the person on the seat

**Writes.** `shift_bailed` is logged (`ask-loop.ts:661`), then the seat is reopened (`:678`).

**State left.** The penalty stands, the person is still Confirmed, and the caller is told `raced`. A retry charges again.

**Can it be one write?** Reopen first, or one port method.

**Severity S3. Confidence: tested** (§6.7).

#### PS-14 — An At-Risk alert is marked sent before it is sent

The `board_landed` dedupe row is written (`src/builder/tick.ts:546`) before the SMS (`app/api/cron/tick/route.ts:242`). If the send fails, the dedupe stops every later tick from alerting again (`tick.ts:538-545`). The board page still shows the shift.

**Must stay two.** Send-then-mark, or claim-and-release, fails safer.

**Severity S3. Confidence: read.**

#### PS-15 — A re-form uses up crew transitions before anyone is told

Shift state is written in `src/builder/form-shifts.ts:501`, `:643`. The texts and audit go out afterwards (`app/api/cron/tick/route.ts:93-98`). A crash or relay failure means no text and no audit row. The comment at `app/lib/channel.ts:76-81` already admits this (issue #766), but it is not in the ledger.

If `relayNotices` throws, `recordShiftChanges` is skipped too (`channel.ts:84-85`), and the in-app banner is lost.

**Severity S3. Confidence: read.**

#### PS-16 — A self-claim succeeds while telling the crew member it failed

The seat is claimed (`src/asks/claim.ts:174`), then the event, the ask withdrawal and the refresh run (`:180-189`). If it stops after the claim, the crew member sees `claim_error=unavailable` but is Confirmed. The +4 is missing, and other live asks are not withdrawn.

**Severity S3. Confidence: read.**

#### PS-17 — A remove or bail that fails at the refresh reports `raced`, and nobody is told

The seat is saved (`ask-loop.ts:826`), then the refresh runs (`:827`). The operator sees `act_error=raced` while the seat is already open. The "you're off" text and the `crew_removed` row are skipped.

**Severity S3. Confidence: read.**

#### PS-18 — A waiver-reminder window is claimed, then nobody is reminded

The window is claimed (`src/checkin/reminders.ts:135`) before the sends (`:150-151`). A crash after the claim uses up the window, with no message and no trail row. The release calls at `:154` and `:160` can themselves fail.

This order is by design ("never twice").

**Severity S3. Confidence: read.**

#### PS-19 — A crew DM is started with three writes and no transaction

The thread is written (`app/(crew)/crew/threads/actions.ts:93`), then my participant row (`:102`), then theirs (`:103`). If `:103` fails, the other person never sees the thread. Tapping Message again repairs it, because the ids are deterministic. Messaging is behind a flag.

**Severity S3. Confidence: read.**

#### PS-20 — Rotating a calendar feed saves the new token, then hands it over in a cookie

The feed is saved (`app/(crew)/crew/calendar/actions.ts:30`), then the flash cookie is set (`:36`). If the response is lost, the old URL is dead and the new token cannot be recovered; the crew member's calendar silently 404s. Minting again repairs it.

This must stay two, and the current order is the safe one.

**Severity S3. Confidence: read.**

### S4

| ID | Where | Finding | Confidence |
|---|---|---|---|
| PS-21 | `src/reservations/create-departure-payment-intent.ts:512-538` → `:545` | The PaymentIntent is minted, then `recordCheckoutAttempt` is lost. A retry with a changed guest count or tip reuses key `booking_<row>_<n>` with new parameters, and Stripe refuses it until the hold lapses. Bump the counter before the mint. | tested (§6.8) |
| PS-22 | `create-departure-payment-intent.ts:414` → `:445` | The reuse path raises the amount, then the re-freeze is lost. The customer's retry heals it. The webhook never compares the charge amount with the invoice, so a stale amount would go unflagged (no such route claimed). | read |
| PS-23 | `booking-webhook.ts:660`, key `refund_${charge.key}` | A residual-race redelivery more than 24 hours after a refund that landed would, if Stripe refuses the repeat refund, write `refund_failed` and send a false "REFUND MANUALLY" alert. | suspected |
| PS-24 | `booking-webhook.ts:1279` → `:1305` | `charge.refunded`: the ledger is written, then the trail row. A lost trail write returns 200, so there is no redelivery, and the `refunded` row is the only record of a dashboard refund. Could be one port method. | read |
| PS-25 | `postgres-repository.ts:1456-1459`; route `:60-63` | `markPaymentDisputed` is last-write-wins. A failed `live` delivery retried after `won` sets the row back to `disputed`. | suspected |
| PS-26 | `src/adapters/in-memory-repository.ts:755-772` | The in-memory `bookPendingIfHullFree` revives or inserts the Event before the whole-boat check can refuse. Postgres rolls that back (`postgres-repository.ts:1711-1713`). Tests can pass on a state production never reaches. | tested (§6.9) |
| PS-27 | `postgres-repository.ts:1347-1361`, `:3121-3133` | `setPaymentConfig` and `setCheckInConfig` upsert one key at a time with no transaction. Check-in has a production caller (`src/checkin/waiver-admin.ts:161`); payment config has none. | read |
| PS-28 | `app/api/calendar/[token]/route.ts:52-54` | `void repo.touchCalendarFeedPoll(...)`: on serverless the "last polled" stamp may never run; `after()` would guarantee it. | read |
| PS-29 | `app/(crew)/crew/actions.ts:159` → `:171` | A sign-in code is stored, then the email send fails silently. A re-request within 60 seconds sends nothing. It heals itself after 60 seconds. | read |
| PS-30 | `src/auth/login-code.ts:335` → `app/(crew)/crew/actions.ts:238` | The code is consumed before the session cookie is set. A cookie failure spends the code. This is the safe order. | read |
| PS-31 | `src/asks/escalate.ts:122` → `:124` | An escalation nudge is sent, then `nudged` is logged. If the log is lost, the one-nudge cap does not see the nudge. | read |
| PS-32 | every `catch { rollback; throw }` in `postgres-repository.ts` (e.g. `:1864-1866`) | A rollback that throws masks the original error. Whether pg-pool discards the broken client was not checked. | suspected |
| PS-33 | `app/(admin)/admin/calendar/actions.ts:100` → `:109` | When a hold is released, the trail row is its only record; a lost trail write loses it. | read |
| PS-34 | `src/reservations/recover-booking-link.ts:136` → `:146` | The recovery trail row says `sent` whatever the channels did, because the send result is discarded. | read |
| PS-35 | `src/adapters/fake-payment.ts:87-97` | The fake's `refund` dedupes on the key alone and never compares parameters, unlike its intent fake (`:124-131`). A same-key, different-amount refund that Stripe rejects passes in tests. That matters for U2 and PS-9. | read |

### Known findings met (not re-reported)

- **Money:**
  - F3: no reconciler (PS-1, PS-2).
  - F4: the paid path's claim and send (`booking-webhook.ts:1106-1145`).
  - F5: a failed self-service refund (the refund-ran variant of PS-1).
  - F7, F13: see PS-2.
  - F8: P4 of PS-9 reaches its end state by a different trigger.
  - F10: the operator cancel now tells the customer (`operator-cancel.ts:79`), but PS-3's window skips the notice.
  - F12: `cancelPendingIfUnpaid`'s caller.
  - F20, F21: the customer is created before the flip (`write-booking.ts:161-175`).
  - U2: refund key reuse; PS-9d shows it is also what makes a same-day retry safe.
  - U3: PS-1 and PS-9 apply to both copies of the cancel-and-refund sequence.
- **Capability URLs:** A1, A3 (`cancel-notice.ts:185`), A12, A14.
- **Payroll:** F3 (admin punch edits write no trail row), F8 (punch then trail, `src/crew/time-clock-crew.ts:111/120`).
- **Crewing:** S2-1, S2-4, S3-2, S3-4, S3-10 (PS-13's retry is the same effect from a new trigger), S3-16, S4-7, S4-11 (`tick.ts:354-363`).

---

## 2. Every sequence

Classes used below:
- **one** — already one write.
- **could** — two writes today that could be one.
- **two** — must stay two (external call, cookie, or a deliberate claim before an external send).

| # | Where | Writes, in order | One or two | Fails |
|---|---|---|---|---|
| 1 | `cancel-reservation.ts:259` | reservation cancelled + Event released | one | safe |
| 2 | `cancel-reservation.ts:259` → `:283-309` | cancel → re-form, crew relay, form audit | two | safe (the tick re-forms) |
| 3 | `customer-cancel.ts:158` → `:190` → `:198` → `:205`/`:215` → `app/b/[code]/actions.ts:155` | cancel → trail → Stripe refund → refund_failed → notice → operator email | two | **unsafe — PS-1 (S1), PS-5** |
| 4 | `operator-cancel.ts:87` → `:131` → `:217` → `:79` | cancel → trail → refund → notice | two | **unsafe — PS-3** |
| 5 | `refund-payment.ts:153` → `:223` → `:253` → `:208` | lease → Stripe → mark → release | two | **unsafe — PS-9** |
| 6 | `[reservationId]/actions.ts:363` → `:395`/`:423` | standalone refund → trail | two | **unsafe — PS-9** |
| 7 | `cancel-reservation.ts:175` → `:199` → `:207` | `cancelPendingIfUnpaid` → cancel PI → trail | two | safe (paid-but-unbookable alert backstop) |
| 8 | `cancel-notice.ts:185` → `:186` → `:192` | ensure code → email/SMS → trail | two | safe |
| 9 | `app/b/[code]/actions.ts:76` → `:92` | change-request email → trail | two | safe |
| 10 | `ensure-booking-code.ts:115` → `:130` | mint code → revoke earlier codes | two | safe (documented) |
| 11 | `recover-booking-link.ts:113` → `:134` → `:136` → `:146` | throttle claim → code → send → trail | two | safe (PS-34) |
| 12 | `admin/calendar/actions.ts:58` → `:69`; `:100` → `:109` | hold save/remove → trail | could | safe (PS-33) |
| 13 | `admin/blocks/actions.ts:44`/`:100` → cookie | block save → draft cookie | two | safe |
| 14 | `[reservationId]/actions.ts:100` → `:134` | Stripe balance session → trail | two | safe |
| 15 | `[reservationId]/actions.ts:486` → `:509` | resend confirmation → trail | two | safe |
| 16 | `booking-webhook.ts:1279` → `:1305` | `markPaymentRefunded` → trail | could | safe (PS-24) |
| 17 | `booking-webhook.ts:1424` → `:1428` → `:1430` | `markPaymentDisputed` → trail → alert | two | safe (PS-25 suspected) |
| 18 | `booking-webhook.ts:806-958` | flip → `booked` trail → retire siblings → form + confirm → gratuity → Payment | could | **unsafe — PS-8**; the rest reruns on redelivery |
| 19 | `booking-webhook.ts:1106-1145` | claim → send → release | two | known F4 |
| 20 | `booking-webhook.ts:656-773` | refund → trail → retire siblings → sold-out notice → alert; row never closed | two | **unsafe — PS-2**, PS-23 |
| 21 | `booking-webhook.ts:595-635` | Stripe cancel → trail (only if taken) | two | safe |
| 22 | `booking-webhook.ts:1502-1531` | balance `savePayment` → alerts | two | safe |
| 23 | `write-booking.ts:161-175` | customer get-or-create → flip | could | known F21 |
| 24 | `claim.ts:497-537` (reservations) | `savePendingIfHullFree` → `hull_contended`/`sold_out` trail | two | safe |
| 25 | `create-departure-payment-intent.ts:512-545` | mint PI → `recordCheckoutAttempt` | two | **unsafe — PS-21** |
| 26 | `create-departure-payment-intent.ts:414` → `:445` | raise amount → re-freeze | two | safe (PS-22) |
| 27 | `create-departure-payment-intent.ts:220-547` | pending row → cancel old PI → trail → mint | two | safe (hull held until lapse) |
| 28 | `book/checkout/actions.ts:125-143` | holder cookie → checkout | two | safe |
| 29 | `book-actions.ts:53-107`, `app/lib/payment-link.ts:51-78` | admin pending row → pay-link send → trail | two | safe (failure shown on pane) |
| 30 | `book-actions.ts:75-90`, `operator-booking.ts:104` | comp pending row → confirm | could | **unsafe — PS-10** |
| 31 | `confirm-booking.ts:114-126` | comp flip → trail → claim → send | could | **unsafe — PS-4** |
| 32 | `app/(public)/p/[token]/actions.ts:90-117` | pay-link cancel → trail → operator email | two | safe |
| 33 | `app/lib/booking-confirmation.ts:80-112` | ensure code → email/SMS | two | known F4 |
| 34 | `src/customers/resolve.ts:57-82` | get-or-create (retry on code collision) | one | safe |
| 35 | `merge.ts:80-99` | seat deletes → side-B delete → uncut save → re-form | could | **unsafe — PS-6** |
| 36 | `split.ts:75` → `:82` | cut save → re-form | two | safe (the tick re-forms; PS-15) |
| 37 | `import-reservations.ts:245` → `:306` | events → reservations | could | **unsafe — PS-7** |
| 38 | `import-reservations.ts:265` → `:306` | customer → reservation | two | safe (a re-pull repairs) |
| 39 | `app/lib/xola.ts:44` → `:54`, `import/actions.ts:78` → `:90` | pull → texts → import run → audit | two | **unsafe — PS-7/PS-15** |
| 40 | `tick/route.ts:86-101` | re-form → texts → audit | two | **unsafe — PS-15** |
| 41 | `tick.ts:420` → `route.ts:236` | shift save → asks → texts | two | known crewing S3-2 |
| 42 | `tick.ts:546` → `route.ts:242` | `board_landed` → alert SMS | two | **unsafe — PS-14** |
| 43 | `tick.ts:354-363` | Completed → `shift_completed` | could | known crewing S4-11 |
| 44 | `form-shifts.ts:562`, `:574`, `:643` | seat add/prune → shift save | could | safe (the next re-form repairs) |
| 45 | `ask-loop.ts:219-221`, `:252-253`, `:287-289` | seat Asked → ask → `ask_sent` | could | safe (the tick widens it) |
| 46 | `ask-loop.ts:357` → `:411` | accept stamp → claim CAS | could | **unsafe — PS-12** |
| 47 | `ask-loop.ts:580-585` | claim → confirm | could | known crewing S2-1 |
| 48 | `ask-loop.ts:437` → `:448` | decline event → seat Open | could | safe (the drip continues) |
| 49 | `ask-loop.ts:612` → `:613` | `ask_ignored` → ask closed | could | **unsafe — PS-11** |
| 50 | `ask-loop.ts:661` → `:678` → `:679` | bail event → seat → refresh | could | **unsafe — PS-13** |
| 51 | `ask-loop.ts:826` → `:827` | vacate → refresh → text/audit | two | **unsafe — PS-17** |
| 52 | `ask-loop.ts:873-879`, `shift/[shiftId]/actions.ts:222-241` | override → withdraw → refresh → text → audit | two | safe (documented best-effort) |
| 53 | `src/asks/claim.ts:174` → `:180-189` | self-claim → event → withdraw → refresh | two | **unsafe — PS-16** |
| 54 | `lean.ts:162-172`, `:238-241` | Bailed→Open → ask → nudged | two | safe |
| 55 | `escalate.ts:79` → `:122` → `:124` | `pool_widened` → ask → nudged | two | safe (PS-31) |
| 56 | `doorbell-tick.ts:126` → send | notify state → ring | two | safe (DEC-070; route unscheduled) |
| 57 | `reminders.ts:135` → `:140` → `:150-151` → `:154`/`:160` | claim → code → email/SMS → release | two | **unsafe — PS-18** |
| 58 | `time-clock-crew.ts:111/120`, `:156/167`, `:204/216` | punch → trail | could | known payroll F8 |
| 59 | time-clock admin actions | punch, no trail | — | known payroll F3 |
| 60 | `crew/threads/actions.ts:50` → `:61` → `:63` | thread → message → read state | two | safe (a re-post repairs) |
| 61 | `crew/threads/actions.ts:93` → `:102` → `:103` | thread → two participants | could | **unsafe — PS-19** |
| 62 | `crew/calendar/actions.ts:30` → `:36` | feed hash → flash cookie | two | **unsafe — PS-20** |
| 63 | `api/calendar/[token]/route.ts:52-54` | response → fire-and-forget touch | two | safe (PS-28) |
| 64 | `src/crew/crew-cli.ts:479` | Gusto update per member, in a loop | two | safe (a re-run is idempotent) |
| 65 | `crew/actions.ts:159` → `:171` | store code → email | two | safe (PS-29) |
| 66 | `login-code.ts:335` → `crew/actions.ts:238-239` | consume code → session cookie → clear email cookie | two | safe (PS-30) |
| 67 | `postgres-repository.ts:1347-1361`, `:3121-3133` | config keys one by one | could | safe (the admin resaves; PS-27) |
| 68 | `src/rate-limit/rate-limit.ts:68` → `:78` | count → refusal log | two | safe |
| 69 | `app/w/[code]/actions.ts:75` → `:93` | rate-limit count → `saveGuests` (one transaction) → clear draft cookie | two | safe |
| 70 | `postgres-repository.ts:3136-3174` | rate-limit sweep → upsert | two | safe (the sweep cannot touch the live row) |

Single writes with nothing to pair, read and dismissed: `app/(admin)/admin/actions.ts:26` (engine pause); the add-ons, locations, offerings and vessels saves; `app/lib/switch-actions.ts:24,41,58` (one session cookie); `api/guest-contact/route.ts:45` (A12).

**Tally of the 70 rows:**
- **one:** 2, both safe.
- **could:** 19 — 9 unsafe, 6 safe, and 4 known findings (F21, crewing S4-11, S2-1, payroll F8).
- **two:** 48 — 13 unsafe, 32 safe, and 3 known findings (F4 twice, crewing S3-2).
- **—:** 1, payroll F3 (no second write).
- **Unsafe:** 22.

---

## 3. Already one write

Postgres SQL read, not run.

| Port method | `postgres-repository.ts` | How |
|---|---|---|
| `cancelBookingAndRelease` | `:1801-1870` | begin; hull-day advisory lock; Event `for update`; guarded `update reservations … status='booked'`; release only when no other booked row; commit, rollback on throw |
| `bookPendingIfHullFree` | `:1516-1723` | one transaction under the hull-day advisory lock; row `for update`; overlap checks; Event insert or revive; flip; rollback on every `lost` (`:1711-1713`) |
| `savePendingIfHullFree` | `:1725-1782` | one transaction under the advisory lock |
| `cancelPendingIfUnpaid` | `:1784-1799` | one guarded update |
| `claimConfirmationSend` / `releaseConfirmationSend` | `:1927-1950` | one conditional update each |
| `recordCheckoutAttempt` | `:1882-1925` | one update: id append, counter, guarded re-freeze |
| `acquireRefundLease` / `releaseRefundLease` | `:1962-1997` | one transaction / one token-guarded delete |
| `claimRecoverySend` | `:2004-2032` | one transaction |
| `markPaymentRefunded` | `:1434-1447` | one update with `greatest`, never rewinds |
| `markPaymentDisputed` | `:1449-1477` | one update (deliberately last-write-wins, PS-25) |
| `savePayment`, `saveGratuity`, `appendTrailEvent` | `:1384-1412`, `:2035-2050`, `:2434-2454` | single insert with `on conflict (id) do nothing` |
| `addCrewMemberWithCredential` | `:968-1003` | begin/commit |
| `saveGuests` | `:2925-2968` | one transaction |
| `checkInGuestIfRoom` | `:2989-3036` | Event `for update`, count and update in one transaction |
| `saveImportRun` | `:2564-2599` | begin/commit around the run and its items |
| `recordShiftChanges` | `:2773-2798` | one multi-row insert |
| `saveSeatIfState` | `:2135-2154` | one conditional update |
| `consumeLoginCodeIfUnused`, `claimLoginAttempt` | `:2274`, `:2289` | one guarded statement each |
| `claimWaiverReminder` | `:3078-3089` | one insert, `on conflict do nothing` |
| `getOrCreateCustomerByPhone` | `:777-813` | one insert `on conflict (phone) do nothing`, then a read |

`src/adapters/memoizing-repo.ts` caches reads only (`:40-56`) and passes every write straight through (`:98`). There is no write-through cache for a failed write to leave stale.

---

## 4. What could not be determined from the code

- **Real Postgres behaviour.** Every adapter claim is from reading the SQL. In particular, it is unknown whether a connection lost after `commit` surfaces as a throw in this pool, which is the trigger for PS-1's variant and PS-8.
- **The host's function timeout.** No `maxDuration` is set. How often PS-1's window opens depends on the host plan; the window includes the crew SMS relay.
- **Stripe's behaviour:**
  - whether a refunded PaymentIntent keeps status `succeeded` (PS-2);
  - what a repeat refund does after the 24-hour key window (PS-23);
  - whether retries can reorder dispute events (PS-25);
  - whether production's webhook is subscribed with the right secret, on which PS-9's late repair depends (money F3).
- **pg-pool.** Whether it discards a client after a failed rollback when `release()` gets no error (PS-32).
- **The schema.** Whether `seats.shift_id` cascades on delete: the migrations were not read, and this affects PS-6's alternative order.
- **The tick and imported days.** Whether `listActiveVesselDays` picks up a day that has events but no shift row, which decides whether the tick repairs an import that never formed its shift.
- **The PS-7 half-state.** Which customer or operator screens read a Xola reservation `booked` on a `cancelled` event.
- **PS-26.** Whether a booked Muster row can point at a cancelled or missing slot Event in production, which is what PS-26 needs to matter.

---

## 5. Method

Four readers worked in parallel:
- booking creation and payment collection;
- cancels, refunds and changes;
- cron, crew, payroll, import and check-in;
- the Postgres adapter and the remaining server actions.

The lead re-read every S1 and S2 at its cited lines:
- `customer-cancel.ts:124-217`;
- `cancel-reservation.ts:250-330`;
- `booking-webhook.ts:640-719`, `:846-890`, `:1098-1117`;
- `postgres-repository.ts:1540-1630`, `:1784-1870`;
- `confirm-booking.ts:80-128`;
- `book-actions.ts:70-94`;
- `merge.ts:60-104`;
- `import-reservations.ts:236-315`.

The lead then re-ran all 19 probes in one pass (§6).

---

## 6. Probe tests

Probe tests were written as `*.audit-tmp.test.ts`, run with `npm test -- <file> --reporter=verbose`, and deleted before this commit. Each probe asserts the defect, so a ✓ means the defect reproduced. PS-26's probe asserts the correct behaviour, so its × is the finding.

The lead's re-run:

```
 ✓ src/reservations/customer-cancel.audit-tmp.test.ts > AUDIT: cancel committed, refund leg never runs > P1: write commits then throws AND the re-read throws -> rejects ('Nothing changed'), booking cancelled, no refund, no trail; the retry is refused as already_cancelled
 ✓ src/reservations/customer-cancel.audit-tmp.test.ts > AUDIT: cancel committed, refund leg never runs > P2: process dies after the cancel commits (modelled: cancel ran, nothing after) -> the customer's retry cannot reach the refund
 ✓ src/reservations/customer-cancel.audit-tmp.test.ts > AUDIT: cancel committed, refund leg never runs > P5: the customer `cancelled` trail row is lost (append throws, swallowed) and the refund fails -> refund_failed exists but no notice reads it; operator prefill is null (falls back to full refundable)
 ✓ src/reservations/customer-cancel.audit-tmp.test.ts > AUDIT: Stripe refund moved money, a later local write threw > P3: markPaymentRefunded throws after Stripe refunded -> reported as failed with movedCents 0; ledger unchanged
 ✓ src/reservations/customer-cancel.audit-tmp.test.ts > AUDIT: Stripe refund moved money, a later local write threw > P4: releaseRefundLease throws after a fully successful refund -> the finally's throw replaces success; reported failed movedCents 0 though ledger says refunded
 ✓ src/reservations/operator-cancel.audit-tmp.test.ts > AUDIT: operator cancel-and-refund / standalone refund > P6: markPaymentRefunded throws after Stripe refunded -> refundErr=unreachable ('Nothing moved'), no refund_failed row, money moved
 ✓ src/reservations/operator-cancel.audit-tmp.test.ts > AUDIT: operator cancel-and-refund / standalone refund > P7: a two-leg refund whose SECOND mark throws loses the first leg's report: rejects, though both legs moved
 ✓ src/reservations/operator-cancel.audit-tmp.test.ts > AUDIT: operator cancel-and-refund / standalone refund > P8: retry after P6-style failure re-plans the same leg with the same idempotency key -> Stripe (fake) returns the original refund; ledger catches up
 ✓ src/reservations/booking-webhook.audit-tmp.test.ts > AUDIT P1 — flip commits, then the delivery dies before the `booked` trail row > redelivery heals payment + confirmation but never writes the `booked` row
 ✓ src/reservations/booking-webhook.audit-tmp.test.ts > AUDIT P2 — a refunded residual-race loser is still a flippable pending row > after the rival cancels, a success-page confirm books the refunded row as paid
 ✓ src/reservations/comp-confirm.audit-tmp.test.ts > AUDIT P3 — comp flipped, confirmation claim throws > leaves a booked comp nobody was told about, reported to the operator as not booked
 ✓ src/reservations/create-departure-payment-intent.audit-tmp.test.ts > AUDIT P4 — intent minted, append lost > same-price retry heals: Stripe returns the same intent under the same key
 ✓ src/reservations/create-departure-payment-intent.audit-tmp.test.ts > AUDIT P4 — intent minted, append lost > changed-price retry is refused by Stripe's idempotency check, every time
 × src/adapters/paired-saves.audit-tmp.test.ts > audit probe: bookPendingIfHullFree lost-path writes (in-memory) > a mutex refusal after resurrecting a cancelled slot leaves the Event as it was
     AssertionError: expected 'scheduled' to be 'cancelled' // Object.is equality
 ✓ src/builder/merge.audit-tmp.test.ts > AUDIT PROBE: merge dies after side B is torn down > side B's confirmed crew lose their seat, nobody is told, and the next re-form rebuilds side B empty
 ✓ src/import/import-reservations.audit-tmp.test.ts > AUDIT PROBE: importRecords dies mid pass 3 > half-state: event cancelled, one reservation still booked; the retry reports only the uncommitted cancel
 ✓ src/asks/ask-loop.audit-tmp.test.ts > AUDIT PROBE: ask-loop paired writes > expireAsks: ask_ignored logged, ask close fails -> the next sweep charges ask_ignored again
 ✓ src/asks/ask-loop.audit-tmp.test.ts > AUDIT PROBE: ask-loop paired writes > recordResponse: accept stamped, claim CAS fails -> re-tap is already_answered, seat stays Asked
 ✓ src/asks/ask-loop.audit-tmp.test.ts > AUDIT PROBE: ask-loop paired writes > bail: shift_bailed logged, seat reopen fails -> bailer still Confirmed, penalty stands
```

Which probes back which findings:

| Section | Probe file | Backs |
|---|---|---|
| §6.1 | `src/reservations/customer-cancel.audit-tmp.test.ts` | P1/P2 → PS-1; P5 → PS-5; P3/P4 → PS-9 |
| §6.2 | `src/reservations/booking-webhook.audit-tmp.test.ts` | P1 → PS-8; P2 → PS-2 |
| §6.3 | `src/reservations/comp-confirm.audit-tmp.test.ts` | PS-4 |
| §6.4 | `src/builder/merge.audit-tmp.test.ts` | PS-6 |
| §6.5 | `src/import/import-reservations.audit-tmp.test.ts` | PS-7 |
| §6.6 | `src/reservations/operator-cancel.audit-tmp.test.ts` | PS-9 (P6–P8) |
| §6.7 | `src/asks/ask-loop.audit-tmp.test.ts` | PS-11, PS-12, PS-13 |
| §6.8 | `src/reservations/create-departure-payment-intent.audit-tmp.test.ts` | PS-21 |
| §6.9 | `src/adapters/paired-saves.audit-tmp.test.ts` | PS-26 |

The probe sources follow verbatim.

### §6.1 `src/reservations/customer-cancel.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired-saves audit, 2026-11-14) — temporary, the lead deletes it.
 * Each test asserts the CURRENT (defective or safe) behaviour so a pass documents it.
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import { cancelReservation } from "./cancel-reservation.js";
import {
  cancelByCustomer,
  cancelledNoticeFrom,
  manageRedirectFor,
  owedAfterCustomerCancel,
} from "./customer-cancel.js";

const VESSEL = asId<"VesselId">("vessel-brew-2");
const RESV = asId<"ReservationId">("resv-audit-1");
const NOW = "2026-08-01T16:00:00.000Z";
const SLOT = { date: "2026-08-25", time: "15:30" };
const EVENT_ID = asId<"EventId">(`slot_${VESSEL}|${SLOT.date}|${SLOT.time}`);
const PAID = 65800;
const FEE_REFUND = PAID - 5000;

const INVOICE: BookingInvoice = {
  fareCents: 50000, extrasCents: 0, taxCents: 4000, taxRateBps: 800, serviceFeeCents: 1800,
  serviceFeeBps: 300, gratuityCents: 10000, gratuityBps: 2000, totalCents: PAID, amountDueNowCents: PAID,
};
const payment: Payment = {
  id: asId<"PaymentId">("pay-full"), reservationId: RESV, method: "stripe", kind: "full",
  amountCents: PAID, taxCents: 4000, gratuityCents: 10000, serviceFeeCents: 1800, currency: "usd",
  status: "succeeded", stripePaymentIntentId: "pi_full", createdAt: "2026-07-01T10:00:00.000Z",
};
const event: Event = {
  id: EVENT_ID, vesselId: VESSEL, date: SLOT.date, time: SLOT.time, capacity: 16,
  status: "scheduled", source: "muster", price: 50000,
};
const reservation: Reservation = {
  id: RESV, eventId: EVENT_ID, source: "muster", customerName: "Rhea Tallis", partySize: 6,
  status: "booked", invoice: INVOICE,
};

async function seeded(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent(event);
  await repo.saveReservation(reservation);
  await repo.savePayment(payment);
  return repo;
}
const deps = (repo: InMemoryRepository, payments: FakePaymentPort) => ({ repo, now: () => NOW, payments });
const posted = { quotedCents: FEE_REFUND, expectedRefundedCents: 0 };
const trail = (repo: InMemoryRepository) => repo.listTrailEventsFor(RESV, []);

describe("AUDIT: cancel committed, refund leg never runs", () => {
  it("P1: write commits then throws AND the re-read throws -> rejects ('Nothing changed'), booking cancelled, no refund, no trail; the retry is refused as already_cancelled", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const realWrite = repo.cancelBookingAndRelease.bind(repo);
    const realGet = repo.getReservation.bind(repo);
    let wrote = false;
    let rereadFails = true;
    repo.cancelBookingAndRelease = async (...args) => {
      await realWrite(...args);
      wrote = true;
      throw new Error("connection reset");
    };
    repo.getReservation = async (id) => {
      if (wrote && rereadFails) {
        rereadFails = false;
        throw new Error("pool exhausted");
      }
      return realGet(id);
    };

    await expect(cancelByCustomer(deps(repo, fake), RESV, posted)).rejects.toThrow("connection reset");
    // The action maps this rejection to ?error=cancel_failed: "Couldn't cancel just now. Nothing changed".
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await repo.getEvent(EVENT_ID))?.status).toBe("cancelled");
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);

    // The customer presses again: refused, nothing refunded, nothing recorded.
    const retry = await cancelByCustomer(deps(repo, fake), RESV, posted);
    expect(retry).toEqual({ ok: false, reason: "already_cancelled" });
    expect(manageRedirectFor("CODE", retry)).toBe("/b/CODE");
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
    // The operator pane's refund box: no customer `cancelled` row, so the prefill falls back to the
    // whole refundable total (the kept $50 included), and the manage page shows no cancelled notice.
    expect(owedAfterCustomerCancel(await trail(repo))).toBeNull();
    expect(cancelledNoticeFrom(await trail(repo))).toBeNull();
  });

  it("P2: process dies after the cancel commits (modelled: cancel ran, nothing after) -> the customer's retry cannot reach the refund", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    // Write 1 alone — what a function timeout / crash after `cancelBookingAndRelease` leaves.
    await cancelReservation({ repo, now: () => NOW }, RESV, "customer");

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted)).toEqual({ ok: false, reason: "already_cancelled" });
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
    expect((await repo.listPaymentsForReservation(RESV))[0]?.refundedCents ?? 0).toBe(0);
  });

  it("P5: the customer `cancelled` trail row is lost (append throws, swallowed) and the refund fails -> refund_failed exists but no notice reads it; operator prefill is null (falls back to full refundable)", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    fake.refundError = new Error("card_declined");
    const realAppend = repo.appendTrailEvent.bind(repo);
    repo.appendTrailEvent = async (e) => {
      if (e.type === "cancelled") throw new Error("trail insert timed out");
      return realAppend(e);
    };

    expect(await cancelByCustomer(deps(repo, fake), RESV, posted)).toEqual({
      ok: true,
      refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 },
    });
    const rows = await trail(repo);
    expect(rows.map((r) => r.type)).toEqual(["refund_failed"]);
    expect(cancelledNoticeFrom(rows)).toBeNull();
    expect(owedAfterCustomerCancel(rows)).toBeNull();
  });
});

describe("AUDIT: Stripe refund moved money, a later local write threw", () => {
  it("P3: markPaymentRefunded throws after Stripe refunded -> reported as failed with movedCents 0; ledger unchanged", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    repo.markPaymentRefunded = async () => {
      throw new Error("update payments: connection reset");
    };

    const outcome = await cancelByCustomer(deps(repo, fake), RESV, posted);
    expect(outcome).toEqual({ ok: true, refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 } });
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0]?.amountCents).toBe(FEE_REFUND);
    expect((await repo.listPaymentsForReservation(RESV))[0]?.refundedCents ?? 0).toBe(0);
    expect((await trail(repo)).filter((r) => r.type === "refund_failed")).toMatchObject([
      { metadata: { actualCents: 0 } },
    ]);
  });

  it("P4: releaseRefundLease throws after a fully successful refund -> the finally's throw replaces success; reported failed movedCents 0 though ledger says refunded", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    repo.releaseRefundLease = async () => {
      throw new Error("delete refund_leases: connection reset");
    };

    const outcome = await cancelByCustomer(deps(repo, fake), RESV, posted);
    expect(outcome).toEqual({ ok: true, refund: { kind: "failed", cents: FEE_REFUND, movedCents: 0 } });
    expect(fake.refunds).toHaveLength(1);
    expect((await repo.listPaymentsForReservation(RESV))[0]?.refundedCents).toBe(FEE_REFUND);
    const rows = await trail(repo);
    expect(rows.filter((r) => r.type === "refund_failed")).toMatchObject([{ metadata: { actualCents: 0 } }]);
    // The manage page tells the customer their refund did not go through.
    expect(cancelledNoticeFrom(rows)).toEqual({ kind: "failed", cents: FEE_REFUND, movedCents: 0 });
  });
});
```

</details>

### §6.2 `src/reservations/booking-webhook.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired saves, read-only audit) — delete after the audit.
 *
 * P1: the flip commits, then the process/connection dies before the `booked` trail row. Stripe
 *     redelivers; the confirm resolves `already`; the `booked` row is never written.
 * P2: a residual-race loser is auto-refunded, but its row stays `pending`. Once the hull frees,
 *     a later confirm of the same (refunded, still Stripe-`succeeded`) intent books it and records
 *     a `succeeded` payment for money that was given back.
 */
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { eventIdForSlot } from "./availability.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { confirmBookingByPaymentIntent } from "./confirm-booking.js";

const NOW = () => "2026-07-12T00:00:00.000Z";
const V = asId<"VesselId">("v");
const DATE = "2026-07-04";
const TIME = "17:00";
const PEND = asId<"ReservationId">("resv-pend");
const PI = "pi_1";
const SLOT = eventIdForSlot(V, DATE, TIME);

const pendingRow = (over: Partial<Reservation> = {}): Reservation => ({
  id: PEND,
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Mary",
  partySize: 6,
  phone: "216-555-0148",
  email: "m@x.io",
  vesselId: V,
  date: DATE,
  time: TIME,
  offeringId: asId<"OfferingId">("off-1"),
  reservedAt: "2026-07-11T23:55:00.000Z",
  holdMinutes: 120,
  tripMinutes: 100,
  paymentIntentIds: [PI],
  invoice: {
    fareCents: 50000,
    extrasCents: 0,
    taxCents: 3625,
    taxRateBps: 725,
    serviceFeeCents: 0,
    serviceFeeBps: 0,
    gratuityCents: 0,
    gratuityBps: 0,
    totalCents: 53625,
    amountDueNowCents: 53625,
  },
  ...over,
});

const piEvent = (pi = PI) =>
  JSON.stringify({
    type: "payment_succeeded",
    data: { paymentIntentId: pi, amountReceivedCents: 53625, currency: "usd", metadata: {} },
  });

function makeDeps(repo: InMemoryRepository, payments = new FakePaymentPort()) {
  const confirm = vi.fn(async (_r: Reservation) => true);
  const soldOut = vi.fn(async (_c: unknown) => {});
  const alert = vi.fn(async (_m: string) => {});
  const deps: WebhookDeps = {
    repo,
    payments,
    now: NOW,
    alertPaidButUnbooked: alert,
    sendConfirmation: confirm,
    notifyCustomerSoldOut: soldOut,
  };
  return { deps, confirm, soldOut, alert, payments };
}

describe("AUDIT P1 — flip commits, then the delivery dies before the `booked` trail row", () => {
  it("redelivery heals payment + confirmation but never writes the `booked` row", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: V, name: "Brew", coiMaxPax: 12, manning: [] });
    await repo.saveReservation(pendingRow());

    // The commit lands, then the response is lost (connection drop / process death) — the
    // caller sees a throw AFTER the write took effect.
    let dropOnce = true;
    const dying = new Proxy(repo, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "bookPendingIfHullFree") {
          return async (...args: unknown[]) => {
            const r = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            if (dropOnce) {
              dropOnce = false;
              throw new Error("connection terminated after commit");
            }
            return r;
          };
        }
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as InMemoryRepository;

    const { deps, confirm } = makeDeps(dying);
    await expect(processBookingWebhook(deps, piEvent(), FAKE_SIGNATURE)).rejects.toThrow(/after commit/);
    expect((await repo.getReservation(PEND))!.status).toBe("booked");

    // Stripe redelivers (the route 500'd).
    const r2 = await processBookingWebhook(deps, piEvent(), FAKE_SIGNATURE);
    expect(r2).toEqual({ handled: true, outcome: "already" });
    expect(await repo.listPaymentsForReservation(PEND)).toHaveLength(1); // healed
    expect(confirm).toHaveBeenCalledOnce(); // healed

    const trail = await repo.listTrailEventsFor(PEND, [PI]);
    // The sale has no `booked` row, and nothing will ever write one.
    expect(trail.filter((t) => t.type === "booked")).toHaveLength(0);
  });
});

describe("AUDIT P2 — a refunded residual-race loser is still a flippable pending row", () => {
  it("after the rival cancels, a success-page confirm books the refunded row as paid", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: V, name: "Brew", coiMaxPax: 12, manning: [] });
    await repo.saveReservation(pendingRow());
    // A rival holds the slot.
    await repo.saveEvent({
      id: SLOT, vesselId: V, date: DATE, time: TIME, capacity: 12, status: "scheduled", source: "muster", price: 50000,
    });
    const RIVAL = asId<"ReservationId">("r-rival");
    await repo.saveReservation({
      id: RIVAL, eventId: SLOT, source: "muster", customerName: "Rival", partySize: 4, status: "booked",
    });

    const { deps, confirm, soldOut, payments } = makeDeps(repo);
    const r1 = await processBookingWebhook(deps, piEvent(), FAKE_SIGNATURE);
    expect(r1).toEqual({ handled: true, outcome: "lost" });
    expect(payments.refunds).toHaveLength(1); // money given back
    expect(soldOut).toHaveBeenCalledOnce(); // "sold out, refunded"
    expect((await repo.getReservation(PEND))!.status).toBe("pending"); // write 2 never happens

    // Later: the rival cancels (one transaction since issue #1228), the hull frees.
    await repo.cancelBookingAndRelease(RIVAL, SLOT, "customer", NOW());

    // Stripe keeps a refunded PaymentIntent at status `succeeded` (it is the CHARGE that is
    // refunded), so the success page's retrieve still reports it. Modelled here.
    payments.succeededIntents.set(PI, {
      paymentIntentId: PI, amountReceivedCents: 53625, currency: "usd", metadata: {},
    });
    const r2 = await confirmBookingByPaymentIntent(deps, PI);

    expect(r2).toEqual({ handled: true, outcome: "booked" });
    expect((await repo.getReservation(PEND))!.status).toBe("booked");
    const ledger = await repo.listPaymentsForReservation(PEND);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.status).toBe("succeeded"); // reads paid
    expect(ledger[0]!.refundedCents).toBeUndefined(); // the refund is nowhere on the ledger
    expect(payments.refunds).toHaveLength(1); // and the money is still refunded
    expect(confirm).toHaveBeenCalledOnce(); // customer now told "confirmed" too
  });
});
```

</details>

### §6.3 `src/reservations/comp-confirm.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired saves, read-only audit) — delete after the audit.
 *
 * P3: the comp's flip commits, then the confirmation claim throws (DB blip / process death).
 *     `confirmCompedBooking` rejects, so `book-actions.ts` renders `comped=error` ("isn't booked
 *     yet") — but the row IS booked, and the customer is never told. A comp has no webhook to
 *     redeliver it; only a second `confirmCompedBooking` call would heal it, and nothing makes one.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { confirmCompedBooking } from "./confirm-booking.js";

const NOW = () => "2026-07-01T12:00:00.000Z";
const RESV = asId<"ReservationId">("resv-comp");
const VESSEL = asId<"VesselId">("v");

const comped: BookingInvoice = {
  fareCents: 50000, extrasCents: 0, discountCents: 50000, taxCents: 0, taxRateBps: 725,
  serviceFeeCents: 0, serviceFeeBps: 300, gratuityCents: 0, gratuityBps: 2000, totalCents: 0, amountDueNowCents: 0,
};

const row: Reservation = {
  id: RESV, eventId: null, source: "admin", status: "pending", customerName: "Martin Brody",
  phone: "+12165550142", partySize: 4, vesselId: VESSEL, date: "2026-07-04", time: "17:00",
  offeringId: asId<"OfferingId">("off-1"), holdMinutes: 120, tripMinutes: 100, invoice: comped, updatedAt: NOW(),
};

describe("AUDIT P3 — comp flipped, confirmation claim throws", () => {
  it("leaves a booked comp nobody was told about, reported to the operator as not booked", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: VESSEL, name: "Brew", coiMaxPax: 12, manning: [] });
    await repo.saveReservation(row);

    const blip = new Proxy(repo, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "claimConfirmationSend") return async () => { throw new Error("pool timeout"); };
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as InMemoryRepository;
    const sendConfirmation = vi.fn(async (_r: Reservation) => true);

    // book-actions.ts:82-87 maps this rejection to `comped=error`.
    await expect(confirmCompedBooking({ repo: blip, now: NOW, sendConfirmation }, RESV)).rejects.toThrow(/pool timeout/);

    const stored = (await repo.getReservation(RESV))!;
    expect(stored.status).toBe("booked"); // the pane's "isn't booked yet" is false
    expect(stored.confirmationSentAt).toBeUndefined();
    expect(sendConfirmation).not.toHaveBeenCalled(); // customer never told

    // Only a second confirm would heal it; nothing in app/ makes one (grep: book-actions.ts:83 is
    // the sole caller).
    const healed = vi.fn(async (_r: Reservation) => true);
    expect(await confirmCompedBooking({ repo, now: NOW, sendConfirmation: healed }, RESV)).toBe("already");
    expect(healed).toHaveBeenCalledOnce();
  });
});
```

</details>

### §6.4 `src/builder/merge.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired-saves audit, 2026-11-14) — not a product test. Left in place on purpose.
 * Shows what a merge leaves behind when it dies between tearing down side B and saving the
 * uncut canonical (merge.ts:80-91), and what the next tick's re-form makes of it.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Event } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { seedFleet } from "../import/resource-map.js";
import { splitShift } from "./split.js";
import { mergeShift } from "./merge.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";

const PARTY = asId<"VesselId">("vessel-brew-2");
const DAY = "2026-07-18";
const CANON = asId<"ShiftId">(`shift-${PARTY}-${DAY}`);
const SIDE_B = asId<"ShiftId">(`shift-${PARTY}-${DAY}-b`);
const BEE = asId<"CrewMemberId">("bee");

const ev = (id: string, time: string): Event => ({
  id: asId<"EventId">(id),
  vesselId: PARTY,
  date: DAY,
  time,
  capacity: 16,
  source: "xola",
  status: "scheduled",
});

/** Throw on the first call of `method` whose args satisfy `when`, then behave normally. */
function failOnce(repo: InMemoryRepository, method: string, when: (args: unknown[]) => boolean): Repository {
  let armed = true;
  return new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (armed && prop === method && when(args)) {
          armed = false;
          throw new Error(`probe: ${String(prop)} failed`);
        }
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as Repository;
}

describe("AUDIT PROBE: merge dies after side B is torn down", () => {
  it("side B's confirmed crew lose their seat, nobody is told, and the next re-form rebuilds side B empty", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    await repo.saveEvent(ev("am", "11:00"));
    await repo.saveEvent(ev("pm", "17:00"));
    await formAllVesselDaysForTest(repo);
    await splitShift(repo, CANON, "14:00");
    const bSeat = (await repo.listSeatsForShift(SIDE_B))[0]!;
    await repo.saveSeat({ ...bSeat, state: "Confirmed", assignedCrewMemberId: BEE });

    // The uncut save of the canonical (merge.ts:91) fails — the only saveShift on CANON with no cut.
    const faulty = failOnce(repo, "saveShift", ([s]) => (s as { id: string; splitCutTime?: string }).id === String(CANON) && !(s as { splitCutTime?: string }).splitCutTime);
    await expect(mergeShift(faulty, CANON)).rejects.toThrow(/probe/);

    // Half-state: side B is gone, the canonical is still split.
    expect(await repo.getShift(SIDE_B)).toBeNull();
    expect((await repo.getShift(CANON))?.splitCutTime).toBe("14:00");
    console.log("after crash: sideB row =", await repo.getShift(SIDE_B), "canonical cut =", (await repo.getShift(CANON))?.splitCutTime);

    // The next tick's re-form (same per-day formShifts the tick's reformWindow runs).
    await formAllVesselDaysForTest(repo);
    const rebuilt = await repo.getShift(SIDE_B);
    const bSeats = await repo.listSeatsForShift(SIDE_B);
    const anyBee = [...(await repo.listSeatsForShift(CANON)), ...bSeats].some((s) => s.assignedCrewMemberId === BEE);
    console.log("after re-form: sideB state =", rebuilt?.state, "sideB seats =", bSeats.map((s) => `${s.id}:${s.state}`), "bee seated anywhere =", anyBee);
    expect(rebuilt).not.toBeNull();
    expect(bSeats.every((s) => s.state === "Open" && !s.assignedCrewMemberId)).toBe(true);
    expect(anyBee).toBe(false);
  });
});
```

</details>

### §6.5 `src/import/import-reservations.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired-saves audit, 2026-11-14) — not a product test. Left in place on purpose.
 * A pull that dies partway through pass 3 (import-reservations.ts:306) commits some cancellations;
 * the retry then counts them as already cancelled, so the run the operator reviews never lists them.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { importRecords, type RawReservationRecord } from "./import-reservations.js";

const VESSEL = asId<"VesselId">("vessel-brew-2");
const rec = (reservationId: string, status: "booked" | "cancelled"): RawReservationRecord => ({
  reservationId,
  product: "Brew Boat Party Boats with Captain",
  date: "2026-05-16",
  time: "15:30",
  eventId: "evt-1",
  vesselId: VESSEL,
  customerName: reservationId,
  partySize: 4,
  status,
});

/** Throw on the Nth call of `method` only. */
function failNth(repo: InMemoryRepository, method: string, n: number): Repository {
  let calls = 0;
  return new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (prop === method && ++calls === n) throw new Error(`probe: ${String(prop)} #${n} failed`);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as Repository;
}

describe("AUDIT PROBE: importRecords dies mid pass 3", () => {
  it("half-state: event cancelled, one reservation still booked; the retry reports only the uncommitted cancel", async () => {
    const repo = new InMemoryRepository();
    await importRecords(repo, [rec("r1", "booked"), rec("r2", "booked")]);

    const both = [rec("r1", "cancelled"), rec("r2", "cancelled")];
    await expect(importRecords(failNth(repo, "saveReservation", 2), both)).rejects.toThrow(/probe/);

    const ev = await repo.getEvent(asId<"EventId">("evt-1"));
    const r2 = await repo.getReservation(asId<"ReservationId">("resv-r2"));
    console.log("half-state: event", ev?.status, "r2", r2?.status);
    expect(ev?.status).toBe("cancelled");
    expect(r2?.status).toBe("booked");

    const retry = await importRecords(repo, both);
    console.log("retry newlyCancelled:", retry.newlyCancelled.map((r) => r.id));
    expect(retry.newlyCancelled.map((r) => r.id)).toEqual(["resv-r2"]); // r1 never reported
  });
});
```

</details>

### §6.6 `src/reservations/operator-cancel.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired-saves audit, 2026-11-14) — temporary, the lead deletes it.
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import { cancelByOperator } from "./operator-cancel.js";
import { refundReservation } from "./refund-payment.js";

const VESSEL = asId<"VesselId">("vessel-brew-2");
const RESV = asId<"ReservationId">("resv-audit-op");
const NOW = "2026-08-01T16:00:00.000Z";
const SLOT = { date: "2026-08-25", time: "15:30" };
const EVENT_ID = asId<"EventId">(`slot_${VESSEL}|${SLOT.date}|${SLOT.time}`);
const PAID = 65800;

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-full"), reservationId: RESV, method: "stripe", kind: "full",
  amountCents: PAID, taxCents: 4000, gratuityCents: 10000, serviceFeeCents: 1800, currency: "usd",
  status: "succeeded", stripePaymentIntentId: "pi_full", createdAt: "2026-07-01T10:00:00.000Z", ...over,
});
const event: Event = {
  id: EVENT_ID, vesselId: VESSEL, date: SLOT.date, time: SLOT.time, capacity: 16,
  status: "scheduled", source: "muster", price: 50000,
};
const reservation: Reservation = {
  id: RESV, eventId: EVENT_ID, source: "muster", customerName: "Rhea Tallis", partySize: 6, status: "booked",
};

async function seeded(payments: Payment[] = [payment()]): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent(event);
  await repo.saveReservation(reservation);
  for (const p of payments) await repo.savePayment(p);
  return repo;
}

describe("AUDIT: operator cancel-and-refund / standalone refund", () => {
  it("P6: markPaymentRefunded throws after Stripe refunded -> refundErr=unreachable ('Nothing moved'), no refund_failed row, money moved", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    repo.markPaymentRefunded = async () => {
      throw new Error("update payments: connection reset");
    };
    const r = await cancelByOperator(
      { repo, now: () => NOW, payments: fake },
      { reservationId: RESV, by: "operator", typedAmount: "", expectedRefunded: "0", adminId: "admin-1" },
    );
    expect(r.params).toEqual({ cancelled: "operator", refundErr: "unreachable" });
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0]?.amountCents).toBe(PAID);
    const rows = await repo.listTrailEventsFor(RESV, []);
    expect(rows.map((x) => x.type)).toEqual(["cancelled"]);
  });

  it("P7: a two-leg refund whose SECOND mark throws loses the first leg's report: rejects, though both legs moved", async () => {
    const repo = await seeded([
      payment({ id: asId<"PaymentId">("pay-dep"), kind: "deposit", amountCents: 20000, stripePaymentIntentId: "pi_dep", createdAt: "2026-07-01T10:00:00.000Z" }),
      payment({ id: asId<"PaymentId">("pay-bal"), kind: "balance", amountCents: 45800, taxCents: 0, gratuityCents: 0, serviceFeeCents: 0, stripePaymentIntentId: "pi_bal", createdAt: "2026-07-20T10:00:00.000Z" }),
    ]);
    await repo.saveReservation({ ...reservation, status: "cancelled" });
    const fake = new FakePaymentPort();
    const realMark = repo.markPaymentRefunded.bind(repo);
    let marks = 0;
    repo.markPaymentRefunded = async (id, total) => {
      if (marks++ > 0) throw new Error("update payments: connection reset");
      return realMark(id, total);
    };
    await expect(refundReservation({ repo, payments: fake, now: () => NOW }, RESV, PAID, 0)).rejects.toThrow(
      "connection reset",
    );
    expect(fake.refunds.map((x) => x.amountCents)).toEqual([45800, 20000]);
    const ps = await repo.listPaymentsForReservation(RESV);
    expect(ps.find((p) => String(p.id) === "pay-bal")?.refundedCents).toBe(45800);
    expect(ps.find((p) => String(p.id) === "pay-dep")?.refundedCents ?? 0).toBe(0);
  });

  it("P8: retry after P6-style failure re-plans the same leg with the same idempotency key -> Stripe (fake) returns the original refund; ledger catches up", async () => {
    const repo = await seeded();
    await repo.saveReservation({ ...reservation, status: "cancelled" });
    const fake = new FakePaymentPort();
    const realMark = repo.markPaymentRefunded.bind(repo);
    let fail = true;
    repo.markPaymentRefunded = async (id, total) => {
      if (fail) {
        fail = false;
        throw new Error("update payments: connection reset");
      }
      return realMark(id, total);
    };
    const d = { repo, payments: fake, now: () => NOW };
    await expect(refundReservation(d, RESV, PAID, 0)).rejects.toThrow();
    const again = await refundReservation(d, RESV, PAID, 0);
    expect(again.ok).toBe(true);
    expect(fake.refunds).toHaveLength(1); // deduped by key — no second refund
    expect((await repo.listPaymentsForReservation(RESV))[0]?.refundedCents).toBe(PAID);
  });
});
```

</details>

### §6.7 `src/asks/ask-loop.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired-saves audit, 2026-11-14) — not a product test. Left in place on purpose.
 * Each case fails ONE write in a two-write sequence in ask-loop.ts and shows the state left.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { bail, broadcastAsk, expireAsks, recordResponseAndConfirm } from "./ask-loop.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const SHIFT = asId<"ShiftId">("shift-1");
const T0 = new Date("2026-07-01T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function failOnce(repo: InMemoryRepository, method: string): Repository {
  let armed = true;
  return new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (armed && prop === method) {
          armed = false;
          throw new Error(`probe: ${String(prop)} failed`);
        }
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as Repository;
}

async function setup(): Promise<{ repo: InMemoryRepository; seatId: SeatId; a: CrewMemberId }> {
  const repo = new InMemoryRepository();
  const a = asId<"CrewMemberId">("crew-a");
  await repo.saveCrewMember({ id: a, name: "a", phone: "555", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">("cred-a"), crewMemberId: a, type: "MMC", expiry: "2026-12-31" });
  await repo.saveShift({ id: SHIFT, vesselId: asId<"VesselId">("vessel-x"), date: "2026-07-01", state: "Pending", eventIds: [] });
  const seatId = asId<"SeatId">("seat-1");
  await repo.saveSeat({ id: seatId, shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Open" });
  return { repo, seatId, a };
}

const types = async (repo: InMemoryRepository, a: CrewMemberId) =>
  (await repo.reliabilityEventsFor(a)).map((e) => e.type);

describe("AUDIT PROBE: ask-loop paired writes", () => {
  it("expireAsks: ask_ignored logged, ask close fails -> the next sweep charges ask_ignored again", async () => {
    const { repo, seatId, a } = await setup();
    await broadcastAsk(repo, seatId, T0);
    await expect(expireAsks(failOnce(repo, "saveAsk"), seatId, later(10 * 60_000), 5 * 60_000)).rejects.toThrow(/probe/);
    await expireAsks(repo, seatId, later(25 * 60_000), 5 * 60_000); // next tick
    const t = await types(repo, a);
    console.log("expireAsks events:", t);
    expect(t.filter((x) => x === "ask_ignored")).toHaveLength(2);
  });

  it("recordResponse: accept stamped, claim CAS fails -> re-tap is already_answered, seat stays Asked", async () => {
    const { repo, seatId, a } = await setup();
    const [ask] = await broadcastAsk(repo, seatId, T0);
    await expect(recordResponseAndConfirm(failOnce(repo, "saveSeatIfState"), ask!.id, "accepted", later(60_000))).rejects.toThrow(/probe/);
    const retry = await recordResponseAndConfirm(repo, ask!.id, "accepted", later(120_000));
    const seat = await repo.getSeat(seatId);
    console.log("retry outcome:", JSON.stringify(retry), "seat:", seat?.state, seat?.assignedCrewMemberId, "events:", await types(repo, a));
    expect(retry).toMatchObject({ claimed: false, reason: "already_answered" });
    expect(seat?.state).toBe("Asked");
  });

  it("bail: shift_bailed logged, seat reopen fails -> bailer still Confirmed, penalty stands", async () => {
    const { repo, seatId, a } = await setup();
    await repo.saveSeat({ id: seatId, shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: a });
    await expect(bail(failOnce(repo, "saveSeat"), seatId, T0, 0, undefined, a)).rejects.toThrow(/probe/);
    const seat = await repo.getSeat(seatId);
    console.log("after failed bail: seat", seat?.state, seat?.assignedCrewMemberId, "events:", await types(repo, a));
    expect(seat?.state).toBe("Confirmed");
    expect(await types(repo, a)).toContain("shift_bailed");
  });
});
```

</details>

### §6.8 `src/reservations/create-departure-payment-intent.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
/**
 * AUDIT PROBE (paired saves, read-only audit) — delete after the audit.
 *
 * P4: Stripe mints the intent, then `recordCheckoutAttempt` (the append of its id + the attempt
 *     counter) fails. The idempotency key is `booking_<row>_<attempts+1>` and the counter never
 *     moved, so a retry at the SAME price heals (Stripe hands back the same intent), but a retry at
 *     a DIFFERENT price reuses the key with new parameters, which Stripe refuses — the checkout is
 *     stuck on that row until the hold lapses.
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { createDeparturePaymentIntent } from "./create-departure-payment-intent.js";

const SMALL = asId<"VesselId">("v-small");
const BIG = asId<"VesselId">("v-big");
const OFF = asId<"OfferingId">("off-1");
const LOC = asId<"LocationId">("loc-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const now = () => "2026-07-01T12:00:00.000Z";

const vessel = (id: typeof SMALL, coiMaxPax: number): Vessel => ({ id, name: String(id), coiMaxPax, manning: [] });
const offering: Offering = {
  id: OFF, tenantId: asId<"TenantId">("t"), name: "Cruise", status: "live",
  vesselIds: [BIG, SMALL], locationId: LOC,
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
};
const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
const req = {
  offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000,
  customerName: "Mary", email: "m@x.io", phone: "+12165550148", holderToken: TOKEN,
};

async function world(): Promise<{ repo: InMemoryRepository; flaky: InMemoryRepository }> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering);
  await repo.saveVessel(vessel(SMALL, 6));
  await repo.saveVessel(vessel(BIG, 12));
  await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, now());
  let failOnce = true;
  const flaky = new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop === "recordCheckoutAttempt") {
        return async (...args: unknown[]) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("connection terminated");
          }
          return (v as (...a: unknown[]) => Promise<void>).apply(target, args);
        };
      }
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as InMemoryRepository;
  return { repo, flaky };
}

describe("AUDIT P4 — intent minted, append lost", () => {
  it("same-price retry heals: Stripe returns the same intent under the same key", async () => {
    const { repo, flaky } = await world();
    const pay = new FakePaymentPort();
    await expect(createDeparturePaymentIntent(flaky, pay, req, now)).rejects.toThrow(/terminated/);
    const [row] = await repo.listAllReservations();
    expect(row!.paymentIntentIds ?? []).toEqual([]); // Stripe has an intent the row does not name
    expect(pay.intents).toHaveLength(1);

    const r2 = await createDeparturePaymentIntent(flaky, pay, req, now);
    expect(r2.ok).toBe(true);
    expect(pay.intents).toHaveLength(1); // deduped
  });

  it("changed-price retry is refused by Stripe's idempotency check, every time", async () => {
    const { repo, flaky } = await world();
    const pay = new FakePaymentPort();
    await expect(createDeparturePaymentIntent(flaky, pay, req, now)).rejects.toThrow(/terminated/);

    // The customer adds a guest and resubmits — same holder token, same row, same counter.
    const bigger = { ...req, guestCount: 5 };
    await expect(createDeparturePaymentIntent(flaky, pay, bigger, now)).rejects.toThrow(/idempotent requests/);
    await expect(createDeparturePaymentIntent(flaky, pay, bigger, now)).rejects.toThrow(/idempotent requests/);
    const [row] = await repo.listAllReservations();
    expect(row!.checkoutAttempts ?? 0).toBe(0);
  });
});
```

</details>

### §6.9 `src/adapters/paired-saves.audit-tmp.test.ts`

<details><summary>source</summary>

```ts
// AUDIT PROBE (paired saves, 2026-11-14) — not a product test. Delete once the finding is triaged.
// Postgres rolls every write in `bookPendingIfHullFree` back on `lost` (postgres-repository.ts:1711-1713).
// Does the in-memory double also leave nothing behind when the whole-boat mutex refuses AFTER it has
// resurrected a cancelled slot Event (in-memory-repository.ts:738-772)?
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Event, Reservation } from "../domain/entities.js";
import { eventIdForSlot } from "../reservations/availability.js";
import { InMemoryRepository } from "./in-memory-repository.js";

const VESSEL = asId<"VesselId">("vessel-x");
const SLOT_ID = eventIdForSlot(VESSEL, "2026-07-01", "14:00");
const NOW = "2026-06-01T12:00:00.000Z";
const SINCE = "2026-06-01T11:45:00.000Z";

const slotEvent = (over: Partial<Event> = {}): Event => ({
  id: SLOT_ID,
  vesselId: VESSEL,
  date: "2026-07-01",
  time: "14:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

describe("audit probe: bookPendingIfHullFree lost-path writes (in-memory)", () => {
  it("a mutex refusal after resurrecting a cancelled slot leaves the Event as it was", async () => {
    const repo = new InMemoryRepository();
    // A cancelled Muster slot Event that a still-booked rival row points at.
    await repo.saveEvent(slotEvent({ status: "cancelled" }));
    await repo.saveReservation({
      id: asId<"ReservationId">("rival"),
      eventId: SLOT_ID,
      source: "muster",
      customerName: "Rival",
      partySize: 2,
      status: "booked",
    } as Reservation);
    await repo.saveReservation({
      id: asId<"ReservationId">("pend-1"),
      eventId: null,
      source: "muster",
      customerName: "Hooper",
      partySize: 2,
      status: "pending",
      vesselId: VESSEL,
      date: "2026-07-01",
      time: "14:00",
      offeringId: asId<"OfferingId">("off-1"),
      reservedAt: NOW,
      holdMinutes: 120,
      tripMinutes: 100,
    } as Reservation);

    const res = await repo.bookPendingIfHullFree(asId<"ReservationId">("pend-1"), slotEvent(), { updatedAt: NOW }, SINCE);
    expect(res.result).toBe("lost");
    // Postgres: the resurrect UPDATE is rolled back, so this reads "cancelled".
    expect((await repo.getEvent(SLOT_ID))!.status).toBe("cancelled");
  });
});
```

</details>
