---
id: DEC-132
title: "`Customer` is a contact record keyed by phone — surrogate PK, UNIQUE canonical E.164, readable short code"
topic: "Reservations & payments"
---

## DEC-132: `Customer` is a contact record keyed by phone — surrogate PK, UNIQUE canonical E.164, readable short code

**See also** — later decisions that changed part of this one:
- Corrected by DEC-151 — the `writeBooking` citation only — booking-path customer linking is still in scope and still happens at the write, now on the surviving path

**Decision:** Reservations gain a first-class `Customer` (DEC-123 §3), built under the DEC-131 posture.

**Identity.** A **surrogate `CustomerId` PK** plus a **UNIQUE canonical E.164 phone**. Phone is identity —
same phone means same customer, so "merge duplicate contacts" mostly dissolves — but it is deliberately
**not the primary key**: numbers get changed and recycled by carriers, and a mutable business fact welded
into the key means migrating the row and every reference, with a recycled number inheriting the previous
customer's history. Same instinct as the `Reservation.eventId` guardrail: don't make a business fact
load-bearing structure.

**Phone is REQUIRED, as of now** (operator, 2026-07-22). Whether identity should ultimately be
*phone-or-email* is **deliberately deferred** — it is not a today decision, and the cost of deferring is
bounded on purpose: relaxing is `DROP NOT NULL` (Postgres `UNIQUE` already admits multiple `NULL`s, so the
constraint shape survives), and **all identity resolution is concentrated in one pure module**, so the
policy swap is one file rather than a hunt through call sites. **The Xola importer will force this
decision at cutover** — Xola rows reliably carry email and not always phone (per DEC-040 phone threads
inline as `order.phoneCanonical`; the customers-export join was retired). Recording it here converts a
trap into a scheduled decision.

**Readable code.** Every customer carries a `displayCode` — `C-` + 6 **Crockford base32** characters
(alphabet excludes I/L/O/U, so nothing is ambiguous read aloud), UNIQUE, minted with retry. Deliberately
**not** a sequence: no DB sequence to maintain, dev/preview/prod seeds never collide, and it leaks no
volume. Not a checksum — ceremony at this scale. It is an operator convenience (something short to say on
the phone), **not** a customer-facing account number.

**Linkage.** `Reservation.customerId` is nullable with a **real FK** (`ON DELETE RESTRICT`) — the first
table built under DEC-131. Nullable because historical reservations that never captured a canonical phone
stay unlinked, permanently and acceptably; `NULL` passes the FK.

**Booking-path linking is in scope, not a follow-up.** `writeBooking` **get-or-creates** the customer by
canonical phone, with the UNIQUE constraint arbitrating the concurrent-first-booking race. Without it,
every new booking recreates the unlinked state and the backfill becomes a one-time museum. `/book`
therefore requires phone, validated **server-side** with the standing no-JS re-render error path (the HTML
`required` attribute is courtesy, not the gate).

**Not an account.** No password, no login, no customer-facing auth — a contact record. Soft-delete
(`active`) per the DEC-123 posture; note that soft-delete **retains** PII, so true erasure would be a
scrub-in-place and is explicitly out of scope. Cards-on-file remain **Stripe's** and are not rebuilt.

**Lifetime value** sums **booked (non-cancelled)** reservations at base + frozen `extrasCents`, with
**gratuity excluded** — DEC-124 makes tips crew money, never blended into revenue.

**Deferred with it:** the Purchases/orders list and any human order-number scheme (an order is the money
view of a reservation; one order = one boat = one reservation, so the two are the same row today);
importer-created customers (not needed until cutover); "Edit contact"; and "Message", which is blocked on
**#119** — a customer must never text the crew line, so it needs the second sender number.
