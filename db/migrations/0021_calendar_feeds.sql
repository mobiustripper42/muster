-- 0021_calendar_feeds — the crew iCal subscription token (#355, DEC-098).
--
-- Each crew member can mint ONE subscribable calendar-feed URL (Google/Apple
-- Calendar) that serves a live text/calendar feed of their confirmed shifts. The
-- feed URL is Muster's FIRST persistent bearer credential — magic_tokens (DEC-020)
-- and login_codes (DEC-081) are both ephemeral. Held to a higher bar accordingly:
--
--   * HASH-ONLY. Only sha256(token) is stored — never the plaintext, same as
--     magic_tokens. Looked up BY hash of the presented token (`token_hash unique`),
--     not subject-keyed (contrast login_codes: a 6-digit code can't be found by
--     hash). A DB leak exposes no working URLs.
--   * SHOW-ONCE / rotate-to-revoke. The full URL is displayed exactly once at mint;
--     "lost it" == regenerate (this row is replaced, the old hash dies). That single
--     lever is also the revoke + rotate story. One live feed per crew
--     (`crew_member_id unique`).
--   * A READ-ONLY DATA CAPABILITY, not a login — it mints no session, grants only
--     text/calendar read of one person's schedule (DEC-098; does NOT reopen DEC-081).
--
-- House rules (DEC-DATA-1, per 0017/0020): text columns, ISO-8601 dates as `text`
-- (verbatim round-trip, in-memory parity), NO foreign keys (posture: DEC-131; the service layer
-- guarantees the crew member exists at mint). Edge/adapter-written, never the domain.

create table calendar_feeds (
  crew_member_id   text primary key,        -- one live feed per crew (rotate = replace)
  token_hash       text not null unique,    -- sha256(token) hex; route looks up by this
  created_at       text not null,           -- ISO-8601 UTC of the mint
  last_polled_at   text                     -- ISO-8601 UTC of the last feed fetch (nullable; "last synced" signal)
);
