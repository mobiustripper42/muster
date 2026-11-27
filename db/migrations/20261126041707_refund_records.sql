-- 20261126041707_refund_records.sql — refund_records
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Issue #1278, build 1a of pattern 1 (docs/audit/README.md). Every refund Muster sends is written
-- down BEFORE Stripe is asked, sent under a key taken from that record, and marked finished only
-- once its result is written. A job asks Stripe about any record left unfinished and finishes it.
--
--   refund_records   one row per refund Muster sends. `state` is unfinished until its result is
--                    written, then whole (everything asked for moved) or short (less moved).
--                    `claimed_at` starts equal to `created_at` and is reset by a takeover, which is
--                    the shape of `balance_charge_attempts` (DEC-202). `alerts_claimed` holds the
--                    kinds of admin alert already claimed on the record, so each goes out once.
--   refund_legs      which PaymentIntent gives back how many cents. Saved before the first call, so a
--                    re-send uses them and never plans a new split. `position` keeps the order.
--
-- THE RECORD IS THE LOCK. The partial unique index allows one unfinished record per booking, with the
-- sold-out reason excepted (its charge never became a booking). It replaces the refund lease
-- (20260814170248), which is dropped: a second press finds the first press's record instead of a lease
-- that expires after sixty seconds.
--
-- DATA-CHANGING: drops refund_leases. Nothing reads a lease that old, and there is no backfill — a
-- refund made before this migration has no record (standing rule, operator, 2026-11-12).
--
-- Foreign keys ON DELETE RESTRICT, as every new table here takes them (DEC-131). `if not exists` for
-- idempotent re-runs.

create table if not exists refund_records (
  id                       text primary key,
  reservation_id           text not null references reservations (id) on delete restrict,
  reason                   text not null,                       -- customer_cancel | operator_cancel | operator_refund | sold_out
  actor_kind               text not null,                       -- customer | admin | engine
  actor_id                 text,
  asked_cents              integer not null,
  quoted_cents             integer,                             -- the terms' figure on an operator cancel
  expected_refunded_cents  integer,                             -- the refunded-so-far token
  moved_cents              integer not null default 0,
  state                    text not null default 'unfinished',  -- unfinished | whole | short
  short_reason             text,
  created_at               text not null,                       -- ISO-8601 UTC
  claimed_at               text not null,                       -- ISO-8601 UTC; equal to created_at at insert
  finished_at              text,
  notice_claimed_at        text,
  notice_sent_at           text,
  alerts_claimed           text[] not null default '{}'
);

create unique index if not exists refund_records_one_unfinished_per_booking
  on refund_records (reservation_id)
  where state = 'unfinished' and reason <> 'sold_out';

create index if not exists refund_records_unfinished
  on refund_records (created_at)
  where state = 'unfinished';

create index if not exists refund_records_reservation
  on refund_records (reservation_id, created_at);

create table if not exists refund_legs (
  record_id            text not null references refund_records (id) on delete restrict,
  payment_intent_id    text not null,
  position             integer not null,
  payment_id           text,                                     -- absent on a sold-out leg, so not a foreign key
  cents                integer not null,
  refunded_total_cents integer,                                  -- the payment's refunded total after this leg
  refund_id            text,
  outcome              text,                                     -- moved | refused | failed_later
  failed_at            text,
  primary key (record_id, payment_intent_id)
);

drop table if exists refund_leases;
