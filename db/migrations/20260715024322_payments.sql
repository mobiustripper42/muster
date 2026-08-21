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
-- ⚠️ SUPERSEDED (DEC-131): the no-FK claim below was both miscited (DEC-DATA-1 governs
-- logic placement, never foreign keys) and is now FACTUALLY STALE — this table's tables
-- had not reached production, so 20260722170000_fk_reservations_era.sql added REAL
-- foreign keys to them while they were still empty in prod. Read that migration for the
-- current constraint state.
-- House style: text PK, ~~NO foreign key to reservations~~ (added later, see above), integer cents (never
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
  -- succeeded | refunded | partially_refunded | disputed | dispute_lost   (issue #723)
  -- No CHECK constraint, deliberately (DEC-131) — integrity is the service layer's. The only
  -- guard on this column is `countsAsPaid` in payment-config.ts, and it is an ALLOW-list: a
  -- value it has not been taught is not money. Widen that set, not just this comment.
  status                    text not null,
  refunded_cents            integer,
  created_at                text not null
);

-- The reservation's payment log is read per-booking on the manage/confirmation surfaces.
create index if not exists payments_reservation_id_idx on payments (reservation_id);
