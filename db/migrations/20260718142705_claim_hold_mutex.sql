-- 20260718142705_claim_hold_mutex — the DEC-109 claim + 15-min hold (task 12.1a).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Two pieces, both enforcing the DEC-125 slot identity `(vessel, date, time)` for
-- `source='muster'` — the physical fact that there is exactly one of each boat.
--
-- (1) The DEC-125 GUARDRAIL, deferred from 12.0, now enforced: at most one materialized
--     Muster Event per physical boat-slot. This is NOT the DEC-109-forbidden unique on
--     `reservations.event_id` (that's a business policy — one booking per event — and
--     stays out; n:1 remains intact). Different key, opposite purpose. Without it, two
--     first-bookings of the same virtual slot each insert-and-claim their own row → a
--     double-sold boat. `saveBookingIfSlotFree` relies on this to make concurrent
--     first-inserts collide.
--
-- (2) The transient customer CHECKOUT-HOLD (DEC-109) — distinct from the DEC-125
--     admin/vessel-hold *block* (a `blocks` row, kind='vesselHold', no lifetime). This one
--     is soft, 15-min, lazily-expired (no cron — the deriver + acquire filter on
--     `expires_at`), one row per physical slot. House style: text PK, ~~NO FK~~ (added by
--     20260722170000_fk_reservations_era per DEC-131 — the DEC-DATA-1 citation was wrong;
--     it governs logic placement, not constraints),
--     text date/time, integer guest_count, no CHECK on `source`.
--
-- `now()` is NOT immutable, so hold liveness can't live in an index predicate — the
-- acquire path deletes expired rows for the identity first, then inserts; the unique below
-- makes two live acquires collide. All `if not exists` for idempotent re-runs.

-- (1) One materialized Muster Event per physical boat-slot.
create unique index if not exists events_muster_slot_identity
  on events (vessel_id, date, time)
  where source = 'muster';

-- (2) The checkout-hold table + its one-row-per-slot unique.
create table if not exists checkout_holds (
  id                         text primary key,
  vessel_id                  text    not null,
  date                       text    not null,             -- ISO-8601 vessel-local day
  time                       text    not null,             -- departure "HH:MM"
  source                     text    not null default 'muster',
  offering_id                text    not null,
  guest_count                integer not null,
  expires_at                 text    not null,             -- ISO-8601 UTC; acquire + 15 min
  created_at                 text    not null,             -- ISO-8601 UTC of acquire
  stripe_checkout_session_id text
);

create unique index if not exists checkout_holds_slot_identity
  on checkout_holds (vessel_id, date, time)
  where source = 'muster';
