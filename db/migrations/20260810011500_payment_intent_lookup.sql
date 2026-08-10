-- 20260810011500_payment_intent_lookup — index the PaymentIntent handle (#616).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- `charge.refunded` (and every other charge-scoped Stripe event that follows it) names the
-- PaymentIntent, never Muster's payment id, so reconciling a refund means looking a row up by
-- `stripe_payment_intent_id`. `payments` had exactly one index — on `reservation_id`
-- (20260715024322_payments.sql:40) — so that lookup was a sequential scan on the webhook hot
-- path, once per refund.
--
-- NOT unique. One PaymentIntent should back one payment row, but the deterministic ids are
-- keyed on the checkout SESSION on the hosted path (`pay_${sessionId}`), and a unique index
-- here would turn any historical or hand-reconciled duplicate into a failed migration on a
-- production table rather than something a human can look at. The uniqueness that matters —
-- one payment row per charge — is already enforced by the deterministic primary key.
--
-- Partial: the column is nullable and null rows are never looked up by it.
create index if not exists payments_stripe_payment_intent_id_idx
  on payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
