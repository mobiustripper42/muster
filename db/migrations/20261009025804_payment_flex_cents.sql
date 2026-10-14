-- 20261009025804_payment_flex_cents.sql — cancellation-insurance carve-out on payments (16.8, issue #683).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Cancellation insurance (SPEC §2.8.4a/§2.8.4c) is a flat amount charged IN FULL with the first
-- charge, like the gratuity (DEC-124) and the service fee (DEC-134). It is bundled into the
-- payment's `amount_cents`, so `balanceOwedCents` must net it out of "paid" or a deposit
-- booking's balance comes out short by it — this column is that carve-out. It holds what was
-- actually charged for insurance after any discount, plus the tax on it (insurance is taxed, the
-- fare's tax is what the balance counts), not its list price. Null ⇒ 0 (no insurance,
-- balance payments, every payment before 16.8). Additive + inert on existing rows; `if not exists`
-- for idempotent re-runs.

alter table payments add column if not exists flex_cents integer;
