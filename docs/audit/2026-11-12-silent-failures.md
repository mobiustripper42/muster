# Audit: silent failures, repo-wide

**When Muster catches or swallows an error, does a person ever find out?**

## 1. Summary

This audit read `main` at **`29046b6`** (merge of pull request #1259, 2026-11-11). Read-only. Five subagents read the code in parallel: payments and refunds, customer messages, operator alerts and cron, admin surfaces, and the crew app plus the rest of the core. The lead re-read every S1 and S2 at the cited lines before including it.

- **Catch sites.** `src/`, `app/` and `components/` (excluding tests) contain **280**: 256 `try`/`catch` and 24 `.catch(`. 179 of them call `logSwallowed`, and none uses `Promise.allSettled`. The table in §4 has **405 rows**. It also lists ignored result values, `?? default` reads, and screen copy that claims something happened.
- **Who finds out, per table row.** The class column was assigned mechanically from each row's "who finds out" cell, so treat these counts as approximate:
  - 135 tell the person who is on the screen at that moment.
  - 19 send a best-effort alert: one SMS or email, never retried.
  - 14 write a durable row that someone has to go and look for.
  - **151 reach only a log line.** `app/lib/swallowed.ts:34` and `src/log.ts:28` both say "nothing alerts on these".
  - **26 reach nobody.** There isn't even a log line.
  - 32 are not swallows: they rethrow, retry, or handle bad input.
  - 28 are mixed.
- **Findings.** 62 new findings: **S1 1, S2 18, S3 29, S4 14** (an S4 row can group several small items). About 20 known ledger findings came up again and are cited by id only.

**No alert in Muster is retried until it lands.** Every operator alert takes the same path: `alertMoneyProblem` (`app/lib/alert.ts:110-124`), `forwardBoardAlerts` and `forwardFormationFailures`. Each makes one SMS attempt per admin. The formation alert is the only one that comes back: it fires again on every tick while the failure lasts.

**No screen lists the things a person has to act on.** Every durable record of a failure is a row in the reservation trail, for example `refund_failed`, `sold_out_notice_failed`, `change_requested` or `waiver_reminder_failed`. The only cross-booking list of those rows is `/admin/booking-audit`, and it shows nothing unless someone filters for them (`app/(admin)/admin/booking-audit/page.tsx:73-77`).

Confidence keys: *tested* means a probe test reproduced it (sources in §6). *read* means read from the code only. *suspected* means the mechanism was read but its reachability was not established. No Postgres was available. Every claim about the Postgres adapter comes from reading the SQL, not running it.

Known ledger findings met along the way and not re-reported:
- money F2, F3, F4, F5/U1, F7, F8, F10, F20, F26, U2
- capability A8, A9, A12, A15
- crewing S1-5, S1-6, S2-1, S2-10, S3-2, S3-8, S3-10, S3-15, S4-8
- payroll F3, F8

---

## 2. Findings, most severe first

### S1

#### S1-1. A self-cancel that commits, loses its acknowledgement, and then fails its re-read tells the customer "Nothing changed". The booking is cancelled and the refund is never sent, and no record of it exists anywhere. (**tested**; needs two correlated database failures)

- **Code.** `cancelByCustomer` catches a throw from the cancel write and re-reads the row (`src/reservations/customer-cancel.ts:167-182`). If the re-read also throws, the `.catch` returns `null` (`:175-178`), so `reread?.status !== "cancelled"` is true and the original error is rethrown (`:179`). The action's comment says the opposite of what happens (`app/b/[code]/actions.ts:148-149`): *"`cancelByCustomer` rethrows only when a re-read finds the booking still booked, so nothing changed."* It redirects to `cancel_failed`.
- **What fails.** `cancelBookingAndRelease` committed: the booking and its event are cancelled and the boat is back on sale. None of the follow-on steps ran:
  - no `cancelled` trail row
  - no refund attempt and no `refund_failed` row
  - no operator email (gated on `outcome.ok`, `actions.ts:155`)
  - no customer notice
  - no shift re-form
- **Screen.** "Couldn't cancel just now. Nothing changed — try again in a moment." (`app/b/[code]/page.tsx:54-56`). If the customer presses again they get `already_cancelled` (`customer-cancel.ts:132`), which lands on a plain manage page with no notice (`:345-346`), because `cancelledNoticeFrom` finds no customer `cancelled` row.
- **Who finds out.** Nobody. `/admin/purchases` shows the row as "Cancelled" with the payment and $0 refunded. That looks the same as an operator cancel that owed nothing.
- **Spec.** §2.8.4c (SPEC:1903-1905): *"**Cancel first, then refund:** a refund that does not go through leaves the booking cancelled, and the operator is emailed to send it from the booking while the customer is told the team will."* Here no refund is attempted, and both people are told nothing happened.
- **Scenario.**
  1. A customer cancels a $658 uninsured booking 24 days out.
  2. The commit lands, but the pooled connection resets before the acknowledgement arrives, and the re-read on the same pool fails too.
  3. The customer reads "Nothing changed" and reloads.
  4. They see "Cancelled" and wait for a $608 refund that nothing will ever send.
- **Severity / confidence.** S1, because the customer is owed money and nobody who could fix it ever finds out. It is low-likelihood: it needs a lost commit acknowledgement followed by a second failure. Tested on the in-memory repository (§6, P-A3). Whether Postgres can lose a commit's acknowledgement this way is a property of the driver and the network, and was not run. The code itself assumes it can (`src/reservations/cancel-reservation.ts:256-258`).

### S2

#### S2-1. After an operator refund that moved money and then hit a database error, the screen says "Nothing moved". A second press refunds again. (**tested**)

- **Code.** In `refundReservation`, two writes can throw after Stripe has already refunded:
  - `markPaymentRefunded` (`src/reservations/refund-payment.ts:253`), which runs right after the successful `payments.refund`. It is not guarded.
  - `releaseRefundLease` in the `finally` (`:203-209`), which runs after a successful plan and hides the `ok: true` result.

  Either throw reaches `refundBooking`'s catch (`app/(admin)/admin/calendar/[reservationId]/actions.ts:373-378`). Its comment is false: *"Reaching here means the call threw OUTSIDE the provider loop … so no refund was issued."* `cancelByOperator` has the same shape at `src/reservations/operator-cancel.ts:216-229`.
- **Screen.** "Couldn't refund just now. Nothing moved. Try again in a moment." (`reservation-detail-pane.tsx:290-291`). No trail row is written, because `refund_failed` is written only for `provider_error` (`actions.ts:383-415`).
- **Who finds out.** The operator is on the screen and is told the opposite of what happened.
  - If the lease release is what threw, the ledger was written and the pane's money block shows the refund, next to a notice saying nothing moved. A retry after the 60-second lease (`refund-payment.ts:46`) builds a new cumulative idempotency key (`:230`) and refunds a second time.
  - If the ledger write is what threw, a retry reuses the same key. Stripe returns the same refund within its key window, and `charge.refunded` repairs the ledger.
- **Scenario.**
  1. The operator refunds $200 goodwill.
  2. The connection drops while the lease row is deleted, and the pane says "Nothing moved".
  3. Two minutes later the operator presses it again.
  4. The customer gets $400 back.
- **Confidence.** Tested (§6, P-A2): two refunds came from one $200 decision. Severity is S2 rather than S1 because the money block on the operator's own screen does show the first refund.

#### S2-2. A pay-link payment that lands on a cancelled phone booking writes no payment row, no trail row and no refund. The customer is told "You're booked!" and later "Nothing was charged". (**tested**)

- **Code.**
  - Cancelling an unpaid phone booking retires its open intents best-effort only. A refused intent cancel is logged and nothing else happens (`src/reservations/cancel-reservation.ts:199-205`).
  - When the customer's payment then succeeds, `confirmPendingRow` returns `not_pending` (`src/reservations/write-booking.ts:82`). The webhook makes one alert attempt and returns `unbookable` (`src/reservations/booking-webhook.ts:830-837`), and the module skips the trail row on purpose (`:476-477`).
  - `unusable_row` (`write-booking.ts:123-136`) takes the same branch.
- **Screen.**
  - The pay link returns to `/book/success`, which maps `unbookable` to `pending` (`src/reservations/booking-outcome-view.ts:44-48`) and renders "You're booked! Payment received." (`app/(public)/book/success/page.tsx:113-121`).
  - Reopening `/p/<token>` renders "Booking cancelled … **Nothing was charged.** Your card was never charged for this trip" (`app/(public)/p/[token]/page.tsx:237-244`). That page decides from `status` alone.
- **Who finds out.** One best-effort SMS from each confirm path (`app/lib/alert.ts:110-124`). Nothing durable: `/admin/purchases` shows "Cancelled", $0 paid. Stripe's dashboard is the only record. If the SMS fails, nobody is ever told, and severity becomes S1.
- **Spec.** §2.8 (SPEC:2186-2189): *"a payment that *should* have matched and does not … means money moved with nothing behind it. The one thing it must never do is pass quietly."*
- **Scenario.**
  1. A phone booking's link is texted, and the customer reaches their bank's 3-D Secure screen.
  2. The customer phones to cancel. The operator cancels, and Stripe times out on the intent cancel.
  3. The customer approves on the bank screen and is charged $536.25.
  4. `/book/success` says "You're booked!". The one SMS to the admins gets a Twilio 503.
- **Confidence.** Tested (§6, P-A1). Whether Stripe can always cancel a `requires_action` intent is Stripe's behaviour and not knowable from the code. The scenario needs the cancel call to fail or time out.

#### S2-3. The sold-out-while-paying office alert says "No action needed; the customer has been told" whether or not anyone told them. (**tested**)

- **Code.** The customer notice is attempted at `src/reservations/booking-webhook.ts:721-734`. The office alert after it is unconditional (`:756-761`). The production sender `sendSoldOutNotice` never throws and returns `void`: it records each channel's failure to `onFailure` (a `console.error`) and to a trail row (`src/reservations/sold-out-notice.ts:80-101`; `app/lib/sold-out-notice.ts:16-61`). So the webhook has no way to know, and the alert says the customer was told.
- **Screen.** Office SMS: "SOLD OUT WHILE PAYING - charge … was auto-refunded in full. No action needed; the customer has been told."
- **Who finds out.** The operator is told explicitly not to act. The only true record is a `sold_out_notice_failed` row. It has no `reservationId` (`sold-out-notice.ts:115-116`), so it does not appear on the booking's own history, only on `/admin/booking-audit`. The customer sees a charge and a refund on their statement with no explanation.
- **Spec.** §2.8.7 (SPEC:2228): *"**The refund and the message are one path:** a refund nobody was told about reads as a silent failed payment."*
- **Confidence.** Tested (§6, P-B1). Two shards found this independently (A-5, B-1). Not money F7, which is about the `/book/success` card.

#### S2-4. When a confirmation reports "nobody was told", the claim is released, the webhook answers 200, and nothing ever retries. (**tested**)

- **Code.**
  - `src/reservations/booking-webhook.ts:1106-1146` claims, sends, and releases the claim when `!told`. The release comment names the next callers: *"a provider redelivery, the success page, §2.8.9's reconciler"* (`:1126-1129`). None of them retries:
    - The webhook route returns 200 (`app/api/webhooks/stripe/route.ts:52`), so Stripe does not redeliver.
    - The reconciler is not built (money F3).
    - The success page retries only if the customer reloads it.
  - `told = false` comes from `sendReservationConfirmation`'s outer catch (`app/lib/booking-confirmation.ts:113-118`): `appBaseUrl()` throwing, `ensureBookingCode` failing or a repository blip, or no email env with Twilio dark.
  - The trail type `confirmation_skipped` ("Confirmation NOT sent") is offered in the booking-audit filter (`src/admin/reservation-trail-list.ts:97`). No production code writes it; only `src/reservations/seed-trail.ts:125` does.
- **Screen.** "You're booked! … Check your texts and email." (`app/(public)/book/success/page.tsx:120-127`).
- **Who finds out.** Log only. No screen lists booked rows with a null `confirmationSentAt`.
- **Spec.** §2.8.6 (SPEC:2176-2177): *"A sender whose send then fails gives the claim back."* §2.8.9 (SPEC:2289): *"no human is ever the one who notices."*
- **Relation to the ledger.** Money F4 is the branch where `told` is true over a failed send (`app/lib/booking-confirmation.ts:112`), which still exists. This finding is the other branch: release followed by no retrier. It exists in practice because of F3.
- **Confidence.** Tested (§6, P-B4).

#### S2-5. A manage-page change or cancel request shows "we've sent your request to the team", whether or not the email went. (**read**)

- **Code.** `app/b/[code]/actions.ts:59-86`. The operator email is skipped when `OPERATOR_NOTIFY_EMAIL` or the email env is unset, and that skip is logged only in production (`:81-83`). A send failure is `console.error` only (`:84-86`). The redirect at `:102` is unconditional.
- **Screen.** "Got it — we've sent your {cancellation|change} request to the team and we'll be in touch shortly." (`app/b/[code]/page.tsx:205-208`).
- **Who finds out.** Nobody is pushed. The `change_requested` trail row (`actions.ts:92-101`) shows on that booking's history and on `/admin/booking-audit`, but only to someone who goes looking.
- **Spec.** §2.8.12 (SPEC:2420-2423): *"the operator gets an email; nothing changes until a person acts on it. So does a cancel that earns no refund … so a customer who would get nothing back always reaches a human first."*
- **Scenario.** A customer five days out asks to move their date, after the Resend key has been rotated. They read "we'll be in touch shortly", and nobody is.
- **Confidence.** Read. Found by shards A (A-6) and B (B-3).

#### S2-6. The operator's cancel always prints "the crew have been told". Crew notice failures go only to a log, and nothing retells the crew. (**read**)

- **Code.**
  - The copy is unconditional: `app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx:155`. Neither `cancelByOperator` nor `cancelReservation` returns a relay outcome (`operator-cancel.ts:79-80`, `cancel-reservation.ts:326-330`).
  - Inside `cancelReservation`:
    - formation failures go to `console.error` (`:292-297`)
    - a relay throw goes to `logSwallowed` (`:298-302`)
    - an outer formation throw goes to `logSwallowed` (`:310-323`)
  - Inside the relay, `forwardNotices`:
    - swallows each crew member's send failure (`src/adapters/forward-notices.ts:97-113`)
    - skips a missing crew or shift row without even a log line (`:58,60`)
    - counts a Twilio-dark log-only send as forwarded (`:96`)
    - `relayNotices` then throws the count away (`app/lib/channel.ts:71`)
- **Who finds out.** Log only. The shift has already collapsed by then, so the next tick sees no difference and never relays.
- **Spec.** §3.1 (SPEC:3096): *"**Live card updates** → to assigned crew, when a shift's details change."*
- **Scenario.** A weather cancel at 11 pm hits a Twilio 429 for the captain. The pane says the crew have been told, and the captain drives to the dock.
- **Confidence.** Read. Found by shards A (A-4) and B (B-5).

#### S2-7. With Twilio unset, the sold-out notice records "Sold-out notice sent" for a message that only reached the log. (**tested**)

- **Code.** `src/reservations/sold-out-notice.ts:93-96` throws away the `SendResult`, so `loggedOnly` (`src/ports/channel.ts:102`; `src/adapters/log-channel.ts:148`) is never read.
- **Screen.** `/admin/booking-audit`: "Sold-out notice sent".
- **Who finds out.** Nobody. Together with S2-3, both the trail row and the office alert say the customer was told.
- **Spec.** §2.8.4c (SPEC:1941-1942): *"A message that only reached a server log was not sent (DEC-170)."*
- **Confidence.** Tested (§6, P-B2). This bites only when Twilio is not configured, and the ledger (capability A9) says production has Twilio. It is still the one customer sender that ignores `loggedOnly`.

#### S2-8. Nothing notices when the cron tick stops running. (**read**)

- **Code.**
  - `/api/cron/tick` is the only scheduled job (`vercel.json:7-9`). It carries asks, At-Risk pings, the formation backstop for paid bookings (`app/api/cron/tick/route.ts:65-76`), the Stripe webhook-endpoint check (`:124-166`) and waiver reminders (`:176-182`).
  - Nothing records that a tick ran. A grep for `heartbeat|lastTick|tickRanAt` finds only a comment in `src/reservations/webhook-health.ts:12`.
  - `/api/health` checks only `select 1` (`app/api/health/route.ts:41`).
  - Inside the route, only `getRepo()`, `isEnginePaused()` (`:184`) and `tick()` (`:222-228`) can return a non-2xx. Every other step fails with HTTP 200 and `ok:true`.
- **What fails.** A rotated `CRON_SECRET` returns 401 on every run (`:39-42`). So does a dropped cron entry, or one step that throws every time.
- **Screen.** Nothing. `/admin/at-risk` is computed on read, so the board looks normal.
- **Who finds out.** Only someone reading Vercel's cron dashboard or logs. The first signal reaching a person is a trip that sails uncrewed, or a paid booking that never got a shift.
- **Spec.** §2.5 (SPEC:1083): *"**Push, not pull.** A shift reaching the board **pings Eric**."*
- **Confidence.** Read. Not crewing S2-7 or S3-2, which are about overlapping or half-failed ticks, not missing ones.

#### S2-9. A failed engine Pause/Resume shows no error: the error banner is sent to a page that throws it away. (**tested**)

- **Code.** `app/(admin)/admin/actions.ts:34` redirects to `/admin?engine_error=unavailable`. `app/(admin)/admin/page.tsx:26` is `redirect("/admin/shifts")`, which drops the query. The only page that reads `engine_error` is `settings/page.tsx:51`. Success also redirects to `/admin` (`actions.ts:40`), so failure and success look exactly the same.
- **Screen.** None. The intended copy at `settings/page.tsx:52` is never shown.
- **Who finds out.** Log only. The code's own comment states what is at stake (`actions.ts:30-32`): *"A pause the operator believes took and did not means the ask engine keeps texting crew."*
- **Confidence.** Tested (§6, P-D).

#### S2-10. Lean, Assign and Nudge save the ask, then the relay throws, and the operator is told "nothing was sent". The crew member is later charged `ask_ignored`. (**tested** for Lean)

- **Code.** `app/(admin)/admin/at-risk/actions.ts:34-51`, and `shift/[shiftId]/actions.ts:136-154` (assign) and `:162-177` (nudge). `lean` and `assignFromPool` write the ask, and then `relayAsks` runs in the same `try` (`app/lib/channel.ts:50-56`). Any throw after the write falls into the catch.
- **Screen.** At-Risk: "Couldn't reach the schedule — nothing was sent. Try again." (`at-risk/page.tsx:39`). Cockpit: "…nothing was changed. Try again." (`components/assignment/shift-cockpit.tsx:58`).
- **Who finds out.** Log only.
  - A retry returns `already_asked`.
  - The shift leaves the At-Risk board because an ask is now in flight (`at-risk/actions.ts:43`).
  - When the ask times out, the sweep charges `ask_ignored` to someone who was never texted.
- **Spec.** §2.4 (SPEC:972): *"**Assign a person** — name someone into a seat; they get an ask."*
- **Confidence.** Tested (§6, P-D). This is the manual counterpart of crewing S3-2.

#### S2-11. After a merge, the banner says "N crew notified" even when the notice threw. (**tested**)

`app/(admin)/admin/shifts/actions.ts:117-120` swallows the `relayNotices` throw. `:154` then sets `merge_ok=${toNotify.length}`, which `shifts/page.tsx:436` renders as "Merged into one shift — 2 crew notified they're off the later half." Log only. The probe produced `merge_ok=2` while the relay threw (§6, P-D).

#### S2-12. Cockpit success banners promise a delivery the code never checks. (**read**)

`notify()` (`app/(admin)/admin/shift/[shiftId]/actions.ts:110-130`) swallows every error, and `relayAsks`/`relayNotices` throw away the count they forward (`app/lib/channel.ts:55,71`). The banners still say:
- "…they've been told." (`components/assignment/shift-cockpit.tsx:333,338`)
- "Asked {name} into the seat — awaiting their reply." (`:315`)

Log only. The comment at `:126-127` admits *"nothing on the operator's screen says the telling failed."*

#### S2-13. A no-penalty remove that went through, then hit an error, is shown as a race. The removed person is not told, and no audit row is written. (**read**)

`shift/[shiftId]/actions.ts:272-294`: `vacateSeat` saves the seat, and a later write throws. `notify` and `logCrewRemoved` never run. The screen says "That seat just changed — here's the fresh state." (`shift-cockpit.tsx:52`). Log only. The code calls its own copy "a GUESS" (`:290-292`).

#### S2-14. A manual Xola pull that fails in the database is reported as "Couldn't reach Xola — nothing was pulled". (**read**; reachability suspected)

`app/(admin)/admin/import/actions.ts:46-61`. Every Xola fetch has finished before any write (`src/import/xola-pull.ts:155,160,179,212`), so a later throw comes from the repository. It is still mapped to `x_unavailable`, which renders "Couldn't reach Xola — nothing was pulled." (`import/page.tsx:39`).

Both halves are false. Xola answered, and the writes may be partly done (issue #766). The crew notices for transitions the pull consumed are lost.

#### S2-15. Notices from split, merge and the Xola pull fire once and are never retried. A failure goes only to a log, and the screen says "done". (**read**)

The relays at `app/(admin)/admin/shifts/actions.ts:45-53` and `:126-131`, and at `app/lib/xola.ts:53-62`, each say this relay is the crew member's only notice (`shifts/actions.ts:49-51`). The screen says "Split done." or "Merged into one shift." When `relayNotices` throws first, `recordFormChanges` is skipped as well (`app/lib/channel.ts:84-85`).

#### S2-16. A crew Yes/No that fails partway closes the ask without taking the seat. A second tap says "you're all set". (**tested**; crew lane)

- `recordResponse` stamps the ask as answered (`src/asks/ask-loop.ts:357`) before the claim and the confirm (`:360-414`, `:584`).
- A throw after that point reaches a bare `console.error` (`app/(crew)/crew/actions.ts:72-75`), and the page shows "Couldn't record that just now — try the tap again." (`app/(crew)/crew/page.tsx:37`).
- The ask card is gone, because only unanswered asks are listed (`src/crewapp/crew-view.ts:176`). Tapping again from the SMS returns "You already answered this one — you're all set." (`page.tsx:36`), while the seat is still `Asked`.
- Nobody is told. This is a new way to reach crewing S2-10 and S2-1 (§6, P-E).

#### S2-17. The crew check-in list draws a tick that failed to save as checked in. If it was the last one, the screen says "✓ Everyone's aboard". (**read**)

- `check-in-list.tsx:113` takes `checkedIn` from the tap, whatever its status. On failure, `:144-145` stores `{checkedIn: on, status: "failed"}`.
- So the row leaves "to board" (`:127`) and moves into the "Checked in" `<details>`, which renders closed (`:203`). When nothing is left to board, `:186-190` renders "✓ Everyone's aboard".
- This breaks `docs/design/check-in-surfaces.md:337` (§C3): *"A tap fails (no connection) | The row shows it didn't save, with a retry. A tap never silently vanishes."*
- The operator finds out only if the passenger count is higher than the ticks (`src/checkin/departure.ts:71-73`). Otherwise log only (`check-in/[eventId]/actions.ts:52`).
- Read only: there is no DOM test harness (`vitest.config.ts`, `environment: "node"`).

#### S2-18. A bail that fails halfway is shown as a stale card, but the bail is already on the person's record. (**tested**; crew lane)

`bail()` writes `shift_bailed` (`src/asks/ask-loop.ts:661`) and then `saveSeat` (`:678`). A throw from the second write is returned as `raced` (`:761-767`), which shows "This card changed under you" (`app/(crew)/crew/shift/[shiftId]/page.tsx:44`). The seat stays `Confirmed`, and a retry writes a second bail. Log only. Related to crewing S3-10. Probe in §6, P-E.

### S3

Each finding below reaches a person late, by a path that is itself best-effort, or only by a pull. All are **read** unless marked otherwise.

| ID | Code | What fails / what's said | Who finds out |
|---|---|---|---|
| S3-1 | `src/builder/tick.ts:546` before `app/api/cron/tick/route.ts:241-245`; `src/adapters/forward-board-alerts.ts:116,119,130-146` | The At-Risk landing is recorded before the SMS is tried, so a failed send is never retried. A Twilio-dark log-only send also counts toward `alertsSent`. | Only someone who opens `/admin/at-risk`. **Tested** (P-C1). §2.5 (SPEC:1083) "pings Eric". |
| S3-2 | `src/reservations/webhook-health.ts:126-136` | A persistent failure to read webhook endpoints (for example a restricted key) logs "UNKNOWN" every run and never alerts. | Nobody. **Tested** (P-C2): 18 runs, 0 alerts. |
| S3-3 | `src/reservations/booking-webhook.ts:1399-1452`; `src/ports/payment.ts:199-206` | A dispute alert is one SMS attempt and carries no deadline. Inquiry and unknown disputes move no ledger row. | One best-effort SMS, plus "Disputed" on `/admin/purchases` for live and lost disputes only. §3.4 (SPEC:3181,3185): "a dated admin alert with the deadline visible". |
| S3-4 | `src/reservations/booking-webhook.ts:1526-1531`; `purchases-view.ts:131` | A balance overpayment is announced by one SMS, and `/admin/purchases` shows it as "paid". | One best-effort SMS. |
| S3-5 | `booking-webhook.ts:402-407`, `:1489-1496`, `write-booking.ts:123-136` | Three money branches (unknown hosted-session purpose, balance for a missing reservation, unusable row) alert by SMS and write no row. | One best-effort SMS. |
| S3-6 | `booking-webhook.ts:687-705` | The residual-race auto-refund fails. | One SMS, plus a pull-only `refund_failed` row. |
| S3-7 | `customer-cancel.ts:248-251` | A self-cancel refund that moved money, followed by a ledger write that threw, is reported to the customer and the operator as a failed refund. | `charge.refunded` later corrects it. If the operator acts on the email first, the reused idempotency key protects the customer, within Stripe's key window. |
| S3-8 | `customer-cancel.ts:205-213` with `trail.ts:56-66` | If the `refund_failed` trail write is itself swallowed, the manage page says the refund is on its way. | The best-effort operator email only (money F5). |
| S3-9 | `booking-webhook.ts:1063-1082`; `cancel-reservation.ts:292-323` | Formation failures on the booking and cancel paths go to a log at the source. | The next tick's formation alert, provided S2-8 is not also happening. |
| S3-10 | `operator-cancel.ts:101-107` | An operator cancel that commits but loses its acknowledgement says "Couldn't cancel just now. Try again". The customer notice and the re-form never run. | The operator, on reload. The customer is never told. |
| S3-11 | `app/(public)/book/page.tsx:109-117`, `book/checkout/page.tsx:116-126,254-262`, `p/[token]/page.tsx:78-107` | The revenue pages fail to load. | The customer sees a notice. The operator gets a log line only. |
| S3-12 | `app/(public)/book/checkout/checkout-form.tsx:287-298` | A rejection from `stripe.confirmPayment` shows "you have not been charged" without knowing that. | The customer; a retry returns `already_paid`, which corrects it. |
| S3-13 | `src/import/xola-pull.ts:212-229`; `app/lib/import-audit.ts:28-56` | A Xola pull's own formation failures are dropped, and the run page shows success. | The tick backstop, up to 15 minutes later. |
| S3-14 | `app/api/cron/tick/route.ts:117-122` | Formation fails before any vessel-day is tried. | A log line every tick, and no alert (DEC-172: "A log line is not a control"). |
| S3-15 | `route.ts:176-182`; `src/checkin/reminders.ts:64-88,152-163` | Waiver reminders fail at the run level (log only, no row), or per booking (a pull-only `waiver_reminder_failed` row, with a count only in the cron JSON). | The crew, at the dock. Found by shards B and C. |
| S3-16 | `src/reservations/recover-booking-link.ts:136-146` | Link recovery records "sent" when every channel failed. **Tested** (P-B3). | Log only. The customer's copy is hedged ("if we find a booking"). |
| S3-17 | `src/adapters/twilio-channel.ts:159-168` | "Texted to …" means Twilio accepted the message. There is no status callback (`docs/HOSTING_MIGRATION.md:493`). | Nobody. Only the Twilio console shows carrier failures. |
| S3-18 | `app/b/[code]/page.tsx:213-216` | "We texted and emailed it to you too." renders on every manage-page load, whether or not it was sent. | — (the reader already holds the link) |
| S3-19 | `app/lib/auth-delivery.ts:88-122`; `app/(crew)/crew/actions.ts:132,160` | A failed sign-in code still shows "a 6-digit code is on its way" (deliberate, to avoid revealing who is on the roster). | The crew member, when nothing arrives. A Resend outage locks everyone out with only a log line. Found by shards B and E. |
| S3-20 | `components/assignment/guest-text-button.tsx:28-35`; `app/api/guest-contact/route.ts:92-97` | "✓ Texted by" records the tap, not the text. A lost POST, or a non-2xx that is never checked, leaves no mark, so a second crew member texts the customer again. | Nobody. Found by shards B and D. |
| S3-21 | `src/reservations/cancel-notice.ts:85-86` | "We'll be in touch about your refund" is a promise nothing tracks. | The operator sees the refusal once (spec accepts this: SPEC:1933-1934). |
| S3-22 | `app/(admin)/admin/at-risk/page.tsx:74-84` | The paused flag can't be read, so the board shows "Nothing needs you right now" without the paused banner. | Log only. §2.5 (SPEC:1082): "'Empty is success' holds only while the engine is running." |
| S3-23 | `components/assignment/shift-cockpit.tsx:58`; `src/asks/ask-loop.ts:550-551,922,752` | "nothing was changed" is shown after a partial, non-transactional seat write. | The operator, on reload. |
| S3-24 | `shift/[shiftId]/actions.ts:84-94`; `shifts/actions.ts:57-62,139-152`; `src/oracle/audit-log.ts:142-152` | Crewing audit rows are dropped, so `/admin/asks` shows "nothing happened". | Log only. |
| S3-25 | `app/(admin)/admin/customers/[customerId]/page.tsx:73-81` | The catch has no log line at all. This is the #854 founding defect again: the named catch binding gets past the lint rule. | Nobody learns why. |
| S3-26 | `app/(admin)/admin/messages/actions.ts:30-45` | An operator post is dropped by a bare `return` when the target is refused (for example a cohort thread after midnight). | Nobody. No log line. |
| S3-27 | `app/(crew)/crew/shift/[shiftId]/page.tsx:117-122` | `readShiftChangeBanner(...).catch(() => null)` has no log, so the change banner is silently missing. | Nobody. |
| S3-28 | `app/(crew)/crew/open/page.tsx:103-107,129-131` | A failed team read shows "No shifts scheduled in this window". | Log only. |
| S3-29 | `app/(crew)/crew/actions.ts:200-202` | The SMS-consent (10DLC) record is swallowed, and nothing reads that table back. | Log only. |

### S4

Swallowed on purpose and harmless, or nearly so, but not documented or documented wrongly.

| ID | Code | Item |
|---|---|---|
| S4-1 | `app/b/[code]/actions.ts:148-149`; `app/(admin)/admin/calendar/[reservationId]/actions.ts:374-375` | Two comments claim a guarantee the code doesn't have (S1-1, S2-1). |
| S4-2 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:103-113` | A failed trail read on a cancelled booking prefills the refund box with the whole refundable amount. |
| S4-3 | `src/adapters/stripe-payment.ts:466,496` | Refund and dispute events with no PaymentIntent are acknowledged and dropped silently. A dispute on such a charge reaches nobody. |
| S4-4 | `booking-webhook.ts:380-387` | `payment_processing` sends an alert with no de-duplication and writes no row. It is documented as unreachable. |
| S4-5 | `booking-webhook.ts:1257-1258` | A refund on a still-`pending` row returns silently. That also swallows a dashboard refund in the money F3 case. |
| S4-6 | `stripe-payment.ts:341-351` | A Stripe outage is turned into `null`, and `/book/success` shows success (the fast path, by design). |
| S4-7 | `app/(public)/p/[token]/actions.ts:101-104` | The same commit-then-throw shape as S1-1, with nothing owed. It does leave the intents un-retired, which leads into S2-2. |
| S4-8 | B-13 (9 items) | The trip-link line is dropped from the confirmation. The waiver card is dropped. The reissue copy omits a failed SMS. `errText` logs provider bodies. "Recover it from the link we sent" is circular. Operator emails for completed cancels are best-effort. The self-cancel notice result is dropped. Doorbell ring failures go to a log. Provider-ref parse failures go to a log. |
| S4-9 | `app/api/cron/tick/route.ts:184-195` | Pausing the engine also mutes At-Risk pings, and on resume every landing goes out in one SMS. Not documented. |
| S4-10 | `route.ts:265-267,274,280` | A route comment claims the admins "have already been texted". `alertsSent` includes sends that only reached the log. |
| S4-11 | `route.ts:255-260` | Unmanned shifts outside the formation window go to a log only (documented at `tick.ts:142-147`). |
| S4-12 | `app/api/health/route.ts:47-58` | `degraded` is returned with HTTP 200. Sheepdog checks the body, which is not verifiable from here. |
| S4-13 | shard D group | `getAdmin().catch(() => null)` and `listCrewMembers().catch(() => [])` with no log (`shifts/page.tsx:297,303`, `shift/[shiftId]/page.tsx:40`). A failed copy never shows "Copied ✓" (`components/ui/copy-button.tsx:42`); suspected S3 for payment links. Postgres rollback errors replace the original error (10 transaction catches in `src/adapters/postgres-repository.ts`; read, not run). `parseJsonSetting` defaults silently (`postgres-repository.ts:3236`). |
| S4-14 | shard E group | "Removed" is shown for a no-op PTO remove. The check-in `?err=error` banner stays through re-reads. Some crew actions have no `try` and there is no `error.tsx`. The calendar feed returns 500 to the calendar client. The activity beacon ignores the status code. `signing.ts:305` uses a limit of 0 when the vessel and event are both missing. |

---

## 3. Patterns behind the findings

These are proposals, not code.

1. **The copy is written before the outcome is known.**
   - S2-3, S2-5, S2-6, S2-11 and S2-12 all render a fixed success string, while the call underneath returns `void` or throws its count away.
   - `relayAsks` and `relayNotices` (`app/lib/channel.ts:55,71`) and `sendSoldOutNotice` are the places where a count or a result would have to come back up.
2. **"Couldn't X — nothing changed" is the default for any throw.** S1-1, S2-1, S2-10, S2-13, S2-14 and S3-23 each print that sentence after a write may already have landed. Most of these sites carry a comment admitting it.
3. **No place lists what a person has to act on.** `refund_failed`, `sold_out_notice_failed`, `change_requested`, `waiver_reminder_failed` and the never-written `confirmation_skipped` are all durable, but each is one filter away on `/admin/booking-audit`.
4. **No alert is retried.** Each one is a single SMS. The only path that repeats is the formation alert, and it repeats only because the tick runs again.
5. **Nobody watches the watcher.** The tick (S2-8), the webhook monitor (S3-2) and the log stream (`app/lib/swallowed.ts:34-37`, sheepdog issue #62) have nothing checking whether they are alive.
6. **The lint rule doesn't catch every silent swallow.** `muster/bare-catch` bans `catch {}`, but `.catch(() => null)` and a named `catch (e)` with no log both get past it (S3-25, S3-27, S4-13).

---

## 4. Every catch site

Below is the union of the five shard tables, de-duplicated by exact citation. It has 405 rows covering:
- the 280 grep-matched catch sites
- ignored result values, `?? default` reads, and screen copy that claims an outcome

"Class" was assigned mechanically from the "who finds out" cell, and the cell itself is authoritative:
- **screen**: the person on the screen at the time is told.
- **best-effort alert**: one SMS or email.
- **durable row (pull)**: a trail row that someone has to look for.
- **log only**: `console.error` or `logSwallowed`, and nothing alerts on it.
- **nobody**: not even a log line.
- **not a swallow**: rethrown, retried, or bad input.
- **mixed (see note)**: the cell doesn't fit one class; read it and the note.

Shard letters in the last column: A payments, B customer messages, C alerts and cron, D admin, E crew and rest. A finding id in the Note column is that shard's own id. §2 maps each one to its report id, for example A-1 → S2-2.

| # | file:line | What fails | Who finds out | Class | Note | Shard |
|---|---|---|---|---|---|---|
| 1 | `src/reservations/booking-webhook.ts:156-164` | money alert send | log only | log only | `alertThatNeverThrows`; logs the full message | A |
| 2 | `src/reservations/booking-webhook.ts:257-265` | anything after signature check | log only + Stripe retry 3 days (Stripe's own failure emails: not determinable) | log only | rethrow to the route, which returns 500 | A |
| 3 | `src/reservations/booking-webhook.ts:321-343` | `payment_failed` lookup/trail | pull-only (booking-audit) | durable row (pull) | by design (criterion 11) | A |
| 4 | `src/reservations/booking-webhook.ts:351` | `payment_canceled` | nobody | nobody | by design | A |
| 5 | `src/reservations/booking-webhook.ts:380-387` | delayed method settling | best-effort SMS, no row | best-effort alert | A-21 | A |
| 6 | `src/reservations/booking-webhook.ts:394-396` | unknown event type | nobody | nobody | acked `handled:false` | A |
| 7 | `src/reservations/booking-webhook.ts:402-407` | hosted session, unknown purpose (money moved) | best-effort SMS, no row | best-effort alert | A-9 | A |
| 8 | `src/reservations/booking-webhook.ts:415-427` | retired hosted booking session (money moved) | best-effort SMS + pull-only `charge_unmatched` | best-effort alert |  | A |
| 9 | `src/reservations/booking-webhook.ts:602-614` | sibling intent cancel refused | log only | log only | known: money F2 | A |
| 10 | `src/reservations/booking-webhook.ts:656-705` | residual-race auto-refund fails | best-effort SMS + pull-only `refund_failed` | best-effort alert | A-10 | A |
| 11 | `src/reservations/booking-webhook.ts:651-655` | success-page loss: compensation deferred | webhook later | mixed (see note) | by design; F7 copy | A |
| 12 | `src/reservations/booking-webhook.ts:721-734` | sold-out customer notice throws | log only (alert below still says "told") | screen | A-5 | A |
| 13 | `src/reservations/booking-webhook.ts:756-772` | sold-out office alert throws | log only | log only |  | A |
| 14 | `src/reservations/booking-webhook.ts:825-827` | succeeded intent matches no row | nobody | nobody | known: money F20 | A |
| 15 | `src/reservations/booking-webhook.ts:830-837` | payment on cancelled or unusable row | best-effort SMS, no row; customer told "booked" or "nothing charged" | best-effort alert | **A-1** | A |
| 16 | `src/reservations/booking-webhook.ts:897 (→602-614)` | sibling retire after booking | log only | log only | known: money F2 | A |
| 17 | `src/reservations/booking-webhook.ts:1063-1068` | per-vessel-day formation failures | log only here; cron tick alerts | log only | A-13 | A |
| 18 | `src/reservations/booking-webhook.ts:1069-1082` | formation throw | log only; tick backstop | log only | A-13 | A |
| 19 | `src/reservations/booking-webhook.ts:1111-1125` | confirmation dep throws | log only; claim released, no next caller | log only | known: money F4/F3 | A |
| 20 | `src/reservations/booking-webhook.ts:1136-1144` | claim release fails | log only | log only | known: money F4 (leg) | A |
| 21 | `src/reservations/booking-webhook.ts:1156-1160` | crew relay after booking | log only | log only | crewing/cron shard | A |
| 22 | `src/reservations/booking-webhook.ts:1161-1166` | form audit write | log only | log only | S4 | A |
| 23 | `src/reservations/booking-webhook.ts:1182-1194` | receipt URL lookup | log only; manage page shows no receipt link | log only | S4, documented | A |
| 24 | `src/reservations/booking-webhook.ts:1257-1258` | refund on a still-pending row | nobody | nobody | A-22 | A |
| 25 | `src/reservations/booking-webhook.ts:1259-1276` | refund on unknown charge | best-effort SMS + pull-only `charge_unmatched` | best-effort alert |  | A |
| 26 | `src/reservations/booking-webhook.ts:1410-1420` | dispute on unknown charge | best-effort SMS + pull-only trail row | best-effort alert |  | A |
| 27 | `src/reservations/booking-webhook.ts:1423-1450` | dispute inquiry/unknown (no ledger) | best-effort SMS + pull-only trail row | best-effort alert | A-7 | A |
| 28 | `src/reservations/booking-webhook.ts:1489-1496` | balance for missing reservation (money moved) | best-effort SMS, no row | best-effort alert | A-9 | A |
| 29 | `src/reservations/booking-webhook.ts:1507-1512` | balance on cancelled/unpriced row | best-effort SMS; payment row on /admin/purchases under "Cancelled" | best-effort alert |  | A |
| 30 | `src/reservations/booking-webhook.ts:1526-1531` | balance overpay | best-effort SMS; purchases reads "paid" | best-effort alert | A-8 | A |
| 31 | `src/reservations/write-booking.ts:78,82,123-136` | confirm refusals (`no_row`, `not_pending`, `unusable_row`) | see webhook rows above | durable row (pull) | A-1, F20 | A |
| 32 | `src/reservations/confirm-booking.ts:89` | success page: intent not succeeded/unreadable | nobody (webhook still coming) | nobody | by design | A |
| 33 | `src/reservations/cancel-reservation.ts:175-176` | intent retire skipped when no Stripe keys | nobody | nobody | A-1 precondition | A |
| 34 | `src/reservations/cancel-reservation.ts:194-197` | re-read before retiring intents | log only | log only | A-1 precondition | A |
| 35 | `src/reservations/cancel-reservation.ts:199-205` | intent cancel refused on cancelled phone booking | log only | log only | **A-1** | A |
| 36 | `src/reservations/cancel-reservation.ts:292-297` | per-day formation failures on cancel | log only (tick alerts on failures) | log only | A-4 | A |
| 37 | `src/reservations/cancel-reservation.ts:298-302` | crew relay on cancel | log only; operator told "crew have been told" | screen | **A-4** | A |
| 38 | `src/reservations/cancel-reservation.ts:303-309` | form audit on cancel | log only | log only | S4 | A |
| 39 | `src/reservations/cancel-reservation.ts:310-323` | formation throw on cancel | log only | log only | A-4 | A |
| 40 | `src/reservations/customer-cancel.ts:167-182` | cancel write threw after commit | carries on (correct) | mixed (see note) |  | A |
| 41 | `src/reservations/customer-cancel.ts:175-179` | re-read after the throw also fails | nobody; customer told "Nothing changed" | nobody | **A-3** | A |
| 42 | `src/reservations/customer-cancel.ts:190-196` | `cancelled` trail write (via recordTrail) | log only; notice and prefill lost | screen | A-19 | A |
| 43 | `src/reservations/customer-cancel.ts:205-213` | `refund_failed` trail write (via recordTrail) | log only; page says refund on its way | log only | A-12 | A |
| 44 | `src/reservations/customer-cancel.ts:215,200` | customer notice (`tellSafely`) | other shard | mixed (see note) |  | A |
| 45 | `src/reservations/customer-cancel.ts:248-251` | refund throws (incl. after money moved) | pull-only `refund_failed` + best-effort email | best-effort alert | known: money F5; A-11 | A |
| 46 | `src/reservations/customer-cancel.ts:257-263` | partial provider failure | log + pull-only row + best-effort email | best-effort alert | known: money F5 | A |
| 47 | `src/reservations/customer-cancel.ts:268-279` | refunded-since read fails → 0 | reports failed to both parties | mixed (see note) | known: money F8 variant | A |
| 48 | `src/reservations/operator-cancel.ts:101-107` | cancel throws (possibly after commit) | operator on screen ("Couldn't cancel"); customer and crew not told | screen | A-14 | A |
| 49 | `src/reservations/operator-cancel.ts:131-141` | `cancelled` trail write | log only | log only | S4 | A |
| 50 | `src/reservations/operator-cancel.ts:166-182` | quote read fails | operator on screen ("No refund was sent — use the refund box") | screen | S4 | A |
| 51 | `src/reservations/operator-cancel.ts:216-229` | refund leg throws (incl. after money moved) | operator on screen, wrong copy ("Nothing moved") | screen | **A-2** | A |
| 52 | `src/reservations/operator-cancel.ts:231-268` | provider_error | operator on screen + pull-only `refund_failed` | screen |  | A |
| 53 | `src/reservations/operator-cancel.ts:79` | customer cancel notice | other shard (`tellSafely`) | mixed (see note) |  | A |
| 54 | `src/reservations/refund-payment.ts:203-209` | lease release throws after success | masks ok → "Nothing moved" | mixed (see note) | **A-2** | A |
| 55 | `src/reservations/refund-payment.ts:222-250` | Stripe refund leg fails | returned as provider_error to caller | mixed (see note) |  | A |
| 56 | `src/reservations/refund-payment.ts:253` | ledger write after successful refund | throws → "Nothing moved"; webhook heals | durable row (pull) | A-2 / A-11 | A |
| 57 | `src/reservations/trail.ts:57-65` | any trail write | log only | log only | the basis of A-12 and A-19 | A |
| 58 | `src/reservations/create-departure-payment-intent.ts:339-346` | prior intent state read | log only; mints fresh | log only | known: money F2/F16 area | A |
| 59 | `src/reservations/create-departure-payment-intent.ts:413-427` | amount raise refused | log only | log only | known: money F2 area | A |
| 60 | `src/reservations/create-departure-payment-intent.ts:428-437` | re-read after refused raise | log only; old intent left | log only | known: money F2 | A |
| 61 | `src/reservations/create-departure-payment-intent.ts:476-486` | retire superseded intent refused | log only | log only | known: money F2 | A |
| 62 | `src/reservations/webhook-health.ts:127-136` | endpoint list read | log only (forever if permanent) | log only | A-15 | A |
| 63 | `src/reservations/webhook-health.ts:142` | endpoint unhealthy | SMS every 4 h while wrong (effectively retried) | not a swallow |  | A |
| 64 | `src/reservations/ensure-booking-code.ts:66-71` | code mint collision | retried | not a swallow |  | A |
| 65 | `src/reservations/ensure-booking-code.ts:116-120` | reissue mint collision | retried | not a swallow |  | A |
| 66 | `src/reservations/ensure-booking-code.ts:129-142` | old code revoke fails | operator on screen ("old_link_alive") + pull-only row | screen |  | A |
| 67 | `src/reservations/recover-booking-link.ts:105-151` | recovery send/mint | log only (onFailure); customer told the generic line by design | screen | S4 | A |
| 68 | `src/reservations/contact-phone.ts:33-37` | bad stored phone | log only; site says "call us" without a number | log only | S4 | A |
| 69 | `src/reservations/contact-phone.ts:49-58` | phone read fails | log only | log only | S4 | A |
| 70 | `src/reservations/resend-booking-link.ts:110-124` | channel send | operator on screen per channel | screen |  | A |
| 71 | `src/adapters/stripe-payment.ts:341-351` | succeeded-intent read | log only → success page "booked" | log only | A-23 | A |
| 72 | `src/adapters/stripe-payment.ts:363-375` | intent state read | log only → mint fresh | log only |  | A |
| 73 | `src/adapters/stripe-payment.ts:432-434` | signature | rethrown typed → 400, log only | screen | known: money F3 | A |
| 74 | `src/adapters/stripe-payment.ts:466` | refund event with no PI | nobody | nobody | A-20 | A |
| 75 | `src/adapters/stripe-payment.ts:496` | dispute event with no PI | nobody | nobody | A-20 | A |
| 76 | `src/adapters/stripe-payment.ts:561` | unparsed event type | nobody | nobody | by design | A |
| 77 | `app/api/webhooks/stripe/route.ts:39-41` | Stripe keys unset | log only (500 to Stripe) | screen |  | A |
| 78 | `app/api/webhooks/stripe/route.ts:53-59` | bad signature | log only | log only | known: money F3 | A |
| 79 | `app/api/webhooks/stripe/route.ts:60-63` | processing failure | log only + Stripe retry | log only | known: money F3 | A |
| 80 | `app/(public)/book/success/page.tsx:58-70` | fast-path confirm throws | log only; card says "You're booked!" | log only | known: money F7; A-1 | A |
| 81 | `app/(public)/book/page.tsx:109-117` | availability read | log only | log only | A-16 | A |
| 82 | `app/(public)/book/checkout/page.tsx:116-126` | checkout read | log only | log only | A-16 | A |
| 83 | `app/(public)/book/checkout/page.tsx:254-262` | no priceable boat | log only | log only | A-16 | A |
| 84 | `app/(public)/book/checkout/actions.ts:144-154` | holder cookie | log only | log only | S4, documented | A |
| 85 | `app/(public)/book/checkout/never-rejects.ts:38-50` | checkout start throws | customer on screen ("you have not been charged", true here) | screen |  | A |
| 86 | `app/(public)/book/checkout/checkout-form.tsx:107-113` | Stripe.js load | customer on screen | screen |  | A |
| 87 | `app/(public)/book/checkout/checkout-form.tsx:173-175` | `elements.update` | console only | log only | S4 | A |
| 88 | `app/(public)/book/checkout/checkout-form.tsx:284-286` | confirm error from Stripe | customer on screen | screen |  | A |
| 89 | `app/(public)/book/checkout/checkout-form.tsx:287-298` | confirm rejects | customer told "not charged" without knowing | screen | A-17 | A |
| 90 | `app/(public)/p/[token]/actions.ts:62-68` | pay-link start throws | customer on screen | screen |  | A |
| 91 | `app/(public)/p/[token]/actions.ts:101-104` | customer cancel on link throws | customer on screen ("Nothing changed") | screen | A-24 | A |
| 92 | `app/(public)/p/[token]/actions.ts:107-117` | `cancelled` trail write | log only | log only | S4 | A |
| 93 | `app/(public)/p/[token]/actions.ts:128-133` | operator email env unset | log only (production) | log only |  | A |
| 94 | `app/(public)/p/[token]/actions.ts:154-156` | operator email send | log only + pull-only `cancelled` row | durable row (pull) | S3 | A |
| 95 | `app/(public)/p/[token]/page.tsx:47-55` | malformed `%` | nobody (bad input) | nobody | S4 | A |
| 96 | `app/(public)/p/[token]/page.tsx:78-85` | pay page read | log only | log only | A-16 | A |
| 97 | `app/(public)/p/[token]/page.tsx:95-107` | no publishable key / no invoice | log only | log only | A-16 | A |
| 98 | `app/(public)/p/[token]/page.tsx:237-244` | (copy) "Nothing was charged" from status | — | mixed (see note) | **A-1** reverse claim | A |
| 99 | `app/b/[code]/actions.ts:59-86` | change-request email | log only; customer told "sent to the team" | screen | **A-6** | A |
| 100 | `app/b/[code]/actions.ts:92-101` | `change_requested` trail | log only | log only | A-6 | A |
| 101 | `app/b/[code]/actions.ts:147-152` | self-cancel throws | customer on screen ("Nothing changed"), sometimes false | screen | **A-3** | A |
| 102 | `app/b/[code]/actions.ts:160-187` | cancel email to operator | log only | log only | known: money F5 | A |
| 103 | `app/b/[code]/load.ts:161-170` | booking read | log only; rendered as unknown code | log only | S4, documented | A |
| 104 | `app/b/[code]/load.ts:185-194` | cancelled-notice trail read | log only; no notice shown | screen | S4 | A |
| 105 | `app/b/[code]/page.tsx:421-426` | waiver links | log only | log only | S4 (not money) | A |
| 106 | `app/b/[code]/party/page.tsx:73-74` | party signers read | log only | log only | S4 (not money) | A |
| 107 | `app/b/[code]/party/page.tsx:146-147` | share link | log only | log only | S4 (not money) | A |
| 108 | `app/(admin)/admin/calendar/actions.ts:83-86` | hold slot | operator on screen | screen |  | A |
| 109 | `app/(admin)/admin/calendar/actions.ts:123-126` | release hold | operator on screen | screen |  | A |
| 110 | `app/(admin)/admin/calendar/book-actions.ts:52-73` | phone booking write | operator on screen ("unreachable") | screen |  | A |
| 111 | `app/(admin)/admin/calendar/book-actions.ts:82-87` | comp confirm | operator on screen | screen | copy is careful (pane :462-463) | A |
| 112 | `app/(admin)/admin/calendar/book-actions.ts:99-104` | pay link send | operator on screen per channel | screen |  | A |
| 113 | `app/(admin)/admin/calendar/book-pane.tsx:102-107` | payment config read | operator on screen | screen |  | A |
| 114 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:98-113` | balance checkout create | operator on screen | screen |  | A |
| 115 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:134-146` | `balance_link_created` trail | log only | log only | S4 | A |
| 116 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:185-196` | phone cancel throws | operator on screen | screen |  | A |
| 117 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:201-213` | `cancelled` trail write | log only | log only | S4 | A |
| 118 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:233-242` | pay link resend | operator on screen | screen |  | A |
| 119 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:331-333` | refund ceiling read (uncaught) | 500 to operator | screen | S4 | A |
| 120 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:361-378` | refund throws (incl. after money moved) | operator on screen, wrong copy | screen | **A-2** | A |
| 121 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:380-417` | refund refusal / provider_error | operator on screen + pull-only row | screen |  | A |
| 122 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:423-434` | `refund_issued_by_operator` trail | log only | log only | S4 | A |
| 123 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:463-468` | resend read | operator on screen | screen |  | A |
| 124 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:485-492` | resend send | operator on screen | screen |  | A |
| 125 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:570-575` | reissue read | operator on screen | screen |  | A |
| 126 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:582-589` | reissue mint | operator on screen | screen |  | A |
| 127 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:593-602` | reissue send | operator on screen + pull-only row | screen |  | A |
| 128 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:103-113` | customer-owed trail read | log only; refund box prefills too high | log only | A-19 | A |
| 129 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:126-135` | malformed `%` | nobody | nobody | S4 | A |
| 130 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:205-218` | reservation read | operator on screen | screen |  | A |
| 131 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:240-260` | payments/tax read | operator on screen | screen |  | A |
| 132 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:265-271` | seats read | log only; ratio dropped | log only | S4 | A |
| 133 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:300-305` | history read | log only; panel missing (hides any `refund_failed`) | log only | S4 | A |
| 134 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:309-314` | waivers card | log only | log only | S4 | A |
| 135 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:594-599` | phone-booking history read | log only | log only | S4 | A |
| 136 | `app/(admin)/admin/calendar/[reservationId]/page.tsx:643-648` | pay-link URL mint | log only; no copy button | screen | S4 | A |
| 137 | `app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx:155` | (copy) "crew have been told", unconditional | — | mixed (see note) | **A-4** reverse claim | A |
| 138 | `app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx:290-291` | (copy) "Nothing moved" default | — | mixed (see note) | **A-2** reverse claim | A |
| 139 | `app/(admin)/admin/purchases/page.tsx:121-142` | list read | operator on screen | screen |  | A |
| 140 | `app/(admin)/admin/integrity/page.tsx:55-59` | counted-above read | operator on screen | screen |  | A |
| 141 | `app/(admin)/admin/integrity/page.tsx:60-67` | integrity scan | operator on screen | screen |  | A |
| 142 | `app/(admin)/admin/abandonment/page.tsx:46-53` | list read | operator on screen | screen |  | A |
| 143 | `app/(admin)/admin/booking-audit/page.tsx:73-85` | list read | operator on screen | screen |  | A |
| 144 | `src/reservations/booking-confirmation.ts:106-116` | confirmation email send | log only | log only | money F4: the result is not fed back into `told` | B |
| 145 | `src/reservations/booking-confirmation.ts:120-130` | confirmation SMS send | log only | log only | F4. `loggedOnly` is ignored here too; the edge uses `live` instead | B |
| 146 | `app/lib/booking-confirmation.ts:94-95` (`onFailure`)` | either leg | log only | log only | `errText` includes the provider body (B-13.4) | B |
| 147 | `app/lib/booking-confirmation.ts:112` (`Boolean(email) \|\| live`)` | result-type ignore | nobody | nobody | known: money F4 | B |
| 148 | `app/lib/booking-confirmation.ts:113-118` | base URL, repo, code mint, anything | log only, claim released | log only | B-4 | B |
| 149 | `app/lib/booking-confirmation.ts:175` (`skipped`)` | no live channel on resend | screen (pane `resendErr`) | screen | correct | B |
| 150 | `app/(admin)/admin/calendar/[reservationId]/actions.ts:465-467,487-491` | resend: read or send threw | screen (`resendErr=unreachable`), log | screen | correct | B |
| 151 | `actions.ts:506-508` | resend: nothing went | screen (`all_failed`/`nothing_sent`) | screen | correct | B |
| 152 | `actions.ts:572-574,584-588,595-601` | reissue: read, mint or send threw | screen plus a `link_reissued` row (LOCKED OUT) | screen | correct; B-13.3 copy gap | B |
| 153 | `src/reservations/resend-booking-link.ts:119-124` (`tryChannel`)` | any channel send | the caller's result (screen) plus log | screen | the shared helper reads `loggedOnly` correctly (`:118`) | B |
| 154 | `src/reservations/cancel-notice.ts:182-191` | read, mint or send threw | screen (pane `told=error`), `cancel_notice_failed` row, log | screen | correct | B |
| 155 | `src/reservations/cancel-notice.ts:244-249` (`tellSafely`)` | the tell dep threw | screen (`error`), log | screen | correct | B |
| 156 | `app/lib/cancel-notice.ts:43-51` | channel build threw | screen, a `cancel_notice_failed` row, log | screen | correct. The nested catch `:47-49` is log only | B |
| 157 | `app/lib/cancel-notice.ts:36` (`onFailure`)` | a channel | log; the outcome reaches the screen | screen | correct | B |
| 158 | `src/reservations/customer-cancel.ts:221` | the notice result is dropped | trail row | durable row (pull) | B-13.7 | B |
| 159 | `src/reservations/sold-out-notice.ts:83-91` | sold-out email | `sold_out_notice_failed` row (booking-audit only), log | screen | B-1, B-2 | B |
| 160 | `src/reservations/sold-out-notice.ts:93-101` | sold-out SMS | same; LogChannel recorded as **sent** | log only | B-2 | B |
| 161 | `app/lib/sold-out-notice.ts:56-60` | base URL or env threw | log only, no row | durable row (pull) | B-1 | B |
| 162 | `src/reservations/recover-booking-link.ts:136-146` | the resend result is dropped | a trail row saying "sent" | durable row (pull) | B-6 | B |
| 163 | `src/reservations/recover-booking-link.ts:147-151` | any throw | log only | log only | by design (no oracle) | B |
| 164 | `app/b/find/actions.ts:76-82` | `after()` body threw | log only | log only | by design | B |
| 165 | `app/b/[code]/actions.ts:160-188` | operator cancel email | log only | log only | money F5 / B-13.6 | B |
| 166 | `app/(public)/p/[token]/actions.ts:124-157` | operator email | log only | log only | B-13.6 | B |
| 167 | `app/lib/payment-link.ts:63-64` | nothing sent | screen (pane `linkSent`) | screen | correct; no trail row on failure, by design | B |
| 168 | `app/(admin)/admin/calendar/book-actions.ts:98-104` | payment link threw | screen (`linkSent=error`), log | screen | correct | B |
| 169 | `book-actions.ts:82-87` | comp confirm threw | screen (`comped=error`), log | screen | correct; the confirmation itself falls under F4/B-4 | B |
| 170 | `actions.ts:237-241` | send payment link again threw | screen, log | screen | correct | B |
| 171 | `app/lib/auth-delivery.ts:95-99` | no email env | log only (prod) | log only | B-10 | B |
| 172 | `app/lib/auth-delivery.ts:114-121` | login-code send | log only | log only | B-10 | B |
| 173 | `src/checkin/reminders.ts:79-88` | one booking errored | `run.failed` (cron JSON), log | log only | B-8 | B |
| 174 | `src/checkin/reminders.ts:129-133` | no contact or channel | `waiver_reminder_failed` row | durable row (pull) | B-8 | B |
| 175 | `src/checkin/reminders.ts:152-156` | code mint or compose threw | released, rethrown to `:83` | not a swallow | B-8; the release itself can throw | B |
| 176 | `src/checkin/reminders.ts:158-165` | all channels failed or logged | released plus a row | durable row (pull) | correct per design | B |
| 177 | `app/api/cron/tick/route.ts:176-182` | the whole reminder run threw | log only | log only | B-8 | B |
| 178 | `src/checkin/trip-link.ts:96-102` | duplicate-key retry | n/a (handled) | not a swallow | not a swallow | B |
| 179 | `src/checkin/trip-link.ts:119-125` | template read or mint | log only | log only | B-13.1 | B |
| 180 | `app/b/[code]/page.tsx:419-427` | waiver card data | log only | log only | B-13.2 | B |
| 181 | `app/w/[code]/page.tsx:64-67,110-115` | trip link or scene load | screen (guest: "Something went wrong"), log | screen | the operator is never told; persistent failures surface at the dock | B |
| 182 | `app/w/[code]/actions.ts:108-111` | signing save | screen (err copy), log | screen | correct | B |
| 183 | `app/w/[code]/actions.ts:76` (`takeRateLimit` `onFailure`)` | rate limiter | log only | log only | — | B |
| 184 | `components/assignment/guest-text-button.tsx:34` `.catch(() => {})` | beacon POST | nobody | nobody | B-11; deliberate progressive enhancement | B |
| 185 | `app/api/guest-contact/route.ts:65-73` | malformed body | 400 | screen | input, not a fault | B |
| 186 | `app/api/guest-contact/route.ts:92-97` | mark write | log only | log only | B-11 | B |
| 187 | `src/adapters/forward-notices.ts:58,60` | missing crew or shift | nobody (no log) | log only | B-5 | B |
| 188 | `src/adapters/forward-notices.ts:97-113` | crew notice send | log only | log only | B-5; `forwarded++` on `loggedOnly` | B |
| 189 | `src/adapters/forward-notifications.ts:45,54-71` | doorbell ring | log only | log only | B-13.8 | B |
| 190 | `app/lib/channel.ts:122-126` | shift-change banner write | log only | log only | B-5 backstop | B |
| 191 | `src/adapters/twilio-channel.ts:159-168` | non-2xx | thrown to the caller | not a swallow | correct; there is no delivery status at all (B-7) | B |
| 192 | `src/adapters/twilio-channel.ts:~175-190` | ref parse | log only | log only | harmless | B |
| 193 | `src/adapters/email-channel.ts:102` `.catch(() => "")` | error-body read | n/a | not a swallow | harmless | B |
| 194 | `src/adapters/email-channel.ts:115-124` | ref parse | log only | log only | harmless | B |
| 195 | `src/adapters/log-channel.ts:105-149` | (not a catch) Twilio-dark "send" | log only, `loggedOnly: true` | log only | read correctly by `tryChannel`; ignored by sold-out (B-2), confirmation (F4, handled via `live`), forward-notices (B-5) | B |
| 196 | `app/lib/sms.ts:66-70` | half-configured Twilio | log only (prod) | log only | every relay then silently logs | B |
| 197 | `src/reservations/trail.ts:56-66` | any trail write | log only | log only | under every "row" above | B |
| 198 | `app/api/cron/tick/route.ts:39-42` | CRON_SECRET missing or wrong | Vercel cron dashboard (401) | screen | C-1 | C |
| 199 | `app/api/cron/tick/route.ts:92-96` | `forwardFormNotices` (crew "you're off/on" relay; also skips `recordFormChanges`, `app/lib/channel.ts:84-85`) | log | log only | crew-only. The transition is consumed and never re-relayed (`channel.ts:77-80`) | C |
| 200 | `app/api/cron/tick/route.ts:97-101` | `logFormAudit` wrapper | log | log only | `logFormAudit` already swallows per row (`src/oracle/audit-log.ts:143-151`), so this is wiring only. Crew-only | C |
| 201 | `app/api/cron/tick/route.ts:106-116` | vessel-days failed to form | log + BE-SMS every tick (DEC-172) | best-effort alert | effectively retried by repetition. Twilio-dark means log only | C |
| 202 | `app/api/cron/tick/route.ts:117-122` | formation reads failed before any group | log | log only | C-6 | C |
| 203 | `app/api/cron/tick/route.ts:158-164` | webhook monitor wiring (`appBaseUrl`) | log | log only | C-3 | C |
| 204 | `app/api/cron/tick/route.ts:180-182` | waiver reminders run-level failure | log | log only | C-7 | C |
| 205 | `app/api/cron/tick/route.ts:184` | `isEnginePaused` throws | 500 to Vercel dashboard | screen | uncaught, by design | C |
| 206 | `app/api/cron/tick/route.ts:222-228` | `tick()` throws | 500 to Vercel dashboard + log | screen | known: crewing S3-2 | C |
| 207 | `app/api/cron/tick/route.ts:237-239` | `relayAsks` throws (`appBaseUrl`, repo) | log | log only | crew-only. Asks recorded, never texted, later charged `ask_ignored` (known: crewing S3-2) | C |
| 208 | `app/api/cron/tick/route.ts:243-245` | `forwardBoardAlerts` throws | log; landing consumed | log only | C-2 | C |
| 209 | `app/api/cron/tick/route.ts:255-260` | unmanned shifts skipped | log | log only | C-10 | C |
| 210 | `app/lib/alert.ts:36` (edge `forwardBoardAlerts`)` | `appBaseUrl()` throws | propagates to route `:243` | not a swallow | C-2 | C |
| 211 | `app/lib/alert.ts:73-84` | formation alert wiring (repo, env, channel) | log; returns 0 | log only | route logged the failures first (`route.ts:107-110`) | C |
| 212 | `app/lib/alert.ts:111` | money alert floor line | log | log only | written before the try, unconditionally | C |
| 213 | `app/lib/alert.ts:120` | money alert reached 0 admins | log | log only | does not fire when sends were logged-only (count >0) | C |
| 214 | `app/lib/alert.ts:121-123` | money alert wiring failure | log | log only | caller's durable row varies (payment shard) | C |
| 215 | `app/lib/booking-deps.ts:49` | `alertThatNeverThrows` wrapper | log | log only | makes all 13 webhook alert sites unable to fail the webhook, which also means no Stripe redelivery | C |
| 216 | `src/adapters/forward-money-alert.ts:51-63` | admin lookup failed | log ("nobody was told") | screen | C-4 | C |
| 217 | `src/adapters/forward-money-alert.ts:64` | no recipients means 0 | log via `alert.ts:120` | best-effort alert |  | C |
| 218 | `src/adapters/forward-money-alert.ts:77-94` | per-admin send failed | log (status only) | log only | BE-SMS, no retry. C-4 | C |
| 219 | `src/adapters/forward-board-alerts.ts:116,119` | recipients or compose read throws (no try) | propagates to route `:243` | not a swallow | C-2 | C |
| 220 | `src/adapters/forward-board-alerts.ts:117` | no recipients means 0 | nobody; no log line at all | log only | the landing is consumed. With zero active admins with a phone the At-Risk ping goes nowhere, silently (S4, config) | C |
| 221 | `src/adapters/forward-board-alerts.ts:130-146` | per-admin send failed | log | log only | C-2: never retried | C |
| 222 | `src/adapters/forward-board-alerts.ts:41` (`crew?.phone`)` | admin with no crew row or phone | nobody, skipped silently | nobody | by design (DEC-095 "skipped, not thrown on") | C |
| 223 | `src/adapters/forward-formation-alert.ts:66-78` | admin lookup failed | log | log only | repeats next tick | C |
| 224 | `src/adapters/forward-formation-alert.ts:79` | no recipients means 0 | nobody; no log | log only | route's `console.error` (`route.ts:107`) is the floor | C |
| 225 | `src/adapters/forward-formation-alert.ts:120-127` | vessel row unreadable | log; alert sent by id | best-effort alert | degrades correctly | C |
| 226 | `src/adapters/forward-formation-alert.ts:142-158` | per-admin send failed | log | log only | repeats next tick | C |
| 227 | `src/adapters/forward-asks.ts:124-141` | per-crew ask send failed | log | log only | crew-only. Known: crewing S3-2 consequence (`ask_ignored`) | C |
| 228 | `src/adapters/forward-asks.ts:91,114` | crew or seat vanished, `continue` | nobody | nobody | crew-only, intended | C |
| 229 | `src/adapters/forward-notices.ts:97` | per-notice send failed | log | log only | crew-only | C |
| 230 | `src/adapters/forward-notifications.ts:54` | per-ring send failed | log | log only | crew-only. Doorbell unscheduled, MESSAGING off | C |
| 231 | `app/lib/channel.ts:124-126` | `recordShiftChanges` failed | log | log only | crew-only (app banner missing) | C |
| 232 | `src/builder/form-shifts.ts:429-435` | one vessel-day threw | recorded in `failures`, then route `:106` alert | best-effort alert | partial writes stand (`:430-433`). Xola path drops it (C-5) | C |
| 233 | `src/builder/tick.ts:410-413` | shift with no required seats | `unmannedShiftIds`, then log | log only | C-10 | C |
| 234 | `src/builder/tick.ts:546-550` | landing recorded before alert | see C-2 | mixed (see note) | ordering defect, not a catch | C |
| 235 | `src/asks/ask-loop.ts:761-768` | `bail()` threw (repo outage indistinguishable from race) | log; the user is told `raced` | screen | crew-only. The caller is told "raced" when the bail may not have happened (S3, crew lane) | C |
| 236 | `src/checkin/reminders.ts:79-89` | one booking's reminder errored | log via `onFailure` (`app/lib/waiver-reminders.ts:30`); counted `failed` | log only | no trail row on this path (the throw bypasses `noteFailed`) | C |
| 237 | `src/checkin/reminders.ts:129-133,159-163` | nobody reachable, or every channel failed | durable `waiver_reminder_failed` trail row on the booking | durable row (pull) | window released and retried | C |
| 238 | `app/lib/doorbell.ts:55` | `forwardNotifications` return value | dropped into JSON | mixed (see note) | crew-only, unscheduled | C |
| 239 | `app/api/cron/doorbell-tick/route.ts:52-54` | MESSAGING off, no-op | n/a | not a swallow | DEC-167 | C |
| 240 | `app/api/cron/doorbell-tick/route.ts:74-79` | `runDoorbellTick` threw | 500 + log | screen | unscheduled | C |
| 241 | `app/lib/xola.ts:53-62` | Xola-cancelled crew notices failed | log | log only | crew-only. The transition is consumed, a one-time chance (`:57-60`) | C |
| 242 | `app/lib/xola.ts:42` / `readXolaEnv` `:24-28` | env unset | throws to caller (`x_not_configured` banner) | screen | correct | C |
| 243 | `src/import/xola-client.ts:402-408` | transport error | retried, then XolaError, then `xerr` banner | screen | correct | C |
| 244 | `src/import/xola-client.ts:410-416` | 4xx, or 5xx/429 after retries | XolaError, then `xerr` banner | screen | correct | C |
| 245 | `app/(admin)/admin/import/actions.ts:48-61` | pull failed | `xerr` banner + log | screen | correct; the operator is on screen | C |
| 246 | `app/(admin)/admin/import/actions.ts:77-81` | audit persist failed | `?ximported=1` "audit unavailable" notice + log | screen | honest | C |
| 247 | `app/(admin)/admin/import/actions.ts:63-70` | unknown Xola resources | `console.warn` + run summary | log only | visible on the run page | C |
| 248 | `src/import/xola-pull.ts:212-229` | `form.failures` dropped | nobody until the tick re-forms | nobody | C-5 | C |
| 249 | `app/api/cron/xola-pull/route.ts:45-48` | audit persist failed | log; `runId:null` in JSON | log only | unscheduled | C |
| 250 | `app/api/cron/xola-pull/route.ts:70-77` | pull failed | 502 + log | log only | unscheduled | C |
| 251 | `app/lib/import-audit.ts:79` | `saveImportRun` throws | propagates to the callers above | not a swallow |  | C |
| 252 | `app/api/health/route.ts:47-58` | database ping failed | log; 200 `degraded`; sheepdog asserts the body | log only | C-11 | C |
| 253 | `app/lib/swallowed.ts:83-100`, `src/log.ts:44-63` | `console.error` itself threw | nobody | nobody | by design | C |
| 254 | `src/adapters/log-channel.ts:140-148` | Twilio dark | log; `SendResult.loggedOnly:true` | log only | alert senders ignore it (REVERSE check) | C |
| 255 | `app/(admin)/admin/shift/[shiftId]/actions.ts:87` | crewing audit append | log only | log only | D-S3-3 | D |
| 256 | `app/(admin)/admin/shift/[shiftId]/actions.ts:124` | "you're on/off" notice | log only; success banner unchanged | screen | D-S2-4 | D |
| 257 | `app/(admin)/admin/shift/[shiftId]/actions.ts:148` | assignFromPool / relayAsks | `act_error=unavailable` "nothing was changed" (false after the ask is written) + log | screen | D-S2-3 | D |
| 258 | `app/(admin)/admin/shift/[shiftId]/actions.ts:174` | lean / relayAsks | same | mixed (see note) | D-S2-3 | D |
| 259 | `app/(admin)/admin/shift/[shiftId]/actions.ts:190` | confirmSeat | `unavailable` + log | screen | D-S3-2 | D |
| 260 | `app/(admin)/admin/shift/[shiftId]/actions.ts:243` | overrideSeat | `unavailable` + log | screen | D-S3-2 (notify/audit cannot throw here) | D |
| 261 | `app/(admin)/admin/shift/[shiftId]/actions.ts:287` | vacateSeat (possibly committed) | "That seat just changed" + log | log only | D-S2-5 | D |
| 262 | `app/(admin)/admin/shift/[shiftId]/actions.ts:296` | getSeat / outer | `unavailable` + log | screen | true "nothing changed" | D |
| 263 | `app/(admin)/admin/shift/[shiftId]/actions.ts:338` | bailWithDerivedLateness | `unavailable` + log | screen | D-S3-2 | D |
| 264 | `app/(admin)/admin/shift/[shiftId]/actions.ts:415` | staffTraineeSeat | `unavailable` + log | screen | — | D |
| 265 | `app/(admin)/admin/shift/[shiftId]/actions.ts:458` | unstaffTraineeSeat | `unavailable` + log | screen | — | D |
| 266 | `app/(admin)/admin/shift/[shiftId]/page.tsx:40` | getAdmin (sender name) | nobody, no log | log only | S4 | D |
| 267 | `app/(admin)/admin/departure/[eventId]/page.tsx:38` | decodeURIComponent | n/a | not a swallow | bad input, documented | D |
| 268 | `app/(admin)/admin/departure/[eventId]/page.tsx:51` | loadDepartureView | "Couldn't load this departure right now. The server log has the reason." + log | log only | correct | D |
| 269 | `app/(admin)/admin/actions.ts:27` | setEnginePaused | **nobody on screen** (banner sent to a page that drops it) + log | screen | D-S2-1, tested | D |
| 270 | `app/(admin)/admin/waivers/actions.ts:53` | post/edit waiver version | `err=error` banner + draft kept + log | screen | correct | D |
| 271 | `app/(admin)/admin/waivers/actions.ts:90` | saveCheckInSettings | `settings_error` banner + log | screen | correct | D |
| 272 | `app/(admin)/admin/waivers/page.tsx:90` | waiver and config reads | full-page notice + hint + log | screen | correct | D |
| 273 | `app/(admin)/admin/locations/actions.ts:45` | saveLocationAdmin | `err=error` + log | screen | correct | D |
| 274 | `app/(admin)/admin/locations/page.tsx:56` | reads | notice + hint + log | screen | correct | D |
| 275 | `app/(admin)/admin/time-off/actions.ts:48` | addTimeOff | `err=error` + log | screen | crew; fine | D |
| 276 | `app/(admin)/admin/time-off/actions.ts:66` | removeTimeOff | `err=error` + log | screen | crew; fine | D |
| 277 | `app/(admin)/admin/time-off/page.tsx:58` | reads | notice + hint + log | screen | — | D |
| 278 | `app/(admin)/admin/payroll/page.tsx:87` | report build | notice + hint + log | screen | payroll; fine | D |
| 279 | `app/(admin)/admin/customers/page.tsx:52` | customer list | notice + hint + log | screen | correct | D |
| 280 | `app/(admin)/admin/customers/[customerId]/page.tsx:36` | decodeURIComponent | n/a | not a swallow | bad input | D |
| 281 | `app/(admin)/admin/customers/[customerId]/page.tsx:73` | customer / reservations read | notice, **no log** | screen | D-S3-4 | D |
| 282 | `app/(admin)/admin/add-ons/actions.ts:57` | saveAddOnAdmin | `err=error` + log | screen | correct | D |
| 283 | `app/(admin)/admin/add-ons/page.tsx:58` | reads | notice + hint + log | screen | — | D |
| 284 | `app/(admin)/admin/shifts/actions.ts:47` | split's form-notice relay | log only; "Split done." | log only | D-S2-7 | D |
| 285 | `app/(admin)/admin/shifts/actions.ts:59` | split's audit | log only | log only | D-S3-3 | D |
| 286 | `app/(admin)/admin/shifts/actions.ts:64` | splitShift | `split_err` "Reload and try again" + log | log only | correct | D |
| 287 | `app/(admin)/admin/shifts/actions.ts:117` | merge's freed-crew relay | log only; **banner claims N notified** | screen | D-S2-2, tested | D |
| 288 | `app/(admin)/admin/shifts/actions.ts:128` | merge's form-notice relay | log only | log only | D-S2-7 | D |
| 289 | `app/(admin)/admin/shifts/actions.ts:146` | merge's audit loop (partial) | log only | log only | D-S3-3 | D |
| 290 | `app/(admin)/admin/shifts/actions.ts:155` | mergeShift | `merge_err` + log | log only | correct | D |
| 291 | `app/(admin)/admin/shifts/page.tsx:297` | getAdmin (sender name) | nobody, no log | log only | S4 | D |
| 292 | `app/(admin)/admin/shifts/page.tsx:303` | listCrewMembers (filter) | nobody, no log | log only | S4 | D |
| 293 | `app/(admin)/admin/shifts/page.tsx:320` | deriveAllShifts | "Can't reach the schedule right now. Try again in a moment." + console.error | log only | no log hint; fine | D |
| 294 | `app/(admin)/admin/shifts/page.tsx:356` | listImportRuns (cues) | log only, invisible | log only | S4 | D |
| 295 | `app/(admin)/admin/offerings/actions.ts:108` | JSON.parse of a form field | `bad_variations` banner | screen | bad input | D |
| 296 | `app/(admin)/admin/offerings/actions.ts:148` | saveOfferingAdmin (single write) | `err=error` + console.error | screen | correct | D |
| 297 | `app/(admin)/admin/offerings/offering-sections.tsx:323` | draft-cookie parse | falls back to saved values | mixed (see note) | bad input | D |
| 298 | `app/(admin)/admin/offerings/page.tsx:81` | catalog read | notice + hint + log | screen | — | D |
| 299 | `app/(admin)/admin/settings/page.tsx:39` | isEnginePaused | "unknown" control + log | log only | S4 | D |
| 300 | `app/(admin)/admin/vessels/actions.ts:99` | saveVesselAdmin | `err=error` + log | screen | correct | D |
| 301 | `app/(admin)/admin/vessels/page.tsx:72` | reads | notice + hint + log | screen | — | D |
| 302 | `app/(admin)/admin/at-risk/actions.ts:48` | lean / relayAsks | "nothing was sent" (false after the ask is written) + log | log only | D-S2-3, tested | D |
| 303 | `app/(admin)/admin/at-risk/page.tsx:61` | board derive | notice + hint + log | screen | correct | D |
| 304 | `app/(admin)/admin/at-risk/page.tsx:77` | isEnginePaused | paused banner missing; "Nothing needs you" | screen | D-S3-1 | D |
| 305 | `app/(admin)/admin/blocks/actions.ts:57` | saveBlockAdmin (single write) | `err=error` + console.error | screen | correct | D |
| 306 | `app/(admin)/admin/blocks/actions.ts:102` | removeBlockAdmin | `err=error` + console.error | screen | correct | D |
| 307 | `app/(admin)/admin/blocks/page.tsx:148` | reads | notice + hint + log | screen | — | D |
| 308 | `app/(admin)/admin/import/actions.ts:48` | runXolaPull | "Couldn't reach Xola — nothing was pulled" even for a database failure after the writes started | mixed (see note) | D-S2-6 | D |
| 309 | `app/(admin)/admin/import/actions.ts:79` | persistImportRun | honest warn "✓ Imported … Couldn't save this run's audit detail" | mixed (see note) | correct | D |
| 310 | `app/(admin)/admin/import/page.tsx:61` | listImportRuns | empty history, log | log only | S4 | D |
| 311 | `app/(admin)/admin/import/run/[id]/page.tsx:42` | run read | notice + hint + log | screen | — | D |
| 312 | `app/(admin)/admin/asks/page.tsx:63` | ask-trail read | notice + hint + log | screen | — | D |
| 313 | `app/(admin)/admin/messages/[threadId]/page.tsx:45` | thread view | notice + hint + log | screen | — | D |
| 314 | `app/(admin)/admin/messages/page.tsx:33` | thread list | notice + hint + log | screen | — | D |
| 315 | `app/(admin)/admin/time-clock/actions.ts:119` | addPunch | `err=error` + log | screen | payroll (F3/F8 known) | D |
| 316 | `app/(admin)/admin/time-clock/actions.ts:175` | editPunch | `err=error` + log | screen | payroll | D |
| 317 | `app/(admin)/admin/time-clock/actions.ts:199` | deletePunch | `err=error` + log | screen | payroll | D |
| 318 | `app/(admin)/admin/time-clock/page.tsx:129` | reads | notice + hint + log | screen | payroll | D |
| 319 | `app/lib/form-draft.ts:143` | draft-cookie parse | no draft | mixed (see note) | bad input | D |
| 320 | `app/lib/auth.ts:118` | cookie renew (+ signSession) | nobody | nobody | S4, caveat documented | D |
| 321 | `components/admin/admin-signed-out.tsx:36` | getAdmin | crew is sent to /crew without the switch-up offer, no log | log only | S4 | D |
| 322 | `components/ui/register-sw.tsx:14` | SW register | nobody | nobody | S4 | D |
| 323 | `components/ui/copy-button.tsx:23` | clipboard API | legacy fallback | mixed (see note) | S4 | D |
| 324 | `components/ui/copy-button.tsx:42` | execCommand | no "Copied ✓" | mixed (see note) | S4 (suspected S3 for payment links) | D |
| 325 | `components/assignment/shift-cockpit.tsx:167` | cockpit build | "Couldn't reach the cockpit right now. The server log has the reason." + log | log only | correct | D |
| 326 | `components/assignment/guest-text-button.tsx:34` | "Texted by" POST | nobody; non-2xx not checked | nobody | D-S3-6 | D |
| 327 | `components/crew/crew-header.tsx:57` | getAdmin | drawer hides the admin switch | mixed (see note) | S4, crew | D |
| 328 | `src/oracle/audit-log.ts:145` | per-row form audit | log only | log only | D-S3-3 | D |
| 329 | `src/customers/resolve.ts:74` | display-code collision | retried 3×, else rethrown | not a swallow | not a swallow | D |
| 330 | `src/rate-limit/rate-limit.ts:69` | counter increment | `onFailure` callback (caller-defined) + policy fail-open | not a swallow | depends on caller; capability shard | D |
| 331 | `src/rate-limit/rate-limit.ts:91` | refusal-log write | `onFailure`; refusal stands | mixed (see note) | S4 | D |
| 332 | `src/auth/session.ts:76` | parse of a signed payload | log (error type only), `malformed` | log only | S4, documented | D |
| 333 | `src/config/db-ssl.ts:87` | URL parse | none (secret); TLS required | mixed (see note) | S4, documented | D |
| 334 | `src/adapters/postgres-repository.ts:997` | crew + credential insert txn | rethrow | not a swallow | rollback can mask the error (S4); read, not run | D |
| 335 | `src/adapters/postgres-repository.ts:1717` | pending→booked flip txn | rethrow | not a swallow | same | D |
| 336 | `src/adapters/postgres-repository.ts:1776` | savePendingIfHullFree txn | rethrow | not a swallow | same | D |
| 337 | `src/adapters/postgres-repository.ts:1864` | cancel + release txn | rethrow | not a swallow | same | D |
| 338 | `src/adapters/postgres-repository.ts:1984` | acquireRefundLease txn | rethrow | not a swallow | same | D |
| 339 | `src/adapters/postgres-repository.ts:2026` | claimRecoverySend txn | rethrow | not a swallow | same | D |
| 340 | `src/adapters/postgres-repository.ts:2593` | import run + items txn | rethrow | not a swallow | same | D |
| 341 | `src/adapters/postgres-repository.ts:2879` | updateWaiverTemplate | maps the unique-violation to `date_taken`, otherwise rethrows | not a swallow | correct | D |
| 342 | `src/adapters/postgres-repository.ts:2962` | guests insert txn | rethrow | not a swallow | rollback mask | D |
| 343 | `src/adapters/postgres-repository.ts:3030` | check-in txn | rethrow | not a swallow | rollback mask | D |
| 344 | `src/adapters/postgres-repository.ts:3236` | parseJsonSetting (checkin.*) | log; the default applies silently and the waivers settings form shows the default as if saved | log only | S3/S4 | D |
| 345 | `src/adapters/postgres-repository.ts:3247` | parseIdArray (shift_changes) | log; the crew banner under-claims | screen | S4, documented | D |
| 346 | `src/adapters/memoizing-repo.ts` | — (no catch) | — | mixed (see note) | a cached rejection is replayed to every caller in that render; propagates, not swallowed | D |
| 347 | `app/lib/channel.ts:55` | `forwardAsks` count discarded | nobody; feeds D-S2-4 | nobody |  | D |
| 348 | `app/lib/channel.ts:71` | `forwardNotices` count discarded | nobody; feeds D-S2-2 and D-S2-4 | nobody |  | D |
| 349 | `app/lib/channel.ts:124` | `recordShiftChanges` swallowed (console.error) | log only | log only |  | D |
| 350 | `app/(admin)/admin/messages/actions.ts:30,32,37,45` | silent `return` drops an operator post | nobody (D-S3-5) | nobody |  | D |
| 351 | `app/(admin)/admin/import/actions.ts:90` | `logFormAudit` outside the try; swallows per row internally | log only | log only |  | D |
| 352 | `app/(crew)/crew/actions.ts:72` | `respondToAsk`: ask/seat writes | nobody (bare `console.error`) | nobody | **E-1**, S2 | E |
| 353 | `app/(crew)/crew/actions.ts:132` | login-code mint / roster read | crew member (no email arrives); log | best-effort alert | **E-4**, by design | E |
| 354 | `app/(crew)/crew/actions.ts:160` | login-code store (in `after()`) | log | log only | **E-4** | E |
| 355 | `app/(crew)/crew/actions.ts:200` | SMS-consent row | log; nothing reads the table back | log only | **E-7** | E |
| 356 | `app/(crew)/crew/actions.ts:233` | `verifyLoginCode` domain call | crew member sees "didn't match, or it has expired" (`page.tsx:365`); log | screen | S4; same copy as a wrong code, deliberately (no-enumeration) | E |
| 357 | `app/(crew)/crew/page.tsx:119` | home view build | crew member sees CREW_UNAVAILABLE; log | screen | S4; the copy asks them to tell the admin | E |
| 358 | `app/(crew)/crew/shift/[shiftId]/actions.ts:68` | bail: reads before `bail()` | crew member: "Couldn't reach the schedule — nothing was changed." (true) | screen | S4 | E |
| 359 | `src/asks/ask-loop.ts:761` | bail: `saveSeat` / refresh after `shift_bailed` written | crew member: "This card changed under you"; log | screen | **E-3** | E |
| 360 | `app/(crew)/crew/shift/[shiftId]/actions.ts:122` | change banner "Got it" | banner stays up (the safe direction); log | screen | S4, documented | E |
| 361 | `app/(crew)/crew/shift/[shiftId]/page.tsx:82` | shift card build | CREW_UNAVAILABLE; log | screen | S4 | E |
| 362 | `app/(crew)/crew/shift/[shiftId]/page.tsx:104` | viewer's name for the guest intro text | nobody (no log); the intro text loses its sender name | log only | S4 | E |
| 363 | `app/(crew)/crew/shift/[shiftId]/page.tsx:112` | other shifts that day | nobody (no log); section missing | log only | S4 | E |
| 364 | `app/(crew)/crew/shift/[shiftId]/page.tsx:122` | change banner read | nobody (no log) | log only | **E-5** | E |
| 365 | `.../check-in/[eventId]/actions.ts:51` | guest tick | island: row folded into "Checked in"; no-JS: "That didn't save. Try again."; log; admin departure count-vs-tick warning | durable row (pull) | **E-2** | E |
| 366 | `.../check-in/[eventId]/check-in-list.tsx:139` | tick never reached the server | same as above | mixed (see note) | **E-2** | E |
| 367 | `.../check-in/[eventId]/actions.ts:83` | passenger count | mate: "That didn't save. Try again."; log | screen | S4; the banner sticks through re-reads (E-8) | E |
| 368 | `.../check-in/[eventId]/page.tsx:75` | malformed `%` in URL | n/a (input, not a fault) | not a swallow | not a failure | E |
| 369 | `.../check-in/[eventId]/page.tsx:120` | check-in page build | CREW_UNAVAILABLE; log | screen | S4 | E |
| 370 | `.../check-in/[eventId]/page.tsx:192` | QR trip-link mint | sheet: "The code didn't load. Close this and open check-in again." (`components/crew/trip-qr-sheet.tsx:57`); log | screen | S4 | E |
| 371 | `src/checkin/trip-link.ts:96` | trip code collision | rethrows unless a duplicate | not a swallow | fine | E |
| 372 | `src/checkin/trip-link.ts:122` | confirmation's signing link | log; the confirmation goes without the line | log only | customer-messages shard's site (booking confirmation); listed only | E |
| 373 | `app/(crew)/crew/open/actions.ts:43` | seat claim | crew member: "Couldn't claim that just now — here's the current list." (`open/page.tsx:63`); log | screen | S4 | E |
| 374 | `app/(crew)/crew/open/actions.ts:60` | `crew_added` audit row after a successful claim | log only; the audit trail misses the self-claim | durable row (pull) | S4, documented (`:61-62`) | E |
| 375 | `app/(crew)/crew/open/page.tsx:89` | claimable list | CREW_UNAVAILABLE; log | screen | S4 | E |
| 376 | `app/(crew)/crew/open/page.tsx:105` | team schedule | false "No shifts scheduled"; log | log only | **E-6** | E |
| 377 | `app/(crew)/crew/time-off/actions.ts:46` | add PTO | crew member: "Couldn't save that just now — try again in a moment."; log | screen | S4 (true copy) | E |
| 378 | `app/(crew)/crew/time-off/actions.ts:70` | remove PTO | same copy; log | screen | S4 | E |
| 379 | `app/(crew)/crew/time-off/actions.ts:109` | weekdays off | same copy; log | screen | S4 | E |
| 380 | `app/(crew)/crew/time-off/page.tsx:73` | PTO list read | CREW_UNAVAILABLE; log | screen | S4. A new PTO over a confirmed seat tells nobody: crewing S1-5 | E |
| 381 | `app/(crew)/crew/time/actions.ts:75` | clock-in punch | crew member: "Couldn't record that just now — try again in a moment." (`time/page.tsx:69`); log | screen | S4, payroll; comment `:76-78` | E |
| 382 | `app/(crew)/crew/time/actions.ts:103` | clock-out | same; log | log only | S4 | E |
| 383 | `app/(crew)/crew/time/actions.ts:166` | own punch edit | same; log | log only | S4; trail two-write gap is payroll F8 | E |
| 384 | `app/(crew)/crew/time/actions.ts:214` | own punch add | same; log | log only | S4 | E |
| 385 | `app/(crew)/crew/time/actions.ts:242` | own punch delete | same; log | log only | S4 | E |
| 386 | `app/(crew)/crew/time/page.tsx:102` | time view | CREW_UNAVAILABLE; log | screen | S4 | E |
| 387 | `src/crew/time-clock.ts:86, 207, 286` | unique-index violation | mapped to `already_in`; anything else rethrows | not a swallow | fine | E |
| 388 | `app/(crew)/crew/threads/page.tsx:29`, `threads/[threadId]/page.tsx:38` | thread views | CREW_UNAVAILABLE; log | screen | S4 (messaging behind a flag) | E |
| 389 | `app/(crew)/crew/threads/actions.ts` (no try)` | `postMessage` / `startDm` writes | Next default error page; default log | log only | S4 (E-8). A partial post (message saved, `recordRead` throws) shows an error over a sent message | E |
| 390 | `app/(crew)/crew/calendar/actions.ts` (no try)` | feed mint / revoke | Next default error page | mixed (see note) | S4 | E |
| 391 | `app/(crew)/crew/activity/route.ts:34` | bodyless JSON | n/a (input) | not a swallow | not a failure; `recordActivity` at `:22` unguarded → 500 | E |
| 392 | `app/(crew)/components/ActivityBeacon.tsx:34` | beacon network | nobody; doorbell errs toward ringing | nobody | S4, documented | E |
| 393 | `app/api/calendar/[token]/route.ts:54` | last-polled stamp | `console.error` | log only | S4, documented | E |
| 394 | `app/api/calendar/[token]/route.ts:37,41` (no try)` | feed read | the calendar client silently keeps a stale calendar | mixed (see note) | S4 | E |
| 395 | `src/crew/crew-cli.ts:463` | Gusto map file read | operator at the terminal (rethrown as `CrewCliError`) | not a swallow | fine | E |
| 396 | `src/adapters/test-database.ts:69` | `create database` | rethrows unless 42P04/23505 | not a swallow | test only, fine | E |
| 397 | `src/adapters/stripe-payment.sandbox.ts:163` | `threw()` helper | it is the assertion | mixed (see note) | test only, fine | E |
| 398 | `src/import/xola-client.ts:402` | transport error | retries, then throws `XolaError` | durable row (pull) | fine (cron/admin shards own the callers) | E |
| 399 | `app/lib/auth-delivery.ts:114` | login-code email send | log (controlled line) | log only | **E-4** | E |
| 400 | `app/lib/auth-delivery.ts:90-100` | email unconfigured | log in production only | log only | **E-4** | E |
| 401 | `src/builder/form-shifts.ts:429` | one vessel-day fails to form | returned in `FormResult.failures`. The tick alerts (`app/api/cron/tick/route.ts:115`). The booking webhook (`src/reservations/booking-webhook.ts:1063-1068`) and the cancel (`src/reservations/cancel-reservation.ts:292-296`) only `console.error` | best-effort alert | pointer for the payments and cron shards: a booked day with no shift reaches a log on the booking path, and then the next tick's alert, if the tick also fails to form it | E |
| 402 | `src/reservations/contact-phone.ts:33, 51` | contact-phone setting bad or unreadable | log; customers read "Call us" with no number | screen | S4; customer-facing (payments/messages shards) | E |
| 403 | `src/reservations/trail.ts:59` | reservation trail row | log ("the fact happened, the trail did not get it") | durable row (pull) | S3 pointer for the payments shard (`/admin/booking-audit` is short a row) | E |
| 404 | `src/reservations/ensure-booking-code.ts:66, 116` | code collision | rethrows unless a duplicate | not a swallow | fine | E |
| 405 | `src/reservations/ensure-booking-code.ts:131` | revoking a prior booking code | returned as `staleCodes` | mixed (see note) | payments/messages shard; listed only | E |

---

## 5. What could not be determined from the code

- **Whether anyone reads the production logs.** About 151 catch sites end in a log line and nothing more. Two files say nothing alerts on these lines (`app/lib/swallowed.ts:34-37`, `src/log.ts:28-31`). They point to sheepdog issue #62 for an ingest surface, and that issue's status is not on disk. Every "log only" row above is "nobody", unless someone reads Vercel's runtime logs.
- **Whether anyone watches Vercel's cron dashboard,** and whether production crons actually fire every 15 minutes. That depends on the plan, and `vercel.json:4-6` turns off git deploys from `main`. This decides how serious S2-8 is.
- **What sheepdog checks.** `app/api/health/route.ts:48-49` cites a `sheepdog.yaml` that is not in this repo.
- **Production's environment.** This audit could not see:
  - whether Twilio and Resend are both fully configured
  - whether `OPERATOR_NOTIFY_EMAIL` and `APP_BASE_URL` are set
  - whether at least one active admin has a phone number on file

  Every best-effort alert depends on these. The ledger (capability A9) says production has Twilio. S2-5's unset-env branch and S2-7 depend on the rest.
- **Whether production's Stripe key can read webhook endpoints** (S3-2).
- **Stripe's behaviour:**
  - whether it reliably cancels an intent in `requires_action` behind an open 3-D Secure screen (S2-2)
  - how long it keeps idempotency keys (S2-1, S3-7)
  - whether it emails the account owner when the webhook endpoint keeps failing
- **Whether messages are actually delivered.** There is no Twilio status callback (S3-17).
- **Postgres behaviour,** which was read, not run:
  - whether a commit's acknowledgement can be lost while the immediate re-read also fails (S1-1)
  - whether the refund lease's delete commits on a connection that drops (S2-1)
  - the claim and release pair under a lost connection (S2-4)
- **How often each "throw after the first write" window is hit in production** (S2-10, S2-13, S2-16, S2-18). This depends on pool and network behaviour.
- **Whether anyone opens `/admin/booking-audit` routinely.** Every durable failure row ends up there.

---

## 6. Probe tests

Each probe was written as `*.audit-tmp.test.ts`, run with `npm test -- <file>`, and deleted. Each `expect` asserts the defect, so "passed" means the defect reproduced. None of these files is committed: `git status` was clean before this report was added.

### P-A1 — S2-2 (pay-link payment on a cancelled phone booking)

**Probe** (`src/reservations/paid-cancelled.audit-tmp.test.ts`, deleted):
```ts
import { describe, expect, it, vi } from "vitest";
import { FAKE_SIGNATURE, FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { processBookingWebhook, type WebhookDeps } from "./booking-webhook.js";
import { cancelUnpaidPhoneBooking } from "./cancel-reservation.js";
import { payLinkState } from "./pay-by-link.js";
import { bookingOutcomeView } from "./booking-outcome-view.js";
import { confirmBookingByPaymentIntent } from "./confirm-booking.js";

const V = asId<"VesselId">("v");
const ID = asId<"ReservationId">("resv-phone");
const PI = "pi_link";
const NOW = () => "2026-07-12T00:00:00.000Z";

const row: Reservation = {
  id: ID, eventId: null, source: "admin", status: "pending", customerName: "Mary", partySize: 6,
  phone: "216-555-0148", vesselId: V, date: "2026-07-20", time: "17:00",
  offeringId: asId<"OfferingId">("off-1"), reservedAt: "2026-07-11T23:55:00.000Z", holdMinutes: 120,
  tripMinutes: 100, paymentIntentIds: [PI],
  invoice: { fareCents: 50000, extrasCents: 0, taxCents: 3625, taxRateBps: 725, serviceFeeCents: 0,
    serviceFeeBps: 0, gratuityCents: 0, gratuityBps: 0, totalCents: 53625, amountDueNowCents: 53625 },
};

const succeeded = JSON.stringify({ type: "payment_succeeded", data: { paymentIntentId: PI, amountReceivedCents: 53625, currency: "usd", metadata: {} } });

describe("audit: a pay-link payment that lands on a cancelled phone booking", () => {
  it("is acked with one alert attempt, no payment row, no trail row, no refund; screens say booked / nothing charged", async () => {
    const repo = new InMemoryRepository();
    await repo.saveVessel({ id: V, name: "Brew", coiMaxPax: 12, manning: [] });
    await repo.saveReservation(row);
    const payments = new FakePaymentPort();
    payments.cancelError = new Error("stripe: intent is processing / network");
    // operator (or customer) cancels the unpaid booking; Stripe refuses the intent cancel
    expect(await cancelUnpaidPhoneBooking({ repo, now: NOW, payments }, ID, "operator")).toEqual({ ok: true, alreadyCancelled: false });

    const alert = vi.fn(async (_m: string) => {});
    const deps: WebhookDeps = { repo, payments, now: NOW, alertPaidButUnbooked: alert,
      sendConfirmation: vi.fn(async () => true), notifyCustomerSoldOut: vi.fn(async () => {}) };
    // the customer's 3-D Secure approval completes; Stripe sends payment_intent.succeeded
    const r = await processBookingWebhook(deps, succeeded, FAKE_SIGNATURE);
    expect(r).toEqual({ handled: true, outcome: "unbookable" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(payments.refunds).toHaveLength(0);
    expect(await repo.listPaymentsForReservation(ID)).toEqual([]);
    const trail = await repo.listTrailEventsFor(ID, [PI]);
    console.log("trail types:", trail.map((t) => t.type));
    expect(trail.some((t) => /charge|paid|unmatched|unbook/.test(t.type))).toBe(false);

    // /p/<token> re-opened: "Booking cancelled ... Nothing was charged."
    expect(payLinkState((await repo.getReservation(ID))!).kind).toBe("cancelled");
    // /book/success (the pay link's return_url): outcome unbookable → "pending" view → the "You're booked!" card
    payments.succeededIntents.set(PI, { paymentIntentId: PI, amountReceivedCents: 53625, currency: "usd", metadata: {} });
    const page = await confirmBookingByPaymentIntent(deps, PI);
    expect(page).toEqual({ handled: true, outcome: "unbookable" });
    expect(bookingOutcomeView("unbookable").kind).toBe("pending");
  });
});
```
Output:
```
 RUN  v4.1.8 /home/user/muster
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
Postgres's `cancelPendingIfUnpaid` (`postgres-repository.ts:1839-1841`, per the money report) was read, not run.

### P-A2 — S2-1 ("Nothing moved" after money moved)

**Probe** (`src/reservations/refund-after-move.audit-tmp.test.ts`, deleted):
```ts
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId, type PaymentId, type ReservationId } from "../domain/ids.js";
import { refundReservation, refundedTotalFor } from "./refund-payment.js";
import { actionMessage } from "../../app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.js";

const ID = asId<"ReservationId">("resv-1");
const PAY = asId<"PaymentId">("pay_pi_1");

class FlakyRepo extends InMemoryRepository {
  failRelease = false;
  failMark = false;
  override async releaseRefundLease(id: ReservationId, token: string): Promise<void> {
    if (this.failRelease) { this.failRelease = false; throw new Error("pg: connection terminated"); }
    return super.releaseRefundLease(id, token);
  }
  override async markPaymentRefunded(id: PaymentId, total: number): Promise<void> {
    if (this.failMark) { this.failMark = false; throw new Error("pg: connection terminated"); }
    return super.markPaymentRefunded(id, total);
  }
}

async function seed(repo: InMemoryRepository) {
  const r: Reservation = { id: ID, eventId: asId<"EventId">("e1"), source: "muster", status: "booked", customerName: "Mary", partySize: 6 };
  await repo.saveReservation(r);
  await repo.savePayment({ id: PAY, reservationId: ID, method: "stripe", kind: "full", amountCents: 53625, taxCents: 3625,
    currency: "usd", stripePaymentIntentId: "pi_1", status: "succeeded", createdAt: "2026-07-01T00:00:00.000Z" });
}

describe("audit: refundBooking's 'Nothing moved' after money moved", () => {
  it("lease release throws after a successful refund: call rejects, money moved, ledger written; a retry after the lease TTL refunds again", async () => {
    const repo = new FlakyRepo();
    await seed(repo);
    const payments = new FakePaymentPort();
    let t = Date.parse("2026-07-10T00:00:00.000Z");
    const now = () => new Date(t).toISOString();
    repo.failRelease = true;
    await expect(refundReservation({ repo, payments, now }, ID, 20000, 0)).rejects.toThrow(/connection terminated/);
    expect(payments.refunds).toHaveLength(1);
    expect(refundedTotalFor(await repo.listPaymentsForReservation(ID))).toBe(20000);
    // refundBooking maps the throw to refundErr=unreachable → the pane says:
    expect(actionMessage("refundErr", "unreachable")).toBe("Couldn’t refund just now. Nothing moved. Try again in a moment.");
    // The re-rendered page carries expectedRefunded=20000. Retrying the same $200 inside 60 s: stale.
    expect(await refundReservation({ repo, payments, now }, ID, 20000, 20000)).toEqual({ ok: false, reason: "stale" });
    t += 61_000;
    expect(await refundReservation({ repo, payments, now }, ID, 20000, 20000)).toMatchObject({ ok: true });
    expect(payments.refunds).toHaveLength(2); // the customer got $400 back for a $200 decision
  });

  it("markPaymentRefunded throws after a successful refund: call rejects, money moved, ledger NOT written", async () => {
    const repo = new FlakyRepo();
    await seed(repo);
    const payments = new FakePaymentPort();
    repo.failMark = true;
    await expect(refundReservation({ repo, payments, now: () => "2026-07-10T00:00:00.000Z" }, ID, 20000, 0)).rejects.toThrow();
    expect(payments.refunds).toHaveLength(1);
    expect(refundedTotalFor(await repo.listPaymentsForReservation(ID))).toBe(0);
  });
});
```
Output:
```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
Postgres's `releaseRefundLease` and `markPaymentRefunded` were read, not run. Whether the lease row survives a dropped connection depends on whether the delete committed.

### P-A3 — S1-1 (self-cancel commits, ack lost, re-read fails)

**Probe** (`src/reservations/cancel-reread.audit-tmp.test.ts`, deleted):
```ts
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { seedFleet } from "../import/resource-map.js";
import { asId } from "../domain/ids.js";
import type { Event, Reservation } from "../domain/entities.js";
import { cancelByCustomer, cancelledNoticeFrom, manageRedirectFor } from "./customer-cancel.js";

const VESSEL = asId<"VesselId">("vessel-brew-2");
const RESV = asId<"ReservationId">("resv-self-cancel-1");
const EVT = asId<"EventId">(`slot_${VESSEL}|2026-08-25|15:30`);
const NOW = "2026-08-01T16:00:00.000Z";

describe("audit: cancel commits, ack lost, the re-read also fails", () => {
  it("rethrows → the action says 'Nothing changed'; booking is cancelled, unrefunded, with no trail row", async () => {
    const repo = new InMemoryRepository();
    await seedFleet(repo);
    const ev: Event = { id: EVT, vesselId: VESSEL, date: "2026-08-25", time: "15:30", capacity: 16, status: "scheduled", source: "muster", price: 50000 };
    await repo.saveEvent(ev);
    const r: Reservation = { id: RESV, eventId: EVT, source: "muster", customerName: "Rhea", partySize: 6, status: "booked",
      invoice: { fareCents: 50000, extrasCents: 0, taxCents: 4000, taxRateBps: 800, serviceFeeCents: 1800, serviceFeeBps: 300,
        gratuityCents: 10000, gratuityBps: 2000, totalCents: 65800, amountDueNowCents: 65800 } };
    await repo.saveReservation(r);
    await repo.savePayment({ id: asId<"PaymentId">("pay-full"), reservationId: RESV, method: "stripe", kind: "full", amountCents: 65800,
      taxCents: 4000, gratuityCents: 10000, serviceFeeCents: 1800, currency: "usd", status: "succeeded", stripePaymentIntentId: "pi_full",
      createdAt: "2026-07-01T10:00:00.000Z" });

    const realWrite = repo.cancelBookingAndRelease.bind(repo);
    const realGet = repo.getReservation.bind(repo);
    let armed = false;
    repo.cancelBookingAndRelease = async (...args) => { await realWrite(...args); armed = true; throw new Error("connection reset"); };
    repo.getReservation = async (id) => { if (armed) { armed = false; throw new Error("connection reset"); } return realGet(id); };
    const fake = new FakePaymentPort();

    await expect(cancelByCustomer({ repo, now: () => NOW, payments: fake }, RESV, { quotedCents: 60800, expectedRefundedCents: 0 }))
      .rejects.toThrow(/connection reset/);
    // app/b/[code]/actions.ts:147-151 → cancel_failed → "Couldn't cancel just now. Nothing changed — try again in a moment."
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await repo.getEvent(EVT))?.status).toBe("cancelled");
    expect(fake.refunds).toHaveLength(0);
    const rows = await repo.listTrailEventsFor(RESV, []);
    expect(rows).toEqual([]);
    expect(cancelledNoticeFrom(rows)).toBeNull();
    // The customer presses again: already_cancelled → a plain manage page, no notice, no refund.
    expect(await cancelByCustomer({ repo, now: () => NOW, payments: fake }, RESV, { quotedCents: 60800, expectedRefundedCents: 0 }))
      .toEqual({ ok: false, reason: "already_cancelled" });
    expect(manageRedirectFor("CODE", { ok: false, reason: "already_cancelled" })).toBe("/b/CODE");
    expect(fake.refunds).toHaveLength(0);
  });
});
```
Output:
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
Whether a Postgres commit can land while the client sees an error is a driver and network property, read not run. The code's own comment assumes it can (`cancel-reservation.ts:256-258`).

### P-B1, P-B2, P-B3, P-B4 — S2-3, S2-7, S3-16, S2-4

Outputs:

```
P1 alert: SOLD OUT WHILE PAYING - charge pi_fake_1 for $652.94 was auto-refunded in full. No action needed; the customer has been told. ...
P1 onFailure: [ 'sold-out SMS to +12165550199 failed: Twilio send failed (503): down' ]
P2 trail: [ [ 'sold_out_notice_sent', 'sms: sms' ] ]
P2 sink: [channel:receipt] NOT SENT — no channel configured. to=unknown recipient / +12165550199
P3 trail: [ [ 'link_recovery_requested', 'sent' ] ]
P3 onFailure: [ 'email booking-link resend ... failed: ChannelSendError (status 503)', 'SMS booking-link resend ... failed: ChannelSendError (status 503)' ]
P4 outcome { handled: true, outcome: 'booked' } | status booked | confirmationSentAt undefined | sendConfirmation calls 1 | alerts 0
P4 trail types [ 'booked' ]
```

`src/reservations/b-customer-msgs.audit-tmp.test.ts`, run as `npm test -- src/reservations/b-customer-msgs.audit-tmp.test.ts --silent=false --reporter=verbose`: 4/4 passed (each `expect` asserts the defect). Outputs are quoted under B-1, B-2, B-4 and B-6.

```ts
import { describe, expect, it, vi } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { LogChannel } from "../adapters/log-channel.js";
import type { Event, Offering, Reservation, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort } from "../ports/channel.js";
import { ChannelSendError } from "../ports/channel.js";
import type { WebhookDeps } from "./booking-webhook.js";
import { confirmBookingFromIntent } from "./confirm-booking.js";
import { bookForCustomer } from "./operator-booking.js";
import { startPayByLink } from "./pay-by-link.js";
import { sendSoldOutNotice } from "./sold-out-notice.js";
import { recoverBookingLink } from "./recover-booking-link.js";

const NOW = "2026-07-01T12:00:00.000Z";
const now = () => NOW;
const BOAT = asId<"VesselId">("v-boat");
const OFF = asId<"OfferingId">("off-1");
const vessel: Vessel = { id: BOAT, name: "Brew 3", coiMaxPax: 12, manning: [] };
const offering: Offering = { id: OFF, tenantId: asId<"TenantId">("t"), name: "Demo", status: "live", vesselIds: [BOAT],
  locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5, 6], departureTimes: ["13:30"] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000, tripLengthMinutes: 100, holdMinutes: 120 };
const dead: ChannelPort = { async send() { throw new ChannelSendError("Twilio", 503, "down"); } };

async function raceLoss(notify: WebhookDeps["notifyCustomerSoldOut"]) {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering); await repo.saveVessel(vessel);
  const res = await bookForCustomer(repo, { offeringId: OFF, vesselId: BOAT, date: "2026-07-04", time: "13:30",
    guestCount: 2, gratuityBps: 2000, customerName: "Phone Caller", phone: "216-555-0199" }, now);
  if (!res.ok) throw new Error(res.reason);
  const payments = new FakePaymentPort();
  await startPayByLink({ repo, payments, now }, res.reservation.id);
  await repo.saveEvent({ id: asId<"EventId">("xola-1"), vesselId: BOAT, date: "2026-07-04", time: "13:30",
    capacity: 12, status: "scheduled", source: "xola", price: 49900 });
  payments.intentStates.set("pi_fake_1", "settled");
  payments.succeededIntents.set("pi_fake_1", { paymentIntentId: "pi_fake_1",
    amountReceivedCents: res.reservation.invoice!.amountDueNowCents, currency: "usd", metadata: {} });
  const alert = vi.fn(async (_m: string) => {});
  const deps: WebhookDeps = { repo, payments, now, alertPaidButUnbooked: alert,
    sendConfirmation: vi.fn(async () => true), notifyCustomerSoldOut: notify };
  const out = await confirmBookingFromIntent(deps, (await payments.getSucceededPaymentIntent("pi_fake_1"))!);
  return { out, alert, repo };
}

describe("B shard probes", () => {
  it("P1: sold-out notice, both channels dead -> office alert still says 'the customer has been told'", async () => {
    const lines: string[] = [];
    const { out, alert } = await raceLoss(async (c) => {
      await sendSoldOutNotice({ sms: dead, onFailure: (d) => lines.push(d) }, c.contact);
    });
    console.log("P1 outcome", out, "\nP1 alert:", alert.mock.calls[0]?.[0], "\nP1 onFailure:", lines);
    expect(alert.mock.calls[0]![0]).toContain("the customer has been told");
  });

  it("P2: sold-out notice on a Twilio-dark deploy (LogChannel) writes 'sold_out_notice_sent'", async () => {
    const repo = new InMemoryRepository();
    const sink: string[] = [];
    const sms = new LogChannel({ linkBase: "https://x", sink: (l) => sink.push(l) });
    await sendSoldOutNotice({ sms, trail: { repo, now, key: "pi_1" } }, { customerName: "Phone Caller", phone: "+12165550199" });
    const rows = await repo.listTrailEvents();
    console.log("P2 trail:", rows.map((x) => [x.type, x.metadata.reason]), "\nP2 sink:", sink[0]?.split("\n")[0]);
    expect(rows.map((x) => x.type)).toEqual(["sold_out_notice_sent"]);
  });

  it("P4: confirmation that reports not-told: claim released, webhook 'booked', no trail row, nothing retries", async () => {
    // same phone-booking + pay fixture as raceLoss, without the Xola collision
    // sendConfirmation: vi.fn(async () => false)
    // asserts: outcome booked, confirmationSentAt undefined, no alert, no 'confirmation_skipped' row
  });

  it("P3: recovery with every channel failing records reason 'sent'", async () => {
    // one booked reservation (email + phone), email and sms both `dead`
    await recoverBookingLink({ repo, email: dead, sms: dead, linkBase: "https://x", now: () => "2026-08-15T12:00:00.000Z",
      today: "2026-08-15", onFailure: (d) => failures.push(d) }, async () => [{ reservation, event }],
      { contact: "marcus@example.com", lastName: "Webb" });
    expect((await repo.listTrailEvents())[0]!.metadata.reason).toBe("sent");
  });
});
```

(P3 and P4 are abridged above to their operative lines. The full bodies used the fixtures shown in P1 and `recover-booking-link.test.ts:31-52`. P4's stderr also showed a fixture-only formation failure, "vessel has no manning rule", which does not affect the confirmation path.)

### P-C1, P-C2 — S3-1 (At-Risk alert one-shot), S3-2 (webhook monitor blind)

**P1** `src/builder/board-alert-oneshot.audit-tmp.test.ts`, for C-2:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { forwardBoardAlerts } from "../adapters/forward-board-alerts.js";
import { LogChannel } from "../adapters/log-channel.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort } from "../ports/channel.js";
import { tick } from "./tick.js";
import { formAllVesselDaysForTest } from "./form-all-test-support.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-x");
const AFTER = new Date("2026-06-30T00:00:00.000Z");

async function seed(repo: InMemoryRepository) {
  await repo.saveVessel({ id: VESSEL, name: "X", coiMaxPax: 16, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
  await repo.saveEvent({ id: asId<"EventId">("e1"), vesselId: VESSEL, date: "2026-07-01", time: "15:00", capacity: 16, source: "xola", status: "scheduled" });
  await repo.saveCrewMember({ id: asId<"CrewMemberId">("admin-a"), name: "A", phone: "+12165550001", ratings: [], status: "active", reliabilityScore: null });
  await repo.saveAdmin({ id: "admin-a", handle: "a", name: "A", active: true, createdAt: AFTER.toISOString(), deactivatedAt: null });
  await formAllVesselDaysForTest(repo);
}

describe("audit probe: At-Risk alert is one-shot", () => {
  it("a send failure on the landing tick is never retried", async () => {
    const repo = new InMemoryRepository();
    await seed(repo);
    const dead: ChannelPort = { send: async () => { throw new Error("twilio 503"); } };
    const first = await tick(repo, AFTER);
    expect(first.boardLandings).toHaveLength(1);
    const sent1 = await forwardBoardAlerts(repo, dead, first.boardLandings, "https://x/admin/at-risk");
    const second = await tick(repo, AFTER);
    expect(second.boardLandings).toEqual([]); // never re-surfaced => never re-alerted
    expect(sent1).toBe(0);
  });

  it("a Twilio-dark LogChannel send counts as alerted", async () => {
    const repo = new InMemoryRepository();
    await seed(repo);
    const first = await tick(repo, AFTER);
    const lines: string[] = [];
    const sent = await forwardBoardAlerts(repo, new LogChannel({ linkBase: "https://x", sink: (l) => lines.push(l) }), first.boardLandings, "https://x/admin/at-risk");
    expect(sent).toBe(1);
  });
});
```

Output of `npm test -- src/builder/board-alert-oneshot.audit-tmp.test.ts`:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

The first tick surfaced 1 landing, the dead channel sent 0, and the second tick surfaced 0, so the alert is never sent. A logged-only send counts as 1.

**P2** `src/reservations/webhook-monitor.audit-tmp.test.ts`, for C-3:

```ts
import { describe, expect, it, vi } from "vitest";
import { monitorWebhookEndpoint } from "./webhook-health.js";

describe("audit probe: webhook monitor on a persistently failing read", () => {
  it("never alerts, run after run", async () => {
    const alert = vi.fn(async () => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      payments: { listWebhookEndpoints: async () => { throw new Error("403 restricted key lacks webhook_endpoints read"); } },
      alert,
    };
    const results = [];
    for (let i = 0; i < 18; i++) results.push(await monitorWebhookEndpoint(deps, { url: "https://x/api/webhooks/stripe", events: ["checkout.session.completed"] }));
    expect(alert).not.toHaveBeenCalled();
    expect(results.every((r) => !r.checked && !r.healthy)).toBe(true);
    expect(err).toHaveBeenCalledTimes(18);
    err.mockRestore();
  });
});
```

Output: `Test Files 1 passed (1) / Tests 1 passed (1)`. 18 runs (three days at six a day) produced 0 alerts and 18 log lines.

### P-D — S2-9, S2-10, S2-11

`app/(admin)/admin/shifts/silent.audit-tmp.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
class Redirect extends Error { constructor(public url: string) { super(`REDIRECT ${url}`); } }
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Redirect(u); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../../../lib/auth", () => ({ readSubject: async () => ({ kind: "admin", id: "op-1" }) }));
const repoStub = { setEnginePaused: vi.fn(async () => { throw new Error('relation "settings" does not exist'); }) };
vi.mock("../../../lib/repo", () => ({ getRepo: () => repoStub }));
const relayNotices = vi.fn(async () => { throw new Error("APP_BASE_URL unset"); });
const relayAsks = vi.fn(async () => { throw new Error("APP_BASE_URL unset"); });
vi.mock("../../../lib/channel", () => ({
  relayNotices: (...a: unknown[]) => relayNotices(...(a as [])),
  relayAsks: (...a: unknown[]) => relayAsks(...(a as [])),
  forwardFormNotices: async () => { throw new Error("APP_BASE_URL unset"); },
}));
vi.mock("@core/builder/merge.js", () => ({ mergeShift: async () => ({ form: {}, freedCrew: ["crew-a", "crew-b"] }) }));
vi.mock("@core/builder/split.js", () => ({ splitShift: async () => ({}) }));
vi.mock("@core/oracle/audit-log.js", () => ({ logFormAudit: async () => {}, logCrewRemoved: async () => {}, logCrewAdded: async () => {} }));
const askCommitted = vi.fn();
vi.mock("@core/asks/lean.js", () => ({
  lean: async () => { askCommitted(); return { error: false, ask: { id: "ask-1" } }; },
  assignFromPool: async () => { askCommitted(); return { error: false, ask: { id: "ask-1" } }; },
}));
async function urlOf(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof Redirect) return e.url; throw e; }
  return "(no redirect)";
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
describe("audit probe — silent failures", () => {
  it("merge: relay throws, banner param still claims 2 crew notified", async () => {
    const { mergeAction } = await import("./actions");
    const fd = new FormData(); fd.set("shiftId", "s-1");
    const url = await urlOf(mergeAction(fd));
    console.log("merge redirect:", url);
    expect(relayNotices).toHaveBeenCalled();
    expect(url).toContain("merge_ok=2");
  });
  it("engine pause: write fails, redirect goes to /admin (which itself redirects to /admin/shifts)", async () => {
    const { setEnginePaused } = await import("../actions");
    const fd = new FormData(); fd.set("paused", "true");
    const url = await urlOf(setEnginePaused(fd));
    console.log("pause redirect:", url);
    expect(url).toBe("/admin?engine_error=unavailable");
    const home = await import("../page");
    const homeUrl = await urlOf(Promise.resolve().then(() => home.default()));
    console.log("/admin redirects to:", homeUrl);
    expect(homeUrl).toBe("/admin/shifts");
  });
  it("at-risk leanOn: ask committed, relay throws, copy code says nothing was sent", async () => {
    const { leanOn } = await import("../at-risk/actions");
    const fd = new FormData(); fd.set("shiftId", "s-1"); fd.set("crewMemberId", "crew-a");
    const url = await urlOf(leanOn(fd));
    console.log("leanOn redirect:", url, "ask committed:", askCommitted.mock.calls.length);
    expect(askCommitted).toHaveBeenCalled();
    expect(url).toBe("/admin/at-risk?lean_error=unavailable");
  });
});
```

Output of `npm test -- "app/(admin)/admin/shifts/silent.audit-tmp.test.ts" --reporter=verbose`:

```
merge redirect: /admin/shifts?mode=edit&merge_ok=2
pause redirect: /admin?engine_error=unavailable
/admin redirects to: /admin/shifts
leanOn redirect: /admin/at-risk?lean_error=unavailable ask committed: 1
 ✓ … merge: relay throws, banner param still claims 2 crew notified 67ms
 ✓ … engine pause: write fails, redirect goes to /admin (which itself redirects to /admin/shifts) 19ms
 ✓ … at-risk leanOn: ask committed, relay throws, copy code says nothing was sent 7ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### P-E — S2-16, S2-18

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { answeredNoticeCode } from "../crewapp/answered-code.js";
import { assignPerson, bailWithDerivedLateness, broadcastAsk, confirmSeat, recordResponse, recordResponseAndConfirm } from "./ask-loop.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const SHIFT = asId<"ShiftId">("shift-1");
const T0 = new Date("2026-07-01T12:00:00.000Z");

async function setup() {
  const repo = new InMemoryRepository();
  const a = asId<"CrewMemberId">("crew-a");
  await repo.saveCrewMember({ id: a, name: "a", phone: "555", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">("c"), crewMemberId: a, type: "MMC", expiry: "2026-12-31" });
  await repo.saveShift({ id: SHIFT, vesselId: asId<"VesselId">("v"), date: "2026-07-01", state: "Pending", eventIds: [] });
  const seatId = asId<"SeatId">("seat-1");
  await repo.saveSeat({ id: seatId, shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Open" });
  return { repo, a, seatId };
}

describe("audit probe: respondToAsk swallow", () => {
  it("a throw after saveAsk leaves the ask answered; the re-tap says 'already' while the seat is still Asked", async () => {
    const { repo, seatId } = await setup();
    const [ask] = await broadcastAsk(repo, seatId, T0);
    const orig = repo.saveSeatIfState.bind(repo);
    let fail = true;
    repo.saveSeatIfState = (async (...args) => { if (fail) { fail = false; throw new Error("db blip"); } return orig(...args); }) as typeof repo.saveSeatIfState;
    await expect(recordResponseAndConfirm(repo, ask!.id, "accepted", new Date(T0.getTime() + 1000))).rejects.toThrow("db blip");
    const out = await recordResponseAndConfirm(repo, ask!.id, "accepted", new Date(T0.getTime() + 2000));
    expect(answeredNoticeCode("accepted", out)).toBe("already");
    expect((await repo.getSeat(seatId))!.state).toBe("Asked");
  });
});

describe("audit probe: bail swallow", () => {
  it("saveSeat failing after logShiftBailed reports raced; seat stays Confirmed, bail event logged", async () => {
    const { repo, a, seatId } = await setup();
    const ask = await assignPerson(repo, seatId, a, T0);
    await recordResponse(repo, ask!.id, "accepted", new Date(T0.getTime() + 1000));
    await confirmSeat(repo, seatId, new Date(T0.getTime() + 2000));
    const orig = repo.saveSeat.bind(repo);
    repo.saveSeat = (async () => { throw new Error("db blip"); }) as typeof repo.saveSeat;
    const out = await bailWithDerivedLateness(repo, seatId, new Date(T0.getTime() + 3000), a);
    repo.saveSeat = orig;
    const types = (await repo.reliabilityEventsFor(a)).map((e) => e.type);
    expect(out.code).toBe("raced");
    expect((await repo.getSeat(seatId))!.state).toBe("Confirmed");
    expect(types).toContain("shift_bailed");
  });
});
```

Output of `npm test -- src/asks/swallow-probe.audit-tmp.test.ts`:

```
 RUN  v4.1.8 /home/user/muster
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
