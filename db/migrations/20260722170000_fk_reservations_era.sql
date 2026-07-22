-- 20260722170000_fk_reservations_era — real foreign keys for every table that has not yet
-- reached production (DEC-131).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- WHY NOW, AND WHY ONLY THESE TABLES. DEC-131 rules that the pre-existing FK-less graph is
-- ratified as-built (no retrofit) while NEW tables take real constraints. The reservations-era
-- tables — offerings, locations, blocks, payments, add_ons, checkout_holds, gratuity — are the
-- boundary case: they exist in dev and on `feature/reservations`, but `production` has never run
-- their migrations, so as far as prod is concerned they are new. That makes this the last
-- moment the constraints are free: the tables are EMPTY in production, so validation is
-- trivially satisfied — no orphan cleanup, no lock of consequence, no data risk. Once
-- reservations ship, this same change becomes a data-migration problem.
--
-- The motivating write is ahead of us, not behind: DEC-126's cutover is a one-time full Xola
-- import — a bulk, out-of-band write, which is exactly the class of write the service layer
-- cannot guard and a foreign key can.
--
-- WHY A SEPARATE MIGRATION instead of editing the originals in place. Those files have already
-- been APPLIED to dev, test and preview databases, and `_migrations` keys on filename, so an
-- edited file never re-runs: production would get the constraints while every existing database
-- silently would not. Additive keeps every environment identical and rewrites no history
-- (CLAUDE.md: never hand-patch an already-applied migration). Each original file now carries a
-- forward-pointer comment to this one.
--
-- ON DELETE RESTRICT everywhere, deliberately. Nothing in this app hard-deletes — the posture is
-- soft-delete via `active` (DEC-123) — so RESTRICT never actually fires; it is a pure guard with
-- zero behavioral change. CASCADE would be defensible for `checkout_holds` (transient 15-minute
-- rows) but would introduce a silent-delete path that does not exist today, so it is not used.
--
-- NOT COVERED, and not coverable: `offerings.tenant_id` / `add_ons.tenant_id` (there is no
-- `tenants` table — tenant is config, not a row), and `offerings.vessel_ids` / `add_on_ids`
-- (jsonb arrays). Those join the same permanent gap as `vessel.manning[]`, `crew.ratings[]`,
-- `shift.eventIds[]` and the polymorphic `magic_tokens.subject_id` — which is why the
-- referential-integrity diagnostic (`src/admin/integrity.ts`, deployment tracked in #501)
-- remains necessary and is NOT superseded by this migration.

do $$
declare
  fk record;
begin
  for fk in
    select * from (values
      -- child table,      column,           parent table,   constraint name
      ('payments',       'reservation_id', 'reservations', 'payments_reservation_id_fkey'),
      ('gratuity',       'reservation_id', 'reservations', 'gratuity_reservation_id_fkey'),
      ('gratuity',       'event_id',       'events',       'gratuity_event_id_fkey'),
      ('checkout_holds', 'vessel_id',      'vessels',      'checkout_holds_vessel_id_fkey'),
      ('checkout_holds', 'offering_id',    'offerings',    'checkout_holds_offering_id_fkey'),
      ('offerings',      'location_id',    'locations',    'offerings_location_id_fkey'),
      ('blocks',         'vessel_id',      'vessels',      'blocks_vessel_id_fkey'),
      ('blocks',         'location_id',    'locations',    'blocks_location_id_fkey')
    ) as t(child, col, parent, conname)
  loop
    -- Idempotent: `if not exists` on the constraint name, matching the house re-run posture.
    if not exists (select 1 from pg_constraint where conname = fk.conname) then
      execute format(
        'alter table %I add constraint %I foreign key (%I) references %I (id) on delete restrict',
        fk.child, fk.conname, fk.col, fk.parent
      );
    end if;
  end loop;
end $$;

-- Index every FK child column. Postgres indexes the PARENT side automatically (the referenced
-- key must be unique) but NOT the child: without these, a delete or update on the parent does a
-- sequential scan of the child to prove the constraint holds, and the lookups these columns
-- already serve stay unindexed too.
create index if not exists payments_reservation_id_idx       on payments (reservation_id);
create index if not exists gratuity_reservation_id_idx       on gratuity (reservation_id);
create index if not exists gratuity_event_id_idx             on gratuity (event_id);
create index if not exists checkout_holds_vessel_id_idx      on checkout_holds (vessel_id);
create index if not exists checkout_holds_offering_id_idx    on checkout_holds (offering_id);
create index if not exists offerings_location_id_idx         on offerings (location_id);
create index if not exists blocks_vessel_id_idx              on blocks (vessel_id);
create index if not exists blocks_location_id_idx            on blocks (location_id);
