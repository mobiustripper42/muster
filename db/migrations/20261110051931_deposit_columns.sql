-- 20261110051931_deposit_columns.sql — deposit_columns
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Phase 19.1 (issue #1250). SPEC §2.8.4d: a customer may pay a fixed deposit at checkout and have the
-- balance charged to the saved card later. Four columns on the reservation:
--
--   balance_due_at / balance_release_at   when the balance falls due and when an unpaid one releases
--                                         the seats. Frozen with the invoice at checkout (set on the
--                                         pending write, re-frozen by each attempt while pending,
--                                         cleared when an attempt pays in full), so a later settings
--                                         change moves no booking. ISO-8601 UTC text, house style as
--                                         `reserved_at`. Null when there is no balance.
--   stripe_customer_id                    the provider customer the card is saved to. Written once, by
--                                         the first deposit attempt, and kept.
--   stripe_payment_method_id              the card the paid deposit used. Written by the confirm flip
--                                         only.
--
-- Additive: nullable columns, no default, touches no row. No foreign keys per DEC-131 (the table has
-- production rows). `if not exists` for idempotent re-runs.

alter table reservations
  add column if not exists balance_due_at           text,
  add column if not exists balance_release_at       text,
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_payment_method_id text;
