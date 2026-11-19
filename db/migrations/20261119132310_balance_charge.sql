-- 20261119132310_balance_charge.sql — balance_charge
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Phase 19.6 (issue #1254). SPEC §2.8.4d: a deposit booking's balance is charged to the card saved at
-- booking, on its frozen due date, and retried on the days after it. Two things to store:
--
--   reservations.balance_payment_intent_id   the booking's ONE balance PaymentIntent. Created at the
--                                            first scheduled attempt or the first `Pay balance` press
--                                            and used by every attempt after, so Stripe itself refuses
--                                            a second successful charge. Written only by
--                                            `saveBalancePaymentIntentId` (it is not in
--                                            RESERVATION_COLUMNS, so no whole-row save can set or
--                                            clear it), which also appends the id to payment_intent_ids.
--
--   balance_charge_attempts                  one row per attempt, claimed BEFORE the charge — the
--                                            waiver reminders' pattern (20261003185242). An attempt is
--                                            its position in the attempt times: 0 the due date, 1 the
--                                            first retry, and so on. The primary key is the rule that
--                                            an attempt is made once: of two ticks inserting the same
--                                            attempt, one gets the row and the other must not charge.
--                                            A charge that threw deletes its row so the next tick
--                                            re-sends it under the same idempotency key. `outcome` is
--                                            `succeeded | declined | needs_approval`, null while the
--                                            charge is in flight; `decline_code` is the provider's.
--
-- Additive: one nullable column and one new table. Foreign key ON DELETE RESTRICT, as every new table
-- here takes them (DEC-131). `if not exists` for idempotent re-runs.

alter table reservations
  add column if not exists balance_payment_intent_id text;

create table if not exists balance_charge_attempts (
  reservation_id  text not null references reservations (id) on delete restrict,
  attempt         integer not null,
  attempted_at    text not null,                                   -- ISO-8601 UTC, at the claim
  outcome         text,
  decline_code    text,
  primary key (reservation_id, attempt)
);
