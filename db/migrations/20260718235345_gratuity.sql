-- 20260718235345_gratuity — first-class gratuity collection (task 12.3a, DEC-124).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Gratuity is first-class CREW MONEY, not revenue (DEC-124): tax- and service-fee-exempt,
-- routes to crew via the per-event pool the 12.3b payroll report splits. One row per collected
-- gratuity, keyed by `kind` ('pre' at checkout | 'post' via the manage link). Linked to the
-- event (the split grain) AND the reservation (post-trip attach + cancel exclusion). House
-- ⚠️ SUPERSEDED (DEC-131): the no-FK claim below was both miscited (DEC-DATA-1 governs
-- logic placement, never foreign keys) and is now FACTUALLY STALE — this table's tables
-- had not reached production, so 20260722170000_fk_reservations_era.sql added REAL
-- foreign keys to them while they were still empty in prod. Read that migration for the
-- current constraint state.
-- style: text PK/ids, ~~NO foreign keys~~ (added later, see above), NO CHECK on `kind`
-- (a vocabulary CHECK is a business rule — that part IS DEC-DATA-1), integer cents.
--
-- Plus two additive columns: Offering gratuity tiers (the required-at-checkout choices), and a
-- `gratuity_cents` carve-out on payments so `balanceOwedCents` can net the tip out of "paid".
-- All additive + inert on existing rows. `if [not] exists` for idempotent re-runs.

create table if not exists gratuity (
  id                          text primary key,   -- grat_${kind}_${sessionId} (deterministic)
  event_id                    text not null,
  reservation_id              text not null,
  kind                        text not null,      -- 'pre' | 'post'
  amount_cents                integer not null,   -- crew money; never taxed/fee'd
  bps                         integer,            -- tier chosen (pre only); provenance
  stripe_checkout_session_id  text,
  created_at                  text not null
);
create index if not exists gratuity_event_id_idx on gratuity (event_id);         -- the split group-by
create index if not exists gratuity_reservation_id_idx on gratuity (reservation_id);

-- Per-Offering gratuity tiers (DEC-124). jsonb array of basis points; null ⇒ code default.
alter table offerings add column if not exists gratuity_tiers_bps jsonb;
alter table offerings add column if not exists gratuity_default_bps integer;

-- The gratuity portion of a booking payment's amount_cents (DEC-124) — netted out of the
-- balance calc. Null ⇒ 0 (balance payments + pre-12.3 rows carry no tip).
alter table payments add column if not exists gratuity_cents integer;
