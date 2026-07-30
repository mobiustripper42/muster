-- 20260730031500_event_duration_minutes — per-event trip length (#570).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The shift-end derivation (`shiftEndFromEvents`, DEC-041) assumed every trip runs
-- `TRIP_DURATION_MINUTES` (100) because nothing in the model carried a length. It does now:
-- `Offering.tripLengthMinutes` is operator-set per experience, and the Muster booking path
-- has the offering in hand when it materializes the slot's event.
--
-- FROZEN AT MATERIALIZATION, not resolved from the offering on read — the same posture as
-- `events.price` and `reservations.extras_cents` (DEC-125 / #474): a later edit to the
-- offering must not retroactively change how long a trip that already ran was. It is also
-- what makes a post-booking extra-time upsell expressible — that writes THIS column, and the
-- shift end (and so the completion sweep, and so crew reliability + tip eligibility) follows.
--
-- Null ⇒ fall back to the flat `TRIP_DURATION_MINUTES`. Xola-sourced events keep it null and
-- always will: Xola exposes no product length (DEC-041's original (a) source never landed).
-- Additive + inert on existing rows; `if not exists` for idempotent re-runs.

alter table events add column if not exists duration_minutes integer;
