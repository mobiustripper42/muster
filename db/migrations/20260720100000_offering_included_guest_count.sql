-- 20260720100000_offering_included_guest_count — move the base-fare included guest count
-- Vessel → Offering (task 12.8). Timestamp-named per DEC-121. Applied in filename order by
-- db/migrate.ts.
--
-- The included count prices the PRODUCT (the offering's base fare covers up to N guests),
-- not the boat — the capacity cap (`vessels.coi_max_pax`) stays a Vessel fact. NULLABLE +
-- additive: an offering left null reads as "= the running vessel's coi_max_pax" (whole boat
-- included, no per-guest extras), so existing offerings price exactly as before.
--
-- `vessels.included_guest_count` is DEPRECATED: the column stays (additive/reversible house
-- style, DEC-DATA-1), but nothing reads or writes it from this migration on.

alter table offerings add column if not exists included_guest_count integer;
