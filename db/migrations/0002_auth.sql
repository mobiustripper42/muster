-- 0002_auth — self-rolled magic-link tokens (DEC-010, DEC-020).
--
-- Same design rules as 0001: text PK (deterministic id from the core), ISO date
-- fields as `text` (verbatim round-trip, parity with the in-memory double), no
-- foreign keys (integrity is the service layer's — DEC-DATA-1; subject_id points
-- at a crew member for crew links, an operator handle for admin links, and the
-- integrity diagnostic checks the crew case).
--
-- Only the *hash* of the link secret is stored (token_hash) — a DB leak yields no
-- usable links. `unique` on token_hash gives verify its lookup index and rejects
-- a hash collision. consumed_at NULL = still redeemable; the single-use CAS sets
-- it exactly once via `where token_hash=$1 and consumed_at is null`.

create table magic_tokens (
  id            text primary key,
  token_hash    text not null unique,      -- sha256(secret) hex
  subject_kind  text not null,             -- admin | crew
  subject_id    text not null,             -- crewMemberId (crew) | operator handle (admin)
  created_at    text not null,             -- ISO-8601 UTC
  expires_at    text not null,             -- ISO-8601 UTC
  consumed_at   text                       -- ISO-8601 UTC; null until redeemed
);
