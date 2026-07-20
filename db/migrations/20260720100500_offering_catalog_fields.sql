-- 20260720100500_offering_catalog_fields — the 12.8 Offering catalog fields (DEC-123/124).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Additive columns for the /admin/offerings editor: customer description, the three
-- duration/config minutes, generic sellable add-ons (REVENUE — taxed + fee'd), and the
-- per-kind gratuity config (CREW MONEY — tax/fee-exempt, keyed by kind, NOT an add-on —
-- DEC-124). Nested shapes are jsonb, money integer cents, no FK/CHECK — house style
-- (DEC-DATA-1). `if not exists` for idempotent re-runs.

alter table offerings add column if not exists description text;
alter table offerings add column if not exists trip_length_minutes integer;
alter table offerings add column if not exists hold_minutes integer;
alter table offerings add column if not exists arrive_before_minutes integer;
alter table offerings add column if not exists add_ons jsonb;          -- AddOn[]
alter table offerings add column if not exists gratuity_kinds jsonb;   -- GratuityKindConfig[]

-- Migrate the flat 12.3 gratuity config (gratuity_tiers_bps / gratuity_default_bps) into a
-- single "pre" kind, preserving each offering's tiers exactly (required at checkout, no
-- decline — DEC-124). Offerings that never set the flat fields stay null and keep riding
-- the code defaults. The old columns are DEPRECATED: left in place, no longer read/written
-- (additive/reversible house style).
update offerings
   set gratuity_kinds = jsonb_build_array(jsonb_build_object(
         'kind', 'pre',
         'tiersBps', coalesce(gratuity_tiers_bps, '[1500,2000,2500]'::jsonb),
         'defaultBps', coalesce(gratuity_default_bps, 2000),
         'required', true))
 where gratuity_kinds is null
   and (gratuity_tiers_bps is not null or gratuity_default_bps is not null);
