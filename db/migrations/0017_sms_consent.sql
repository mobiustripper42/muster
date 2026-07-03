-- 0017_sms_consent — the Twilio 10DLC opt-in audit log (BrewBoat campaign vetting).
--
-- One row per opt-in on the PUBLIC crew login page: WHO consented (crew_member_id,
-- resolved from the login email — recorded only on a roster match), at WHAT number
-- (phone snapshot at consent time), WHEN, and the EXACT disclosure text + version
-- they agreed to (so future wording changes stay auditable). This is the durable
-- "we have consent, here's the string and the moment" record 10DLC/TCPA wants.
--
-- Append-only, like reliability_events: never mutated, only grown; a re-opt-in is a
-- NEW row, not an upsert (the full consent history is the point). Adapter/edge-side —
-- only the crew-login action writes it (best-effort), never the domain. House rules:
-- text PK (a random id minted at the write), ISO-8601 dates as `text` (verbatim
-- round-trip, parity with the in-memory double), no foreign keys (integrity is the
-- service layer's — DEC-DATA-1). `seq bigserial` carries insertion order for a stable
-- read (the reliability_events precedent), the one surrogate sequence this table keeps.

create table sms_consent (
  id                  text primary key,   -- random id minted at write
  crew_member_id      text not null,      -- resolved from the login email (roster match)
  email               text not null,      -- the email entered at opt-in
  phone               text,               -- roster phone at consent time; null if none on file
  disclosure_version  text not null,      -- e.g. "v1"
  disclosure_text     text not null,      -- the exact disclosure string shown, frozen
  consented_at        text not null,      -- ISO-8601 UTC
  seq                 bigserial           -- insertion order (stable read; not a natural key)
);
create index sms_consent_crew_idx on sms_consent(crew_member_id);
