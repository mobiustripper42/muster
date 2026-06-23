-- 0006_app_settings — a tiny key/value store for operator-set engine controls
-- (#124, DEC-054). Same house style as 0001/0005: text PK, ISO date as `text`,
-- no foreign keys (integrity is the service layer's — DEC-DATA-1).
--
-- First (and only) use: `engine_paused` — the autonomous-tick arm/disarm switch
-- the operator flips from /admin WITHOUT a redeploy. The cron keeps firing every
-- 15 min; a paused engine no-ops in the tick route.
--
-- **Absent row ⇒ engine RUNNING** (DEC-054): an autonomous "no babysitting"
-- engine must never silently stop because the row was cleared by a restore /
-- migration. The go-live "import and look around first" posture is an EXPLICIT
-- paused row, never inferred from absence.
--
-- The port surface stays typed (`isEnginePaused`/`setEnginePaused`); the adapter
-- maps the key and parses `"true"`/`"false"` ↔ boolean, so the domain/edge never
-- touches stringly-typed KV (DEC-013).

create table app_settings (
  key         text primary key,
  value       text not null,
  updated_at  text not null              -- ISO-8601 UTC; when the flag last changed
);
