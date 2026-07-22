-- 20260718193213_vessel_included_guest_count — base-fare included guest count (task 12.2).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- DEC-112 pricing composition: the whole-boat base fare covers up to N guests; each guest
-- above N adds Offering.extra_guest_price_cents, to coi_max_pax. NULLABLE + additive + inert:
-- an existing vessel leaves it null, which the service layer reads as "= coi_max_pax" (whole
-- boat included, no per-guest extras) — so a pre-composition vessel prices exactly as before
-- until an operator sets it (the 12.9 vessel admin). No CHECK (DEC-DATA-1); no FK-able column
-- here anyway — posture per DEC-131.

alter table vessels add column if not exists included_guest_count integer;
