-- 20261003185242_waiver_reminders.sql — the reminders' send record (Phase 18.7, issue #1121)
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Spec: docs/design/check-in-and-waivers.md §5. The booker is reminded on each of the admin's
-- reminder days until the party has signed, and NEVER TWICE FOR ONE WINDOW. A window is one booking,
-- one trip date, one day count; the primary key is that rule.
--
-- CLAIMED BEFORE THE SEND, GIVEN BACK WHEN NOBODY WAS TOLD — confirmation_sent_at's pattern (15.3).
-- An insert that conflicts is a window someone else has, and the caller does not send. A send that
-- reached nobody deletes its row, so a later tick that day tries again. A row here therefore means
-- the booker was told, and the reservation trail reads its `waiver_reminder_sent` entries from it.
--
-- trip_date is in the key so a booking moved to another date gets that date's reminders.
--
-- Foreign key ON DELETE RESTRICT, as every new table here takes them (DEC-131). Reminders go only
-- to booked reservations, which the pending-row reaper never deletes.
create table waiver_reminders (
  reservation_id  text not null references reservations (id) on delete restrict,
  trip_date       text not null,                                   -- vessel-local YYYY-MM-DD
  days_before     integer not null,
  sent_at         text not null,                                   -- ISO-8601 UTC, at the claim
  primary key (reservation_id, trip_date, days_before)
);
