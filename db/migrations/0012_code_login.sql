-- 0012_code_login — crew self-serve sign-in via numeric login codes (DEC-081).
--
-- Same design rules as 0001/0002: text columns, ISO dates as `text` (verbatim
-- round-trip, parity with the in-memory double), no foreign keys (posture: DEC-131; integrity is
-- the service layer's — DEC-DATA-1).
--
-- A SIBLING to magic_tokens, not a reuse: a 6-digit code is NOT globally unique,
-- so it can't ride magic_tokens (whose token_hash is `unique`) and can't be
-- looked up by hash. It's keyed by SUBJECT instead — exactly one live code per
-- subject (the composite PK; re-request upserts) — which is also what lets
-- `attempts` cap brute-force guesses against the short secret. Only sha256(code)
-- is stored. Security rests on the cap + short TTL, not the code's entropy.

create table login_codes (
  subject_kind  text not null,             -- admin | crew (crew-only for now)
  subject_id    text not null,             -- crewMemberId (crew) | operator handle (admin)
  code_hash     text not null,             -- sha256(code) hex; the code is never stored
  created_at    text not null,             -- ISO-8601 UTC
  expires_at    text not null,             -- ISO-8601 UTC; dead past this even if unconsumed
  attempts      integer not null default 0, -- failed verifies; the brute-force ceiling
  consumed_at   text,                      -- ISO-8601 UTC; null until redeemed (single-use CAS)
  primary key (subject_kind, subject_id)   -- one live code per subject
);

-- NOTE (DEC-081): email is the crew login channel, so every crew member who
-- self-serves must have one. We do NOT make `crew_members.email` NOT NULL here:
-- the codebase treats crew-without-email as a supported shape (repository
-- contract + entity `email?`), and a system-wide required-email change is its
-- own task. The login flow is safe regardless — an email-less crew member simply
-- doesn't match (no leak, no false "check your email"). "Everyone has email" is
-- operator data discipline (and a candidate add-crew form constraint), not a DB
-- constraint bolted on in this migration.
