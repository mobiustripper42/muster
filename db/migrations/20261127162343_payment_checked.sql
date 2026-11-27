-- 20261127162343_payment_checked.sql — payment_checked
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.

--
-- Issue #1236, build 2 of pattern 1 (docs/audit/README.md). The reconciler asks Stripe once about each
-- public checkout that ran out of time with a payment started, and writes here when it has finished
-- with the checkout and will not look at it again: Stripe said nothing was paid, the booking or the
-- sold-out refund went through, or the 2-hour admin text went out.
--
-- Written only by `markPaymentChecked`, and only while the column is null. It is not in
-- `RESERVATION_COLUMNS`, so a whole-row save of a stale copy can neither set nor clear it.
--
-- Additive: one nullable column, no default, no backfill (there are no existing bookings to backfill).
-- `text`, not `timestamptz`: ISO-8601 UTC, house style, same as `reserved_at` (see
-- 20260912115606_confirmation_sent_at.sql for why).
alter table reservations add column if not exists payment_checked_at text;
