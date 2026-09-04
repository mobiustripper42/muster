-- 20260904220345_reservations_pending_nullable_event.sql — reservations-pending-nullable-event
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Phase 14.2 (issue #913). SPEC §2.8.2: a pending reservation names a slot, not an Event, and
-- its `event_id` must be null until it confirms. The Event is materialized from the offering
-- schedule at confirm time, so before that there is nothing for the column to point at.
--
-- Additive: drops the NOT NULL, touches no row. Every existing row keeps its event_id; only a
-- `pending` row (first written by 14.4) is ever null. `status` stays unconstrained text — the
-- union `pending | booked | cancelled` lives in `src/domain/entities.ts`, matching the house
-- posture of no CHECK on text enums (see 20260718045012).
--
-- No foreign key is added. DEC-131 ratified the FK-less original tables as-built; `reservations`
-- has production rows, so a constraint here is the data-migration problem that
-- 20260722170000_fk_reservations_era.sql warned about, not a one-line add.

alter table reservations alter column event_id drop not null;
