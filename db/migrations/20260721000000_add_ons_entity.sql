-- 20260721000000_add_ons_entity — AddOn becomes a first-class entity (#491).
-- Timestamp-named per DEC-121; ordered AFTER 20260720100500 (the inline-add-on columns it
-- retires). Applied in filename order by db/migrate.ts.
--
-- #491 lifts add-ons out of the inline `offerings.add_ons` jsonb array (shipped in 12.8) into
-- their own table — a twin to `vessels`/`locations` — that offerings ATTACH by id. `required`
-- is a GLOBAL property of the add-on; `active` is the soft-retire flag (DEC-123 posture).
--
-- House style: text PK, no foreign keys (add_ons has no FK-able column — `tenant_id` has no
-- `tenants` table to point at; posture per DEC-131, not DEC-DATA-1), NO CHECK on the `type`
-- discriminator —
-- validation is the service layer's (src/admin/add-on-admin.ts), keeping the pg + in-memory
-- adapters behaviorally identical under the contract suite. Money is integer CENTS (DEC-112).
-- `if not exists` for idempotent re-runs.
create table if not exists add_ons (
  id           text primary key,
  tenant_id    text,
  label        text,
  type         text,        -- "flat" only for now; a value, not a migration (DEC-DATA-1)
  amount_cents integer,     -- cents (DEC-112)
  required     boolean,     -- GLOBAL — a property of the add-on, not the offering attachment
  active       boolean      -- false ⇒ out of the offering picker + browse, refs kept
);

-- Offerings attach add-ons by id — mirrors `vessel_ids` (AddOnId[] as jsonb). Additive + inert.
alter table offerings add column if not exists add_on_ids jsonb;

-- DEPRECATE the inline `offerings.add_ons` column IN PLACE (additive/reversible house style,
-- as 20260720100500 did for the flat gratuity columns): no longer read or written by the
-- adapter, left in place — NO drop, NO data migration (the column is empty in practice).
comment on column offerings.add_ons is
  'DEPRECATED #491 — inline add-ons replaced by first-class add_ons + offerings.add_on_ids; no longer read/written.';
