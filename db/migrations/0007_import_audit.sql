-- 0007_import_audit — durable per-run audit of every Xola import (#128, DEC-056).
--
-- Before this, an import reported counts in redirect params and wrote its rich
-- join diagnostics (unmapped boats, window-truncated rows, per-day assignments,
-- stranded seats) only to Vercel logs — so an unattended overnight CRON pull left
-- no reviewable trace. These two tables snapshot the whole envelope per run.
--
-- House style (0001/0005): text PK, ISO dates as `text`, NO foreign keys
-- (integrity is the service layer's — DEC-DATA-1); nested/diagnostic data as
-- `jsonb`. Adapter-side, like the outbox (DEC-030): written by the import edge,
-- read by the audit view, never by the domain. ADDITIVE — no existing table changes.

create table import_runs (
  id            text primary key,      -- run-<uuid>, minted at the edge
  source        text not null,         -- manual-pull | cron
  ran_at        text not null,         -- ISO-8601 UTC
  window_start  text not null,         -- the pulled [start,end] window (API)
  window_end    text not null,
  summary       jsonb not null         -- counts + join diagnostics envelope (ImportRunSummary)
);
create index import_runs_ran_at_idx on import_runs(ran_at);

create table import_run_items (
  id      text primary key,            -- <run_id>-item-NNNN (zero-padded → lexical = insertion order)
  run_id  text not null,               -- → import_runs.id (no FK — DEC-DATA-1)
  kind    text not null,               -- reservation_added|_updated|_cancelled | shift_created|_cancelled
  ref_id  text not null,               -- reservation id or shift id
  label   text                         -- customer name (reservations); null for shifts
);
create index import_run_items_run_id_idx on import_run_items(run_id);
