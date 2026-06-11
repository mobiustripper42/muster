-- DEC-029: the comparand for the builder's "changed since you reviewed it" nudge.
-- Nullable: absent = predates tracking → older than any shift.locked_at → never
-- nudges. Stamped by the import on create + material change only (no backfill).
alter table reservations add column updated_at text;
