-- 20260905031117_reservations_pending_slot.sql — reservations-pending-slot
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Phase 14.4 (issue #915). SPEC §2.8.2–2.8.4: the pending row is written BEFORE Stripe and
-- carries everything the customer was quoted, so an operator edit after checkout starts can
-- change nothing about this booking (criterion 20).
--
--   vessel_id / date / time / offering_id  the slot the row names; `event_id` stays null until
--                                          confirm (14.5) materializes the Event
--   reserved_at                            when the row was written. Lapse is COMPUTED from this
--                                          plus the payment-window setting (§2.8.1), never stored
--   holder_token                           the checkout session's cookie token — a retry from the
--                                          same session is not refused by its own earlier row
--   payment_intent_id                      recorded after Stripe answers; confirm finds the row
--                                          by it (issue #916)
--   hold_minutes / trip_minutes            both durations frozen on the row (DEC-161). Hold
--                                          minutes is what the row occupies the hull for; trip
--                                          time is what the Event runs for. Columns, not JSON —
--                                          anything with a time is a column (DEC-164)
--   booking_invoice                        every money component in cents AND its rate, one JSON
--                                          (DEC-164). Money only; no durations, no timestamps
--
-- Additive: nullable columns, no default, touches no row. No foreign keys per DEC-131 (the
-- table has production rows). No CHECK on the text columns, matching the house posture.
--
-- The partial index serves the two hot reads: the hull-day occupancy check under the advisory
-- lock (vessel_id, date) and confirm's lookup by payment_intent_id. Both only ever want
-- pending rows.

alter table reservations
  add column vessel_id         text,
  add column date              text,
  add column time              text,
  add column offering_id       text,
  add column reserved_at       text,     -- ISO-8601 UTC, house style (see checkout_holds.expires_at)
  add column holder_token      text,
  add column payment_intent_id text,
  add column hold_minutes      integer,
  add column trip_minutes      integer,
  add column booking_invoice   jsonb;

create index reservations_pending_hull_day_idx
  on reservations (vessel_id, date)
  where status = 'pending';

create index reservations_payment_intent_idx
  on reservations (payment_intent_id)
  where payment_intent_id is not null;
