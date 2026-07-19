-- 20260719210749_vessel_admin_fields — Vessel admin config fields (task 12.9).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The Vessel admin (12.9) lets the operator set the boat's own facts beyond capacity:
--   hue              — DEC-086 palette index (1-6); which --color-vessel-N the boat renders
--                      in on the shift board + reservation calendar. Color is information
--                      (DEC-021/042). NULL ⇒ the derived hue stands (pinned map, then id-hash),
--                      so nothing recolours until an operator picks one.
--   home_location_id — default launch Location (a reference by id; no FK, house style).
--   notes            — internal operator notes, never customer-facing.
--
-- All NULLABLE + additive + inert on existing rows (DEC-DATA-1). No backfill — an un-set
-- vessel keeps its current derived colour. No FK/CHECK.

alter table vessels add column if not exists hue integer;
alter table vessels add column if not exists home_location_id text;
alter table vessels add column if not exists notes text;
