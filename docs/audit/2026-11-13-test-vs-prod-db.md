# Audit — test database vs. production database (Repository port parity)

**Commit audited:** `main` at `0c4bddf` (merge of pull request #1264). **Date:** 2026-11-13.
**Scope:** the 181 methods of `Repository` (`src/ports/repository.ts:107-1105`), in-memory adapter (`src/adapters/in-memory-repository.ts`, "IM") vs Postgres adapter (`src/adapters/postgres-repository.ts`, "PG"), against `db/migrations/`, on seven points: (1) ordering, (2) nulls/absent fields, (3) conditional writes, (4) locks/concurrency, (5) duplicate keys/constraints, (6) transactions, (7) dates and money.

## 1. Summary

Of the **181** port methods, **92 agree on all seven points** as read and **89 differ on at least one**. Of the 89, 40 differ only in the order of rows with no `ORDER BY`, and 20 only in a constraint that Postgres enforces and memory does not. **12 methods are never named in any contract suite** (`repository-contract.ts`, `check-in-contract.ts`, `rate-limit-contract.ts`). Many more are covered only on the happy path. Severity counts: **S1: 0 · S2: 2 · S3: 29 · S4: 6**. Separately, **2 defects are present in both adapters**; they are listed in §2.5 and not counted, because the question is parity.

The paths that book, charge, refund and cancel agree in both adapters on every point that decides an outcome:
- the hull-overlap predicate and its half-open boundaries
- which statuses count
- when a pending row lapses
- the whole-boat mutex
- the confirm claim, the refund lease and the recovery throttle
- `markPaymentRefunded` / `markPaymentDisputed`
- every return value on every branch

The contract suite pins each of these. The differences found are in edge data no current writer produces (S3), in list order a person sees (S2), and in what the suite never exercises (S4).

How the evidence was gathered:
- **Postgres was not available.** Every Postgres claim below was **read, not run**.
- In-memory claims marked *tested* come from probe tests (`src/adapters/*.audit-tmp.test.ts`), run with `npm test -- <file>`, all passing as quoted, then deleted.
- The baseline run `npm test -- src/adapters/in-memory-repository.test.ts src/adapters/postgres-repository.test.ts` gave 245 passed, Postgres file skipped.

Known findings met during the audit, cited and not re-reported:
- **crewing S3-1** — `listSeatsForShift`, no `ORDER BY`
- **crewing S4-11** — `logReliabilityEvent`, duplicate id
- **crewing S3-10** — `saveAsk`, unconditional upsert
- **crewing S2-4, S3-16** — whole-row seat and shift writes from a stale read
- **payroll F23** — memory does not enforce the one-open-punch index
- **payroll F21** — `in_at` compared as text
- **money F18** — a read-vs-write difference, not an adapter one

## 2. Findings, most severe first

### 2.1 S1

None found. The closest candidate needs a running database to rule out: a production isolation level other than READ COMMITTED (§5, item 1).

### 2.2 S2

**S2-1 · `listReservationsForEvent` — guest order on the crew manifest shuffles in production only.**
- **IM:** `src/adapters/in-memory-repository.ts:650-654` returns the order rows were first inserted; a re-save keeps the row's position.
- **PG:** `src/adapters/postgres-repository.ts:1504-1510` runs `select * from reservations where event_id=$1` with no `ORDER BY`, so rows come back in heap order. An UPDATE moves the row physically, so the order can change (read).
- **Caller that depends on it:** `src/crewapp/shift-card.ts:249-259` maps guests in list order. It sorts the events (`:268`) but not the guests. The same pattern appears in `src/checkin/signing.ts:296-302` (check-in picker) and `src/import/browse.ts:61-70` (CLI).
- **Scenario:** a Xola departure has parties A, B, C. A re-import updates A's row. In memory the manifest still reads A, B, C. In production it can read B, C, A, and crew see the list reorder between two loads.
- **Contract coverage:** `repository-contract.ts:1207, 1288, 2401` assert counts and single rows only.
- **Confidence:** tested on the in-memory side (probe below), read on the PG side.

```ts
for (const n of ["a","b","c"]) await repo.saveReservation({ id: rid(n), eventId: SLOT, source: "xola", customerName: n, partySize: 1, status: "booked" });
await repo.saveReservation({ id: rid("a"), eventId: SLOT, source: "xola", customerName: "a2", partySize: 1, status: "booked" });
expect((await repo.listReservationsForEvent(SLOT)).map((r) => r.customerName)).toEqual(["a2","b","c"]); // passed
```

**S2-2 · `listOfferings` (and the other catalog lists) — the public "Choose a cruise" picker order is unspecified in production.**
- **IM:** `src/adapters/in-memory-repository.ts` keeps offerings in a Map in insertion order; an edit keeps the original position.
- **PG:** `src/adapters/postgres-repository.ts:1212-1215` runs `select * from offerings` with no `ORDER BY` (read).
- **Caller that depends on it:** `app/(public)/book/page.tsx:120,138` renders `live.map(...)` in repository order, and a customer sees that list.
- **Scenario:** the operator edits the description of the first of two live trips. In memory it stays first. In production it can drop to second.
- **Contract coverage:** `repository-contract.ts:1802` does not assert order.
- **Confidence:** tested on the in-memory side (an edited offering read back as `["First (edited)","Second"]`); the PG order is suspected.
- **Same pattern, no customer-facing caller:** `listVessels` (PG:882), `listLocations` (:1259), `listAddOns` (:729), `listBlocks` (:1280), `listEvents` (:1167), `listCustomers` (:768), `listRoleTypes` and `listAllRoleTypes` (:701, :708). Their admin pages sort by name. `listCustomers` sorts by name, and equal names fall back to adapter order (`src/customers/customer-view.ts:141`).

### 2.3 S3 — they differ; nothing depends on it today

Bookings, payments and refunds come first. Each finding cites both adapters. PG lines were read; IM lines were tested where marked.

**S3-1 · `bookPendingIfHullFree` — on a `lost` result, memory leaves behind the Event it created or resurrected.**
- **IM:** `in-memory-repository.ts:755` (resurrect) and `:758` (insert) both run before the mutex check at `:765-772`. The `return {result:"lost"}` at `:772` does not undo them.
- **PG:** the insert at `postgres-repository.ts:1619-1634` and the resurrect at `:1655-1668` both roll back at `:1711-1713`.
- **Caller:** `src/reservations/write-booking.ts:175`. Nothing reads the Event after a `lost` today.
- **Scenario:** a cancelled Event at the slot is still held by a `booked` row. A losing confirm leaves it `scheduled` in memory, carrying the loser's price. A test can pass on a state production never reaches.
- **Confidence:** tested.

**S3-2 · The pending-overlap predicate splits at four data edges.**
The predicate lives in `src/reservations/hull-busy.ts:115-150` and `src/reservations/pending.ts:85-89` for IM, and in `pendingOverlapSql` at `postgres-repository.ts:450-468` for PG. Both write methods use it (PG:1603-1614 and :1761-1764).
- (a) **Empty-string `holderToken`.** IM treats `""` as no token, so the result is `lost` (`hull-busy.ts:117`). PG's `$7 is not null and holder_token is not distinct from $7` (`:458`) exempts every rival whose token is `''`, so the result is `won`. **PG is the looser side here, so this is the double-book direction.** No writer stores `""`: the edge filters out falsy tokens (`app/(public)/book/checkout/actions.ts:257`).
- (b) **A live pending rival with a NULL `time`.** IM blocks the whole day (`lost`). In PG, `time !~ …` evaluates to NULL and the row drops out (`:461-465`), so the result is `won`. PG is looser again. Both pending writers require `time` (IM:803, PG:1737).
- (c) **A rival time in seconds format, `"13:30:00"`.** IM parses it as 13:30, so a 17:00 candidate is `won`. In PG the regex fails and the whole day is blocked (`lost`). PG is stricter.
- (d) **`reservedAt` liveness.** IM compares instants (`pending.ts:88`). PG compares text (`:455`) on a `text` column (`db/migrations/20260905031117_reservations_pending_slot.sql:35`). Two consequences:
  - A no-millisecond timestamp, or garbage, reads as lapsed in IM and live in PG.
  - An offset-form timestamp inverts the result. That inversion is a double-book direction.

  Every writer today uses `toISOString()` (`src/reservations/claim.ts:325`).

Confidence: tested for all four edges (probes below).

```ts
// (a)
await repo.saveReservation(pending({ id: rid("rival"), holderToken: "" }));
expect(await repo.savePendingIfHullFree(pending({ id: rid("me"), holderToken: "" }), SINCE)).toEqual({ result: "lost" }); // passed; PG (read): won
// (b)
const rival = pending({ id: rid("rival") }); delete rival.time; await repo.saveReservation(rival);
expect(await repo.savePendingIfHullFree(pending({ id: rid("me"), time: "08:00", holdMinutes: 60 }), SINCE)).toEqual({ result: "lost" }); // passed; PG: won
// (c)
await repo.saveReservation(pending({ id: rid("rival"), time: "13:30:00", holdMinutes: 60 }));
expect(await repo.savePendingIfHullFree(pending({ id: rid("me"), time: "17:00", holdMinutes: 60 }), SINCE)).toEqual({ result: "won" }); // passed; PG: lost
// (d)
await repo.saveReservation(pending({ id: rid("rival-nomillis"), reservedAt: "2026-06-01T11:45:00Z" }));
expect(await repo.savePendingIfHullFree(pending({ id: rid("me-a") }), "2026-06-01T11:45:00.500Z")).toEqual({ result: "won" }); // passed; PG: lost
```

**S3-3 · A malformed event time or candidate time throws in PG and returns `lost` in IM.**
- **IM:** an unreadable time blocks the whole day (`hull-busy.ts:87-90`), and a NaN candidate is refused (`:188`).
- **PG:** the events-overlap SQL runs `split_part(time,':',2)::int` with no regex guard (`postgres-repository.ts:1577-1580, 1750-1753`). For example, `'9:00 AM'` raises 22P02, the transaction rolls back and the error is rethrown (`:1717-1719, 1776-1779`).
- **Effect in production:**
  - `claim.ts:497` would throw instead of trying the next boat.
  - The confirm (`write-booking.ts:175`) would throw instead of returning `lost`, so the refund-on-lost path would not run.
- **Today:** Xola times are `dt.slice(11,16)` (`src/import/xola-client.ts:147`), so no malformed time is known.
- **Confidence:** tested.

```ts
await repo.saveEvent({ id: asId<"EventId">("xola-bad"), vesselId: V, date: D, time: "9:00 AM", capacity: 12, status: "scheduled", source: "xola" });
expect(await repo.savePendingIfHullFree(pending({ id: rid("me") }), SINCE)).toEqual({ result: "lost" }); // passed; PG (read): throws 22P02
```

**S3-4 · `savePendingIfHullFree` with an id that already exists: memory overwrites, PG throws.**
- **IM:** `in-memory-repository.ts:813` (`#storeWholeReservation`) overwrites any row, including a `booked` one.
- **PG:** `postgres-repository.ts:1769-1773` is a plain insert, so it throws 23505.
- **Today:** every caller mints a fresh id (`src/reservations/create-departure-payment-intent.ts:178`).
- **Confidence:** tested. The probe turned a `booked` row into `pending` with `eventId: null`.

**S3-5 · `bookPendingIfHullFree` takes the caller's Event `status` and `source` in memory.**
- **IM:** `in-memory-repository.ts:758` stores the Event as passed.
- **PG:** hard-codes `source='muster'` (`postgres-repository.ts:1621`) and requires `status='scheduled'` (`:1669-1678`). A non-scheduled candidate therefore gets `lost`, where IM returns `won`.
- **Today:** the caller always passes `scheduled`/`muster` (`write-booking.ts:149-150`).
- **Confidence:** tested.

**S3-6 · `saveEvent` — memory has no counterpart to the `events_muster_slot_identity` unique index.**
- **IM:** `in-memory-repository.ts:481-483` is a plain `Map.set`.
- **PG:** upserts on `id` (`postgres-repository.ts:1151-1158`). A second muster row at the same (vessel, date, time) violates `db/migrations/20260718142705_claim_hold_mutex.sql:28-30`.
- **What depends on one row per slot:**
  - `src/reservations/booking-invoice.ts:62-68` takes the first muster event at the slot as the price override.
  - `bookPendingIfHullFree` uses `.find` on the first match (IM:713-718, 732-737).
- **Today:** the only production `saveEvent` caller writes `source:"xola"` (`src/import/import-reservations.ts:242-245`).
- **Confidence:** tested (two rows held).

**S3-7 · `listAllReservations` — row order feeds claim's reuse lookup.**
- **IM:** insertion order (`in-memory-repository.ts:655-657`).
- **PG:** no `ORDER BY` (`postgres-repository.ts:1511-1514`).
- **Caller:** `src/reservations/claim.ts:442-451` uses `.find` to pick the asker's own live row. Two such rows can exist after a fallback write (`:483-497`). Memory always reuses the older one; PG may reuse either.
- **Impact:** no double-book, because the rows share a token. The visible effect is the abandonment count.
- **Confidence:** suspected.

**S3-8 · `getReservationByPaymentIntentId` and `getPaymentByIntentId` disagree when an intent sits on two rows.**
- **`getReservationByPaymentIntentId`:**
  - IM: `in-memory-repository.ts:855` takes the first row inserted.
  - PG: `postgres-repository.ts:1876` uses `limit 1` with no order. The GIN index is not unique (`20260906130000_reservations_payment_intent_ids.sql:30-31`).
- **`getPaymentByIntentId`:**
  - IM: `in-memory-repository.ts:579-584` uses `.find` (first inserted).
  - PG: `postgres-repository.ts:1421-1433` orders `created_at, id limit 1`, so it returns the oldest. The index is deliberately non-unique (`20260810011500_payment_intent_lookup.sql:10-19`).
- **Callers:** `src/reservations/booking-webhook.ts:1242, 1279` (refund) and `:1408, 1424` (dispute) write to whichever row comes back.
- **Today:** no duplicates. Ids are `pay_<pi>` (`confirm-booking.ts:52`), and each intent is minted onto one row only (`create-departure-payment-intent.ts:389`). Only a hand-reconciled duplicate would split the adapters.
- **Confidence:** tested (IM returned `pay-new`; PG would return `pay-old`).

**S3-9 · `saveGratuity` — the last write wins in memory, the first in PG.**
- **IM:** `in-memory-repository.ts:965-967` is an unconditional `set`.
- **PG:** `postgres-repository.ts:2035-2052` uses `on conflict (id) do nothing`.
- **Caller:** `src/reservations/booking-webhook.ts:921-932` saves `grat_pre_<key>` with `createdAt: deps.now()`, and confirm runs at least twice per booking (once from the webhook, once from `/book/success`).
- **Effect:** in memory the gratuity's `createdAt`, which is the trail timestamp (`src/reservations/reservation-trail-view.ts:350`), becomes the later run's time. Production keeps the first.
- **Contract gap:** the only re-save in the contract (`repository-contract.ts:2099`) re-saves an identical row.
- **Confidence:** tested (`[[9999,"2026-07-12T00:05:00.000Z"]]`, second write kept).

**S3-10 · `listPaymentsForReservation` and `listGratuitiesForReservation` — order.**
- **`listPaymentsForReservation`:** IM `in-memory-repository.ts:617-621` returns insertion order; PG `postgres-repository.ts:1478-1484` orders by `created_at` with no tie-break.
- **`listGratuitiesForReservation`:** IM `:971-978` sorts by `createdAt` and keeps insertion order on ties; PG `:2060-2068` uses `created_at, id`. Its comment says this matches memory; on a tie it does not.
- **Callers re-sort:** `src/reservations/refund-payment.ts:177-179` sorts "so … don't allocate differently between adapters", and the trail re-sorts at `reservation-trail-view.ts:358-363`.
- **Confidence:** tested.

**S3-11 · Settings round-trip through `text` in PG only.**
- **`setPaymentConfig` / `getPaymentConfig`:**
  - IM: `in-memory-repository.ts:549-554` stores the value as given.
  - PG: `postgres-repository.ts:1323-1361` writes `String(v)` once per key with no transaction, and parses on read, falling back to the default on a non-finite value.
  - Effect: `NaN` reads back as `NaN` in IM and as the default in PG. A multi-key write can land partially in PG.
- **`setBookingCutoffHours` / `getBookingCutoffHours`:**
  - IM: `:555-560` stores the value as given.
  - PG: `:1362-1372` parses on read with `parseBookingCutoffHours` (`src/reservations/booking-cutoff.ts:23-32`, whole hours only).
  - Effect: 2.5, -3 and NaN come back as written in IM and as **0** (no cutoff) in PG.
  - Callers: `claim.ts:352`, `app/(public)/book/page.tsx:107` and `app/(public)/book/checkout/page.tsx:114` read the value. The only writer is `db/seed-booking-cutoff-dev.ts:50`. This becomes S2 once a settings screen calls the setter.
- **`setCheckInConfig`:**
  - IM: `:1585` stores one object, by reference to the caller's array.
  - PG: `:3126-3132` writes one upsert per key, with no transaction.
  - Today: `src/checkin/waiver-admin.ts:161` sends a fresh array.
- **Confidence:** tested (cutoff probe `["2.5","-3","NaN"]`; aliasing probe `[5,2,1]`).

**S3-12 · Money columns are `integer` in PG and any JS number in memory.**
- **IM:** `in-memory-repository.ts:567-571` and `:585-596` accept 100.5 and NaN; NaN gets status `partially_refunded`.
- **PG:** `amount_cents`, `tax_cents` and `refunded_cents` are `integer` (`db/migrations/20260715024322_payments.sql:29-39`), as is `gratuity.amount_cents` (`20260718235345_gratuity.sql:25`). A fractional value should be rejected.
- **Today:** `refund-payment.ts:128` enforces `Number.isInteger`, and Stripe amounts are integers.
- **Confidence:** tested on the IM side (`100.5 partially_refunded NaN partially_refunded`); the PG rejection is suspected.

**S3-13 · Foreign keys that exist only in PG, on the money tables.**
- **The keys:**
  - `payments.reservation_id`, `gratuity.reservation_id` and `gratuity.event_id` (`db/migrations/20260722170000_fk_reservations_era.sql:44-46`)
  - `refund_leases.reservation_id` (`20260814170248_refund_leases.sql:34`)
  - `reservations.customer_id` (`20260722143000_customers.sql:49-51`)
  - `booking_codes.reservation_id` (`20260814123030_booking_codes.sql:28`)
- **IM:** `savePayment` (`:567`), `saveGratuity` (`:965`), `acquireRefundLease` (`:925-936`), `saveReservation` (`:643-645`) and `saveBookingCode` (`:288`) check none of them.
- **Callers guard first:** `booking-webhook.ts:1488-1502` and `refund-payment.ts:131-153` both read the parent before writing, and `write-booking.ts:161` creates the customer first.
- **Coverage:** only the payments FK is pinned, by a PG-only test (`postgres-repository.test.ts:568-586`).
- **Confidence:** tested (`P7 1 1 {"acquired":true}` against nonexistent parents).

**S3-14 · `getOrCreateCustomerByPhone` — memory can never produce the display-code collision that the paid confirm retries on.**
- **IM:** `in-memory-repository.ts:266-275` scans by phone, then inserts. A duplicate display code, or an id held by another phone, silently succeeds or overwrites.
- **PG:** `postgres-repository.ts:780-795` uses `on conflict (phone_e164) do nothing`. A clash on `customers_display_code_key` (`customers.sql:36`) or on the primary key throws.
- **Caller:** `src/customers/resolve.ts:61-82` retries only when the error text contains `display_code`, and it runs before the flip on the paid confirm (`write-booking.ts:161`). That retry has never run against a real collision. `src/customers/resolve.test.ts:60-66` passes in memory with two `C-000000` customers; on Postgres it would collide three times and reject.
- **Reachability:** with 32^6 codes, three collisions in a row are not reachable in practice.
- **Confidence:** tested.

**S3-15 · `listEventsForVesselDays` with a repeated vessel-day.**
- **IM:** `in-memory-repository.ts:494-497` de-duplicates through a Set.
- **PG:** `postgres-repository.ts:1179-1184` joins against `unnest`, so a repeated day returns duplicate rows.
- **Today:** callers de-duplicate first (`src/builder/form-shifts.ts:242-256`).
- **Confidence:** tested.

**S3-16 · Booking codes.**
- **`revokeBookingCode`:** IM `:308` tests truthiness, so an empty-string `revokedAt` is re-stamped. PG `:850` tests `is null`, so an empty string counts as already revoked.
- **`listBookingCodesForReservation`:** on tied `createdAt`, IM `:301` keeps insertion order; PG `:841` returns an arbitrary order.
- **Caller:** `liveBookingCode` returns the first live code (`src/reservations/ensure-booking-code.ts:40`). Two live codes exist only after a race of `ensureBookingCode`, which is check-then-insert in both adapters.
- **Confidence:** tested.

**S3-17 · Check-in foreign keys exist only in PG.**
- **IM:** `saveGuests` (`in-memory-repository.ts:1497-1499`), `insertTripLink` (`:1478-1487`), `postWaiverTemplate` (`:1437-1444`) and `claimWaiverReminder` (`:1564-1570`) accept references to nothing.
- **PG:** these foreign keys exist:
  - `db/migrations/20260929183642_check_in_and_waivers.sql:33, 50, 51, 57, 62, 69, 87`
  - `20260930204732_trip_links.sql:13`
  - `20261003185242_waiver_reminders.sql:18`
- **Guardian ordering:** PG's FKs are not deferrable, so a minor listed before their guardian fails the whole transaction (`postgres-repository.ts:2930-2963`).
- **Today:** callers order the adult first (`src/checkin/signing.ts:167-180`).
- **Confidence:** tested.

**S3-18 · `setDepartureCount` for an event that does not exist.**
- **IM:** `in-memory-repository.ts:1534-1535` keeps the count and lists it (`:1552-1555`).
- **PG:** `postgres-repository.ts:3040-3043` updates zero rows, so the count is lost.
- **Today:** gated on the event existing (`src/checkin/check-in.ts:139-140`).
- **Confidence:** tested.

**S3-19 · `incrementRateLimit` on an existing row.**
- **IM:** `in-memory-repository.ts:1602-1603` replaces `expiresAt`.
- **PG:** `postgres-repository.ts:3150-3153` keeps the first insert's `expires_at`, which the sweep (`:3147`) then uses.
- **Today:** the value is constant within a deploy (`src/rate-limit/rate-limit.ts:62-68`). It differs only when `windowMs` changes mid-window.
- **Confidence:** tested (IM counted 3; PG would sweep and return 1).

**S3-20 · `appendAuditEvent` — a duplicate id appends twice in IM and throws in PG.**
- **IM:** `in-memory-repository.ts:1231-1233` is a bare `push`.
- **PG:** `postgres-repository.ts:2412-2426` is a plain insert, against `id text primary key` (`db/migrations/0024_audit_events.sql:15`).
- **Callers swallow the error:** `src/oracle/audit-log.ts:146` and `app/(admin)/admin/shifts/actions.ts:146-151`. In production the row is lost silently, and at `shifts/actions.ts:141-145` the throw also skips the rest of the freed-crew loop.
- **History:** this collision has happened before (`src/oracle/audit-log.ts:47-49`).
- **Relation to known findings:** the same class as crewing S4-11, on a different table.
- **Confidence:** tested (2 rows).

**S3-21 · `recordSmsConsent` — the same duplicate-id split.**
- **IM:** `:1243-1245`. **PG:** `:2484-2498`, against `0017_sms_consent.sql:18`.
- **Today:** ids are random (`app/(crew)/crew/actions.ts:191`).
- **Confidence:** tested.

**S3-22 · `appendTimePunchEdit` — a duplicate id appends twice in IM and is a no-op in PG.**
- **IM:** `:470-472` pushes. **PG:** `:1133-1137` uses `on conflict (id) do nothing`.
- **Today:** ids are random UUIDs (`app/(crew)/crew/time/actions.ts:157, 206, 235`).
- **Confidence:** tested.

**S3-23 · `saveTimePunch` and `appendTimePunchEdit` — crew foreign keys exist only in PG.**
- **The keys:** `db/migrations/20260731180000_time_punches.sql:28` and `20260801180000_time_punch_edits.sql:33`.
- **IM:** `:426-433` and `:470-472` accept any crew id.
- **Caller:** `app/(admin)/admin/time-clock/actions.ts:99-117` passes a form-supplied crew id with no existence check. Production returns "error"; memory writes an orphan.
- **Coverage:** the contract always seeds crew first (`repository-contract.ts:405`).
- **Confidence:** tested.

**S3-24 · `addCrewMemberWithCredential` — PG never writes `gusto`, and a duplicate id behaves differently.**
- **IM:** `:376-380` overwrites both rows.
- **PG:** the column list at `:974-990` omits `gusto` (compare `saveCrewMember` at `:890, 909`). Both inserts are plain, so a duplicate id throws and the transaction rolls back.
- **Today:** the only caller (`src/admin/crew-cli.ts:265-282`) passes no `gusto`.
- **Confidence:** IM tested; PG read.

**S3-25 · `saveSeatIfState` — PG's UPDATE leaves `override` and `shift_id` untouched; IM replaces the whole row.**
- **IM:** `:1010-1013`. **PG:** `:2140-2142`.
- **Condition and return value:** match in both adapters.
- **Today:** both callers spread the seat they just read (`src/asks/claim.ts:166-174`, `src/asks/ask-loop.ts:411-414`).
- **Confidence:** tested (IM cleared `override` and moved `shiftId`).

**S3-26 · `listAsksForSeat` and `listCredentialsForCrew` — no `ORDER BY`; two callers break ties on adapter order.**
- **`listAsksForSeat`:** IM `:1035-1038` returns insertion order; PG `:2186-2191` is unordered.
- **`listCredentialsForCrew`:** IM `:393-398` and PG `:1028-1031` are both unordered.
- **Callers that depend on the order for ties:**
  - `statusFromAsks` (`src/crewapp/assignment-view.ts:103`)
  - `worstCredential` (`src/crew/credential-health.ts:101-110`), whose `type` is shown to crew at `src/crewapp/crew-view.ts:290`.
- **Relation to known findings:** a sibling of crewing S3-1, not a repeat of it.
- **Confidence:** tested on the IM side.

**S3-27 · Admins and calendar feeds — uniqueness exists only in PG; `listAdmins` order differs.**
- **`saveAdmin` / `getAdminByHandle`:** IM `:1048-1058` accepts a duplicate handle; PG `:2202-2225` relies on `handle text unique` (`db/migrations/0018_admins.sql:23`).
- **`saveCalendarFeed`:** IM `:1144` accepts a duplicate `token_hash`; PG relies on `token_hash … unique` (`0021_calendar_feeds.sql:25`).
- **`listAdmins` order:** PG orders by `handle` (`:2227`); IM returns insertion order (`:1059`). The only order-sensitive caller is the order in which board-alert texts are sent (`src/adapters/forward-board-alerts.ts:37-43`).
- **Confidence:** tested.

**S3-28 · Login codes — the stored fields differ (the decisions do not).**
- **`claimLoginAttempt` on a correct code with no window:** PG writes `failed_in_window = 0` (`:2330`); IM leaves the field absent (`:1133-1134`).
- **`saveLoginCode` re-mint over a row with no window:** IM takes the caller's window (`:1069-1080`); PG keeps NULL (`:2247-2250`; its comment at `:2239-2243` admits this).
- **Effect:** nothing reads these except through `?? 0`.
- **Confidence:** tested.

**S3-29 · `saveImportRun`, `getImportRun` and `listShiftChanges`.**
- **Import runs:**
  - A re-save with fewer items keeps the dropped items in PG (`postgres-repository.ts:2584-2591`); IM replaces the run (`in-memory-repository.ts:1284`).
  - The PG item upsert can move an item to another run (`:2587`).
  - PG orders items by `id` (`:2611`), so `item-10000` sorts before `item-1001` once a run passes 9,999 items (ids padded at `app/lib/import-audit.ts:63`).
  - PG fills in `[]` for a missing summary list (`:615-616`); IM returns `undefined`.
  - Today: every run is saved once.
- **`listShiftChanges`:**
  - PG orders by `changed_at` only, with no tie-break column (`:2811-2813`; table `20260825181435_crew_shift_changes.sql:27-45`). IM returns insertion order (`:1399-1403`).
  - `foldShiftChanges` keeps ties in input order (`src/crewapp/shift-changes.ts:90, 117-134`). Same-instant changes can therefore net differently on the crew banner.
  - Severity is S3 because it is suspected: PG usually returns an append-only table in insertion order.
- **Confidence:** tested on the IM side.

### 2.4 S4 — contract-suite gaps with no known difference

- **S4-1 · Twelve methods are never named in any contract suite:**
  - `appendAuditEvent`, `listAuditEvents`, `listAllReliabilityEvents`
  - `recordShiftChanges`, `listShiftChanges`, `shiftChangeLastSeen`, `markShiftChangesSeen`
  - `listCrewMembers`, `listAllCredentials`, `listAllRoleTypes`, `listAllSeats`, `listAllAsks`

  `markShiftChangesSeen` is tested only on IM (`src/crewapp/shift-changes-read.test.ts`).
- **S4-2 · Order is almost never asserted.** List methods are checked by length, or by a set sorted in the test (for example `repository-contract.ts:1206, 2206, 2211, 2625, 2640, 2957`). The exceptions are `listTrailEvents`, `listMessagesForThread`, `listImportRuns` and `listDeparturesCountedAboveCheckedIn`. Every S2 and every order-shaped S3 above is invisible to the suite.
- **S4-3 · Foreign keys and unique indexes are exercised only by the Postgres-only file**, and only for payments, check-in guests and time punches (`postgres-repository.test.ts:304, 391, 490`). The contract seeds parents "for the FK" (`repository-contract.ts:405`), so it never sees a refusal.
- **S4-4 · Concurrency appears only in the Postgres-only file**, at `postgres-repository.test.ts:226, 254, 667, 743, 793, 981` (cancelBookingAndRelease's two presses and lock wait start there). That file never ran in this audit (no Postgres). No test anywhere covers a concurrent `cancelPendingIfUnpaid` against `bookPendingIfHullFree`.
- **S4-5 · Duplicate-id behaviour is not pinned for any append or insert method.** Every duplicate-id split above (S3-4, S3-9, S3-20, S3-21, S3-22, S3-24) passes the current suite.
- **S4-6 · Tie order on equal timestamps** in `listWaiverRemindersForReservation`, `listRateLimitRefusals`, `listTimePunchesForCrew` and `listTimePunchEdits`: IM keeps insertion order, PG's is unspecified (IM:1574, 1625, 447, 476; PG:3096, 3175, 1104, 1144). No caller depends on it.

### 2.5 Wrong in both adapters (not a parity gap; not counted)

- **`recordRead` / `recordNotification` can move backwards.** IM overwrites (`in-memory-repository.ts:121-131`), and so does PG (`postgres-repository.ts:2759, 2766`). Neither uses the `greatest()` that `markShiftChangesSeen` uses (`:2850`). Two out-of-order read posts (`app/(crew)/crew/activity/route.ts:48`, `app/(crew)/crew/threads/actions.ts:63`) roll the read mark back, and the doorbell (`src/builder/doorbell-tick.ts:91, 104`) can ring the crew member again. The contract pins overwrite as correct (`repository-contract.ts:3061`). Tested on the IM side.
- **`consumeLoginCodeIfUnused` does not check which code it burns.** Both adapters key the consume on the subject and `consumed_at is null` only (IM:1096-1100, PG:2283-2284). If a re-request mints code B between the claim (`src/auth/login-code.ts:316`) and the consume (`:335`), B is burned while the user signs in with A. Not a security hole: `:333` checks the hash. Tested.

## 3. Per-method table

C = covered by a contract suite (yes / partly / no). Points = which of the seven differ ("—" = none found). Findings are §2 ids; "k:" marks a known ledger finding.

| # | Method | C | Points | Ref |
|---|---|---|---|---|
| 1 | saveRoleType | yes | — | |
| 2 | getRoleType | partly | — | |
| 3 | listRoleTypes | yes | 1 | S2-2 (pattern) |
| 4 | listAllRoleTypes | no | 1 | S2-2, S4-1 |
| 5 | saveVessel | partly | — | |
| 6 | getVessel | partly | — | |
| 7 | listVessels | partly | 1 | S2-2 |
| 8 | saveAddOn | yes | — | |
| 9 | getAddOn | yes | — | |
| 10 | listAddOns | partly | 1 | S2-2 |
| 11 | saveCustomer | yes | 5 | S3-14 |
| 12 | getCustomer | yes | — | |
| 13 | getCustomerByPhone | yes | 5 | S3-14 |
| 14 | getCustomerByCode | yes | 5 | S3-14 |
| 15 | listCustomers | partly | 1 | S2-2 |
| 16 | getOrCreateCustomerByPhone | partly | 4, 5 | S3-14 |
| 17 | listReservationsForCustomer | yes | 1, 5 | S3-13 |
| 18 | saveBookingCode | yes | 5 | S3-13 |
| 19 | getBookingCode | yes | — | |
| 20 | listBookingCodesForReservation | yes | 1 | S3-16 |
| 21 | revokeBookingCode | yes | 3 | S3-16 |
| 22 | saveCrewMember | yes | — | |
| 23 | getCrewMember | yes | — | |
| 24 | listCrewMembers | no | 1 | S4-1 |
| 25 | updateCrewContact | yes | — | |
| 26 | setCrewStatus | yes | — | |
| 27 | updateCrewWeekdaysOff | yes | — | |
| 28 | updateCrewGusto | yes | — | |
| 29 | addCrewMemberWithCredential | partly | 2, 5 | S3-24 |
| 30 | saveCredential | yes | — | |
| 31 | getCredential | yes | — | |
| 32 | listCredentialsForCrew | yes | 1 | S3-26 |
| 33 | listAllCredentials | no | 1 | S4-1 |
| 34 | removeCredential | yes | — | |
| 35 | savePtoWindow | yes | — | |
| 36 | listPtoWindowsForCrew | yes | 1 | callers sort |
| 37 | listAllPtoWindows | yes | 1 | callers sort |
| 38 | removePtoWindow | yes | — | |
| 39 | saveTimePunch | yes | 4, 5 | k: payroll F23; S3-23 |
| 40 | getTimePunch | yes | — | |
| 41 | getOpenPunchForCrew | yes | 4 | k: payroll F23 |
| 42 | listTimePunchesForCrew | yes | 1 | S4-6 |
| 43 | listTimePunchesBetween | yes | 7 | k: payroll F21 |
| 44 | listAllTimePunches | yes | 1 | contract sorts |
| 45 | removeTimePunch | yes | — | |
| 46 | appendTimePunchEdit | yes | 3, 5 | S3-22, S3-23 |
| 47 | listTimePunchEdits | yes | 1 | S4-6 |
| 48 | listOfferings | partly | 1 | **S2-2** |
| 49 | getOffering | yes | — | |
| 50 | saveOffering | yes | 5 | FK only PG; caller validates |
| 51 | listLocations | partly | 1 | S2-2 |
| 52 | getLocation | partly | — | |
| 53 | saveLocation | partly | — | |
| 54 | listBlocks | partly | 1 | S2-2 |
| 55 | saveBlock | partly | 5 | FK only PG; caller validates |
| 56 | removeBlock | yes | — | |
| 57 | saveEvent | yes | 5 | S3-6 |
| 58 | getEvent | yes | — | |
| 59 | listEvents | partly | 1 | S2-2 |
| 60 | listEventsForVesselDays | yes | 1, 5 | S3-15 |
| 61 | listActiveVesselDays | yes | 1 | callers re-key |
| 62 | saveReservation | yes | 5 | S3-13 |
| 63 | getReservation | yes | — | |
| 64 | listReservationsForEvent | partly | 1 | **S2-1** |
| 65 | listAllReservations | partly | 1 | S3-7 |
| 66 | bookPendingIfHullFree | yes | 3, 5, 6 | S3-1, S3-2, S3-3, S3-5 |
| 67 | savePendingIfHullFree | yes | 3, 5, 7 | S3-2, S3-3, S3-4 |
| 68 | cancelPendingIfUnpaid | yes | — | S4-4 |
| 69 | cancelBookingAndRelease | yes | — | |
| 70 | getReservationByPaymentIntentId | yes | 1 | S3-8 |
| 71 | recordCheckoutAttempt | yes | — | |
| 72 | claimConfirmationSend | yes | — | |
| 73 | releaseConfirmationSend | yes | — | |
| 74 | acquireRefundLease | yes | 5 | S3-13 |
| 75 | releaseRefundLease | yes | — | |
| 76 | claimRecoverySend | yes | — | |
| 77 | saveGratuity | partly | 5 | S3-9, S3-13 |
| 78 | listGratuitiesForEvent | yes | 1 | callers sum |
| 79 | listGratuitiesForReservation | yes | 1 | S3-10 |
| 80 | listAllGratuities | partly | — | |
| 81 | getPaymentConfig | yes | 2, 7 | S3-11 |
| 82 | setPaymentConfig | yes | 2, 6, 7 | S3-11 |
| 83 | getBookingCutoffHours | yes | 2 | S3-11 |
| 84 | setBookingCutoffHours | yes | 2 | S3-11 |
| 85 | getContactPhone | yes | — | |
| 86 | setContactPhone | yes | — | |
| 87 | savePayment | yes | 5, 7 | S3-12, S3-13 |
| 88 | getPayment | yes | — | |
| 89 | listPaymentsForReservation | partly | 1 | S3-10 |
| 90 | listAllPayments | partly | 1 | caller groups |
| 91 | getPaymentByIntentId | yes | 1 | S3-8 |
| 92 | markPaymentRefunded | yes | 7 | S3-12 |
| 93 | markPaymentDisputed | yes | — | |
| 94 | saveShift | yes | — | k: crewing S2-4, S3-16 |
| 95 | getShift | yes | — | |
| 96 | listShifts | partly | 1 | callers order-independent |
| 97 | removeShift | yes | — | |
| 98 | saveSeat | yes | — | k: crewing S2-4 |
| 99 | getSeat | yes | — | |
| 100 | listSeatsForShift | yes | 1 | k: crewing S3-1 |
| 101 | listAllSeats | no | 1 | S4-1 |
| 102 | saveSeatIfState | yes | 2, 3 | S3-25 |
| 103 | removeSeat | yes | — | |
| 104 | saveAsk | yes | — | k: crewing S3-10 |
| 105 | getAsk | yes | — | |
| 106 | listAsksForSeat | partly | 1 | S3-26 |
| 107 | listAllAsks | no | 1 | S4-1 |
| 108 | removeAsk | yes | — | |
| 109 | saveAdmin | yes | 5 | S3-27 |
| 110 | getAdmin | yes | — | |
| 111 | getAdminByHandle | yes | 5 | S3-27 |
| 112 | listAdmins | partly | 1 | S3-27 |
| 113 | saveLoginCode | yes | 2 | S3-28 |
| 114 | getLoginCode | yes | 2 | S3-28 |
| 115 | consumeLoginCodeIfUnused | yes | — | §2.5 |
| 116 | claimLoginAttempt | yes | 2 | S3-28 |
| 117 | saveCalendarFeed | yes | 5 | S3-27 |
| 118 | getCalendarFeedByTokenHash | yes | — | |
| 119 | getCalendarFeedForCrew | yes | — | |
| 120 | deleteCalendarFeed | yes | — | |
| 121 | touchCalendarFeedPoll | yes | — | |
| 122 | logReliabilityEvent | yes | 5 | k: crewing S4-11 |
| 123 | reliabilityEventsFor | yes | — | |
| 124 | listAllReliabilityEvents | no | — | S4-1 |
| 125 | appendAuditEvent | no | 5 | S3-20, S4-1 |
| 126 | listAuditEvents | no | — | S4-1 |
| 127 | appendTrailEvent | yes | — | |
| 128 | listTrailEvents | yes | — | |
| 129 | listTrailEventsFor | yes | — | |
| 130 | recordSmsConsent | yes | 5 | S3-21 |
| 131 | listSmsConsentsForCrew | yes | — | |
| 132 | recordGuestContact | yes | — | |
| 133 | listGuestContactsForShift | partly | 1 | caller builds Map |
| 134 | isEnginePaused | yes | — | |
| 135 | setEnginePaused | yes | — | |
| 136 | selfClaimRequiresConfirmation | yes | — | |
| 137 | setSelfClaimRequiresConfirmation | yes | — | |
| 138 | saveImportRun | partly | 2, 5 | S3-29 |
| 139 | getImportRun | partly | 1, 2 | S3-29 |
| 140 | listImportRuns | yes | — | |
| 141 | listImportItemsForRef | yes | — | |
| 142 | saveThread | yes | — | |
| 143 | getThread | yes | — | |
| 144 | saveParticipant | yes | — | |
| 145 | listParticipantsForThread | partly | 1 | callers order-insensitive |
| 146 | saveMessage | yes | — | |
| 147 | listMessagesForThread | yes | — | |
| 148 | listThreadsWithMessages | yes | — | collation, §5 |
| 149 | listDmThreadsForCrew | yes | — | |
| 150 | readStateForThread | yes | — | |
| 151 | notifyStateForThread | yes | — | |
| 152 | recordRead | yes | — | §2.5 |
| 153 | recordNotification | yes | — | §2.5 |
| 154 | recordShiftChanges | no | — | S4-1 |
| 155 | listShiftChanges | no | 1 | S3-29, S4-1 |
| 156 | shiftChangeLastSeen | no | — | S4-1 |
| 157 | markShiftChangesSeen | no | — | S4-1 |
| 158 | postWaiverTemplate | yes | 5 | S3-17 |
| 159 | updateWaiverTemplate | yes | — | |
| 160 | getWaiverTemplate | yes | — | |
| 161 | listWaiverTemplates | yes | — | collation, §5 |
| 162 | getCurrentWaiverTemplate | yes | — | collation, §5 |
| 163 | insertTripLink | yes | 5 | S3-17 |
| 164 | getTripLinkByCode | yes | — | |
| 165 | getTripLinkForEvent | yes | — | |
| 166 | saveGuests | yes | 5, 6 | S3-17 |
| 167 | listGuestsForEvent | yes | 1 | callers sort |
| 168 | listGuestsForReservation | yes | 1 | callers sort |
| 169 | setGuestCheckIn | yes | 5 | S3-17 (`checked_in_by`) |
| 170 | checkInGuestIfRoom | partly | — | concurrency PG-only test |
| 171 | setDepartureCount | yes | 2, 5 | S3-18 |
| 172 | getDepartureCount | yes | 2 | S3-18 |
| 173 | listDeparturesCountedAboveCheckedIn | yes | 2 | S3-18 (orphan only) |
| 174 | claimWaiverReminder | yes | 5 | S3-17 |
| 175 | releaseWaiverReminder | yes | — | |
| 176 | listWaiverRemindersForReservation | yes | 1 | S4-6 |
| 177 | getCheckInConfig | yes | — | |
| 178 | setCheckInConfig | yes | 6 | S3-11 |
| 179 | incrementRateLimit | yes | 3 | S3-19 |
| 180 | recordRateLimitRefusal | yes | — | |
| 181 | listRateLimitRefusals | yes | 1 | S4-6 |

Tally: 92 rows with "—", 89 with at least one point. Contract coverage: 12 no, 29 partly, 140 yes.

## 4. Method

The 181 methods were split into six slices, each read side by side across both adapters and the migrations:
1. reservations and conditional writes
2. payments, refunds, leases and settings
3. catalog, customers, booking codes and events
4. crew, punches, shifts, seats and asks
5. auth, logs, imports and messaging
6. check-in, waivers and rate limits

The lead re-read both S2 findings at their cited lines (PG:1504-1510 and IM:650-654 against `shift-card.ts:249-259`; PG:1212-1215 against `book/page.tsx:120,138`). The lead also re-read the one S3 where Postgres is looser on a booking (S3-2a: PG:457-458 against `hull-busy.ts:117`).

## 5. What could not be determined without a running Postgres

1. **The isolation level.** Every booking guard relies on READ COMMITTED taking a fresh snapshot per statement after `pg_advisory_xact_lock` returns (`postgres-repository.ts:1544, 1743, 1822`). Under REPEATABLE READ or SERIALIZABLE, the snapshot would predate the rival's commit and the overlap checks would miss the rival. That would be an **S1 double-book**. The Postgres-only race tests (`postgres-repository.test.ts:667, 743, 793`) catch this only on a database configured like production. Check `SHOW default_transaction_isolation` on production.
2. **The database collation.** No migration sets one. Every text-timestamp comparison and `ORDER BY` in PG runs under it, while IM compares code units or uses `localeCompare`. The two agree on uniform `toISOString()` strings and are unverified for mixed formats. Check `SHOW lc_collate`.
3. **Real row order** for every unordered list (S2-1, S2-2, S3-7, S3-26, crewing S3-1), after updates and vacuum.
4. **Whether production rows today hold the edge data** that S3-2 and S3-3 need: non-`HH:MM` `events.time`, NULL or seconds-format pending `time`, empty-string `holder_token`, or a non-`toISOString` `reserved_at`. This needs a query against production.
5. **Exact error codes and texts:**
   - that a display-code clash names `display_code` (`resolve.ts:78`)
   - that `date_taken` receives the index name (`postgres-repository.ts:2881`)
   - that `integer` columns reject fractional cents (S3-12)
   - FK refusal codes (23503)
6. **Whether the planner evaluates the `::int` casts of S3-3** on rows from other hull-days. If it does, one bad row would throw for every boat.
7. **Lock waits, deadlocks under load and `hashtext` collisions**, including two concurrent `claimRecoverySend` sweeps over overlapping expired rows (`postgres-repository.ts:2016`). That case is suspected to deadlock; its caller catches the error.
8. **The Postgres-only suite itself** (`postgres-repository.test.ts`) did not run: it skipped with no database.
