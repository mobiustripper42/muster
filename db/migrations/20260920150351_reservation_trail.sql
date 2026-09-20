-- 20260920150351_reservation_trail.sql — what happened to a booking, and who did it
-- (issue #1047, tracked by issue #1053).
--
-- The crew engine's equivalent is `audit_events` (0024, #400, DEC-118). Same column
-- conventions — bigserial seq, deterministic text id, ISO-text timestamp, jsonb
-- metadata — and a different key, for reasons below.
--
-- ## TWO keys, both nullable, and NEITHER is a foreign key
--
-- DEC-131 is the authority for constraint choices here and its default is the opposite
-- of this: "New tables take real constraints." This table is an exception and this is
-- the reason, written down because DEC-131 exists precisely because nineteen migration
-- headers once asserted a constraint posture with no reason attached.
--
-- **It is not about cascade semantics.** Every FK in this schema is `on delete restrict`
-- (20260722170000_fk_reservations_era.sql) because nothing in this app hard-deletes, and
-- a restrict FK would already give an audit row the "outlives its subject" property.
--
-- It is about the one thing that WILL hard-delete. SPEC §2.8.8's reaper deletes lapsed
-- `pending` rows; nothing reaps them today (src/reservations/abandonment.ts), but the
-- trail is exactly what makes deleting one safe to do. A restrict FK would block that
-- reaper; a cascade would destroy the record that justified it. So the reference is
-- allowed to dangle, deliberately, and the contract suite pins that both adapters accept
-- a row naming a reservation that was never written.
--
-- `payments.reservation_id` stays `not null` with an FK and that is not an
-- inconsistency: `payments` is a ledger of money AGAINST a booking, so a payment with no
-- booking is the issue #613 defect. This is a log of things that happened, and some of
-- them happened to no booking at all — a charge Muster never recorded, a slot the
-- operator held and released. Those rows carry `payment_intent_id`, or neither key.
--
-- ## No slot columns
--
-- Issue #886 proposed keying on hull + date + time. It is not unique — several offerings
-- sell the same boat-hour — and every genuinely reservation-less fact carries a Stripe
-- reference rather than a hull. `slot_held` / `slot_released` put the slot in `metadata`.
--
-- ## Append-only, and idempotent on id
--
-- `on conflict (id) do nothing` in the adapter, not an upsert. The emitters sit on
-- at-least-once delivery paths (Stripe redelivers), so a duplicate is expected; the
-- FIRST write is the one that happened. A trail that can be rewritten is not a trail.
--
-- No backfill. The operator surface states the date the trail begins and shows nothing
-- before it — same posture the crew trail shipped with, for the same reason.

create table reservation_trail (
  seq               bigserial,
  id                text primary key,
  reservation_id    text,                      -- nullable, NO fk — see above
  payment_intent_id text,                      -- nullable; money with no booking
  actor_kind        text not null,             -- customer | admin | stripe | engine
  actor_id          text,                      -- null for engine / anonymous customer
  type              text not null,             -- src/domain/reservation-trail.ts
  timestamp         text not null,             -- ISO-8601 UTC
  metadata          jsonb not null default '{}'
);

-- The read axes issue #1048's union and issue #1049's surface need. `timestamp desc`
-- matches the adapter's ordering contract, so the full list read is index-ordered.
create index reservation_trail_time_idx on reservation_trail(timestamp desc);
create index reservation_trail_res_time_idx on reservation_trail(reservation_id, timestamp desc);
create index reservation_trail_pi_time_idx on reservation_trail(payment_intent_id, timestamp desc);
create index reservation_trail_type_time_idx on reservation_trail(type, timestamp desc);
