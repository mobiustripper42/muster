-- 20260723150000_payment_service_fee_cents — service-fee carve-out on payments (task 12.5, DEC-134).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The DEC-134 service fee (`serviceFeeBps` of the fare, default 3%) is charged IN FULL with
-- the deposit charge and frozen into the PaymentIntent metadata at checkout. Like
-- `gratuity_cents` (DEC-124), it is bundled into the payment's `amount_cents`, so
-- `balanceOwedCents` must net it out of "paid" — this column is that carve-out. Null ⇒ 0
-- (balance payments + pre-12.5 hosted bookings carry no fee). Additive + inert on existing
-- rows; `if not exists` for idempotent re-runs. The rate itself lives in app_settings
-- (`payment.service_fee_bps`, DEC-054 absent⇒default) — no schema for it.

alter table payments add column if not exists service_fee_cents integer;
