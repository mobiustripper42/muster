-- 20260906130000_reservations_payment_intent_ids.sql — reservations-payment-intent-ids
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Phase 14.6 (issue #917). SPEC §2.8.5: "A reservation has many payment ids over its life, not
-- one." A declined card followed by a retry, or a tip change, creates a second payment against
-- the SAME reservation, and every id stays recorded so a superseded payment that later succeeds
-- is still findable — "one overwritable column loses the first id and turns a late success into
-- an unrecognisable charge." The single `payment_intent_id` this replaces is exactly that column.
--
-- Confirm still finds the row by any of its ids (`$1 = any(payment_intent_ids)`, GIN-indexed via
-- `@>`). The winning Payment row is keyed on the id that actually succeeded (the charge key), so
-- the ledger stays unambiguous; this array is only the reservation-lookup index.
--
-- No prod pending rows exist (reservations are not live), so the backfill only touches the — all
-- null — `payment_intent_id` on existing Xola rows. Drops a column shipped in 14.4 (14.4 and 14.6
-- ship in the same phase, before this table has a live pending row). No FK (DEC-131).

alter table reservations add column payment_intent_ids text[];

update reservations
  set payment_intent_ids = array[payment_intent_id]
  where payment_intent_id is not null;

drop index reservations_payment_intent_idx;
alter table reservations drop column payment_intent_id;

-- GIN over the array serves the membership lookup `payment_intent_ids @> array[$1]`, the shape
-- `getReservationByPaymentIntentId` uses. Only pending/booked rows ever carry ids; Xola rows are
-- null, so the index stays small.
create index reservations_payment_intent_ids_idx
  on reservations using gin (payment_intent_ids);
