-- 0025_crew_weekdays_off.sql — recurring weekday time-off (#411, DEC-119).
--
-- A per-crew recurring weekday blackout ("never works Sundays"): a bounded set of
-- Mon=0…Sun=6 weekday indices the crew member is permanently off, read by the same
-- eligibility gate that honors PtoWindow (DEC-009). Subtractive, whole-day,
-- vessel-local — NOT positive availability (DEC-009 holds), NOT time-of-day (#333
-- stays parked), NOT date-bounded.
--
-- A standing ATTRIBUTE of the crew member, not a 1:n collection — so it's a column
-- on crew_members, mirroring the `ratings` jsonb array (DEC-119), not a table.
-- jsonb + no CHECK (DEC-DATA-1: vocabularies aren't the DB's) + no FK (DEC-131); the db:crew setter
-- validates the 0–6 range in the service layer.

alter table crew_members
  add column weekdays_off jsonb not null default '[]';
