-- 0020_guest_contacts — the per-guest "we texted them" record (#345 Part B).
--
-- When someone taps a guest's Text button on the manifest, the tap is recorded so
-- EVERY crew member on the shift (and the operator) can see who's been contacted and
-- who hasn't — no double-texting, nobody missed. UPSERT-latest by design (operator's
-- call): one row per booking = "who last texted this guest, and when". A re-text
-- overwrites. Contrast sms_consent / reliability_events (append-only) — here the
-- CURRENT state is the point, not the history.
--
-- Denormalized `contacted_by_name` snapshot so the manifest read needs no join to the
-- crew/admin tables (no-FK, read-simple — DEC-DATA-1). Best-effort edge write (the
-- /api/guest-contact route), never the domain. House rules: text keys, ISO-8601 dates
-- as text (verbatim round-trip, in-memory parity), no foreign keys.

create table guest_contacts (
  reservation_id      text primary key,   -- one latest-contact per booking (upsert)
  shift_id            text not null,      -- the shift being staffed (per-shift read)
  contacted_by        text not null,      -- subject id (crew or admin) who tapped
  contacted_by_name   text not null,      -- name snapshot at contact time (for display)
  contacted_at        text not null       -- ISO-8601 UTC
);
create index guest_contacts_shift_idx on guest_contacts(shift_id);
