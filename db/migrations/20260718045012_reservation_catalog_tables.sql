-- 20260718045012_reservation_catalog_tables — the DEC-123/125 reservation catalog.
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- The read-side foundation for the virtual-availability model (task 12.0). ADDITIVE +
-- INERT: three empty tables the deriver reads (`deriveVirtualAvailability`). Nothing
-- WRITES them yet — writes + admin UI land with each entity's own task (offerings 12.8,
-- locations 12.9, blocks 12.10), which will ALTER ... ADD COLUMN for their inert
-- display/config fields (photos, add-ons, gratuity config …) without redefining these.
-- Empty ⇒ zero behavior change, exactly like `muster_owned_vessel_days` (0023) landed.
--
-- House style (DEC-DATA-1): text PKs, NO foreign keys, NO CHECK on the text
-- discriminators (`status`, `kind`) — validation is the service layer's, so the pg and
-- in-memory adapters stay behaviorally identical under the contract suite. Nested/array
-- fields are `jsonb` (node-pg serializes on write, parses on read), matching vessels.manning
-- and shifts.event_ids. Money is integer CENTS (DEC-112), never float. `if not exists`
-- for idempotent re-runs.

-- Offering (= Xola Experience) — the DEC-125 schedule RULE + base pricing.
create table if not exists offerings (
  id                      text primary key,
  tenant_id               text not null,
  name                    text not null,
  status                  text not null default 'draft',   -- draft | live | hidden (only 'live' publishes a rule)
  vessel_ids              jsonb not null,                   -- VesselId[] the offering runs on
  location_id             text not null,
  schedule                jsonb not null,                   -- { seasonStart, seasonEnd, weekdays[], departureTimes[] }
  base_price_cents        integer not null,                 -- whole-boat base fare, cents (DEC-112)
  price_variations        jsonb not null default '[]',      -- ordered PriceVariation[]; first match wins
  extra_guest_price_cents integer not null default 0        -- per-guest surcharge, booking-time (DEC-124)
);

-- Location — first-class pickup place; the location-block target (DEC-123).
create table if not exists locations (
  id                 text primary key,
  name               text not null,
  pickup_description text not null,
  pickup_link        text,                                  -- optional map link
  route_description  text not null
);

-- Block — availability subtraction (DEC-125). One flat row per block; `kind` discriminates
-- which columns are meaningful (location | vessel | vesselHold). Unused columns stay null —
-- house style over three narrow tables (adapter-equivalence, no CHECK on kind).
create table if not exists blocks (
  id          text primary key,
  kind        text not null,                                -- location | vessel | vesselHold
  location_id text,                                         -- kind=location
  vessel_id   text,                                         -- kind=vessel | vesselHold
  date        text,                                         -- kind=location | vesselHold (ISO day)
  start_time  text,                                         -- kind=location (window "HH:MM")
  end_time    text,                                         -- kind=location
  start_date  text,                                         -- kind=vessel (ISO, inclusive)
  end_date    text,                                         -- kind=vessel
  time        text,                                         -- kind=vesselHold (departure "HH:MM")
  note        text
);
