-- 0018_admins — admin becomes a first-class auth identity (DEC-092, revises DEC-020).
--
-- Before this, an admin `subject_id` was a free-form operator handle — a non-identity,
-- so the only way to revoke admin access was rotating the shared SESSION_SECRET, which
-- logs EVERYONE out. With a second admin that's untenable. This table makes each admin
-- a real, individually-revocable identity.
--
-- Every admin is ALSO crew, so `id` IS that person's crew id (a `{kind:"admin", id:<crewId>}`
-- session vs their `{kind:"crew", id:<crewId>}` session — `kind` disambiguates). `handle`
-- is the short mint key (`db:mint --admin=<handle>`). `active=false` is the per-person
-- revoke: `readSubject` fails an admin whose row is missing or inactive on its next
-- request (immediate, admins-only — the stateless crew hot path is untouched).
--
-- House rules: text PK, ISO-8601 dates as `text`, no foreign keys (posture: DEC-131; the `id`↔crew link is
-- semantic, not enforced — integrity is the service layer's, DEC-DATA-1). NO `role` column
-- — all admins are equal at launch; roles are deferred (the column is the clean seam).
--
-- Seeds the three launch admins. Idempotent on re-run (on-conflict-do-nothing) so a
-- hand-applied prod run that partially landed can be re-run safely.

create table admins (
  id              text primary key,        -- = the crew id of the crew member who is admin
  handle          text unique not null,    -- short mint key (e.g. "eric")
  name            text not null,
  active          boolean not null default true,
  created_at      text not null,           -- ISO-8601 UTC
  deactivated_at  text                     -- ISO-8601 UTC; null while active
);

insert into admins (id, handle, name, active, created_at) values
  ('crew-eric-stoffer',     'eric',    'Eric Stoffer',     true, '2026-07-06T00:00:00Z'),
  ('crew-brendan-mcgovern', 'brendan', 'Brendan McGovern', true, '2026-07-06T00:00:00Z'),
  ('crew-drew-johnson',     'drew',    'Drew Johnson',     true, '2026-07-06T00:00:00Z')
on conflict (id) do nothing;
