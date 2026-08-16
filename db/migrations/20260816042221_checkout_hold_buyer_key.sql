-- 20260816042221_checkout_hold_buyer_key — one buyer, one hold per departure (#575).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- THE DEFECT. `acquireDepartureHold` took the first free fitting boat and had no idea who was
-- asking. A declined card — an ordinary event, not an edge case — meant: submit 1 holds the small
-- boat, submit 2 finds it held and takes the big one, submit 3 reports SOLD OUT. A two-boat
-- departure with zero paying customers, unbuyable by anyone, for fifteen minutes.
--
-- The mechanism whose only job is protecting the customer experience (a hold is what turns
-- "you paid and we refunded you" into "sold out, before you paid") was destroying it, on the
-- commonest failure a checkout has.
--
-- THE FIX IS A COLUMN, not a constraint. `buyer_key` is the canonicalized contact — lowercased
-- email, else E.164 phone, through the same `canonicalizePhone` the booking form and the #460
-- recovery use, so "(216) 555-0148" and "+12165550148" are one buyer rather than two. Acquire
-- looks for this buyer's live hold on this departure first and returns it instead of minting.
--
-- NULLABLE, and that is deliberate. `email` and `phone` are both optional on the payment-intent
-- request. A hold with no buyer key gets today's behaviour — mint a fresh one — and MUST NEVER
-- match another keyless hold: two anonymous buyers sharing a hold is the one way this change
-- could sell one boat twice, so the reuse lookup requires a non-null key on both sides. (SQL's
-- `null != null` gives that for free; the in-memory double has to spell it out.)
--
-- No UNIQUE index on (buyer_key, offering, date, time). The reuse rule is a service-layer
-- judgement — it re-validates that the held boat still fits a changed guest count, and releases
-- rather than reuses when it doesn't — and DEC-131 keeps business rules out of the schema. What
-- the database owns here is the column and the lookup index.
alter table checkout_holds add column if not exists buyer_key text;

-- The acquire path's new first question: does this buyer already hold this departure? Indexed
-- with the slot identity because that is exactly how it is asked.
create index if not exists checkout_holds_buyer_slot_idx
  on checkout_holds (buyer_key, offering_id, date, time)
  where buyer_key is not null;
