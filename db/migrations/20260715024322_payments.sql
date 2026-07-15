-- payments — money movements against Muster-native reservations (DEC-107).
-- Timestamp-named (not 00NN) so the long-lived feature/reservations branch can't collide
-- with main's sequential migrations (main's 0024/0025 are audit_events #400 +
-- crew_weekdays_off #427). Timestamped files sort after every 00NN_.
--
-- A separate 1:n log, NOT columns on `reservations` (which is shared with Xola, whose
-- money lives in Xola permanently — DEC-105/106; payment columns would sit null on every
-- imported row and muddy the source discriminator). One row per Stripe charge: a `full`
-- payment, or a `deposit` then a `balance`. Modeled like every other Muster side-effect
-- log (reliability_events, outbox, import_run_items).
--
-- House style (DEC-DATA-1): text PK, NO foreign key to reservations, integer cents (never
-- float — DEC-112), ISO-8601 UTC text timestamps. `method` is a text discriminator
-- ('stripe' only for now; 'cash'/'venmo' widen later with no schema change — the stripe_*
-- columns just stay null). No CHECK on the vocabularies (adapter-equivalence, DEC-DATA-1).
-- The `id` is deterministic from the Stripe session id, so the write is an idempotent
-- upsert (a re-delivered webhook can't double-insert).

create table if not exists payments (
  id                        text primary key,
  reservation_id            text not null,
  method                    text not null default 'stripe',
  kind                      text not null,               -- full | deposit | balance
  amount_cents              integer not null,
  tax_cents                 integer not null default 0,
  currency                  text not null default 'usd',
  stripe_checkout_session_id text,
  stripe_payment_intent_id  text,
  status                    text not null,               -- succeeded | refunded | partially_refunded
  refunded_cents            integer,
  created_at                text not null
);

-- The reservation's payment log is read per-booking on the manage/confirmation surfaces.
create index if not exists payments_reservation_id_idx on payments (reservation_id);
