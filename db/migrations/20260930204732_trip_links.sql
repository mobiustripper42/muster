-- 20260930204732_trip_links.sql — one link per departure for the waiver page (Phase 18.3b, issue #1141).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The URL the booker shares with the party and the dock QR opens: /w/<code> (DEC-190). The code
-- is 8 characters of the booking-code alphabet. It is public within the party - it exists so
-- strangers cannot find trips by trying event ids - so it is stored as it is, never hashed, and
-- never revoked (operator, 2026-09-29).
--
-- Both uniques are structural and belong here (DEC-131): the primary key stops two trips sharing
-- a code, and the unique event_id stops one trip having two. The minting code retries on either.
create table if not exists trip_links (
  code       text primary key,
  event_id   text not null unique references events (id) on delete restrict,
  created_at text not null  -- ISO-8601 UTC
);
