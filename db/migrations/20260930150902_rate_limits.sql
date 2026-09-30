-- 20260930150902_rate_limits.sql — the app's first general rate limiter (Phase 18.3a, issue #1117).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- A FIXED-WINDOW COUNTER (DEC-189): one row per bucket, key and window, bumped by one atomic
-- upsert per request. The limit comparison is code's (DEC-131) - this table only counts. It is
-- the recovery throttle's shape (20260815125833) generalized: a primary key arbitrates, and
-- expired rows are swept on the way in, so a key that never returns cannot grow the table.
--
-- `key` is a client address as the edge resolved it (app/lib/client-ip.ts), IPv6 cut to its /64.
-- Nothing here references another table: a key belongs to nobody in the schema.
create table if not exists rate_limit_hits (
  bucket       text    not null,  -- which limit, e.g. 'crew-sign-in'
  key          text    not null,  -- the client address it counts
  window_start text    not null,  -- ISO-8601 UTC
  expires_at   text    not null,  -- ISO-8601 UTC, window_start + the window length
  hits         integer not null,
  primary key (bucket, key, window_start)
);
create index if not exists rate_limit_hits_expires_at on rate_limit_hits (expires_at);

-- THE REFUSAL LOG (operator, 2026-09-30): "to know if we are being targeted, or people are
-- getting booted when they shouldn't". One row per bucket, key and window in which anything
-- was refused - never one per request, so a flood writes one row per attacking address per
-- window. Kept 90 days (expires_at), swept on the way in. Read by SQL for now.
create table if not exists rate_limit_refusals (
  bucket           text    not null,
  key              text    not null,
  window_start     text    not null,  -- ISO-8601 UTC
  hits             integer not null,  -- requests counted in the window, as of the last refusal
  refused          integer not null,  -- of those, how many were refused
  first_refused_at text    not null,  -- ISO-8601 UTC
  last_refused_at  text    not null,  -- ISO-8601 UTC
  expires_at       text    not null,  -- ISO-8601 UTC, when this row may be swept
  primary key (bucket, key, window_start)
);
create index if not exists rate_limit_refusals_expires_at on rate_limit_refusals (expires_at);
