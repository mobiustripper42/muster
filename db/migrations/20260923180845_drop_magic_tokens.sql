-- 20260923180845_drop_magic_tokens.sql — drop the magic-link token table (issue #1030).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- `magic_tokens` (0002, DEC-010/DEC-020) held the hash of every one-time sign-in link a crew
-- text carried. Issue #1030 retired that door: every text now carries a plain link with no
-- secret, and the 6-digit code (DEC-081) is the only way to a session. Nothing reads or writes
-- this table any more — the port methods, both adapters, the integrity check and `/crew/auth`
-- went in the same change.
--
-- DROPPED, not deprecated in place, for the same reason `muster_owned_vessel_days` was
-- (20260806230000): every row is a short-lived credential for a door that no longer exists, so
-- there is no history here to preserve. A consumed or expired token records only that a link
-- was once minted.
--
-- No foreign key references it. Reversal, if ever needed: `create table` from 0002.

drop table if exists magic_tokens;
