-- 20260924185525_drop_outbox_tables.sql — drop the three operator-outbox tables (issue #935).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- `outbox_entries` (0005, DEC-030), `ring_outbox` (0011, DEC-073) and `notice_outbox` (0015,
-- DEC-084) were the operator's relay worklists: asks, doorbell rings and assignment notices queued
-- for a human to text by hand from `/admin/outbox`. Issue #934 replaced all three with the log
-- channel and deleted the screen; since then nothing has written or read these tables except the
-- integrity check, which goes in the same change as this drop.
--
-- Adapter-side queue state, never domain state (the port said so: "NEVER read by the domain"), so
-- nothing here is reproduced anywhere else and nothing needs it. Production held 0 / 4 / 17 rows
-- (outbox_entries / ring_outbox / notice_outbox), counted by the operator 2026-09-24 — leftover
-- relay cards from before #934, dropped with the tables.
--
-- No foreign key references any of them. Reversal, if ever needed: `create table` from 0005,
-- 0011 and 0015.

drop table if exists outbox_entries;
drop table if exists ring_outbox;
drop table if exists notice_outbox;
