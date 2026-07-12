-- 0023_reservations_source_partition — the DEC-106 coexistence partition primitives
-- + the DEC-112 per-event price column. One coherent, additive, INERT unit that
-- lands on `main` ahead of the flagged feature branch (DEC-111): every change here
-- is a no-op on read until an operator marks a vessel-day Muster-owned.
--
-- 1. `source` discriminator on events + reservations (DEC-106). Text, NOT a
--    CHECK/enum: a CHECK exists in Postgres but not the in-memory double and would
--    break the adapter-equivalence the contract suite proves — validation is the
--    service layer's (DEC-DATA-1). Backfills every existing row to 'xola' via the
--    column default (one atomic DDL, no separate UPDATE). The default stays
--    permanently — the importer structurally only writes 'xola'; the Muster write
--    path sets 'muster' explicitly. NB: distinct from `import_runs.source`
--    (manual-pull | cron, 0007) — different table, different meaning.
--
-- 2. `price` on events (DEC-112) — per-event price, integer CENTS (Stripe-aligned,
--    float-safe), NULLABLE and source-agnostic: 'xola' events leave it null (their
--    money lives in Xola, DEC-105); the Muster booking path sets it. No default.
--    P11 resolution order is Event.price only — the Offering/schedule default
--    cascade is P12. Cents so it maps 1:1 to Stripe amounts at 11.2.
--
-- 3. `muster_owned_vessel_days` — the whole-vessel-day ownership set (DEC-106 grain:
--    vessel_id + date, NOT time). No FK, text date — house style (DEC-DATA-1).
--    Empty on `main` ⇒ the importer guard never fires ⇒ zero behavior change.
--    Marked via the `db:own` CLI (no admin UI — Phase 11 UI is throwaway).
--
-- All `if [not] exists` for idempotent re-runs. Numbered 0023 (after 0022).

alter table events       add column if not exists source text not null default 'xola';
alter table reservations add column if not exists source text not null default 'xola';

alter table events add column if not exists price integer;   -- per-event price, cents; null = no Muster price (DEC-112)

create table if not exists muster_owned_vessel_days (
  vessel_id  text not null,
  date       text not null,               -- ISO-8601 vessel-local day (DEC-106 grain)
  marked_at  text not null,               -- ISO-8601 UTC of the mark
  primary key (vessel_id, date)
);
