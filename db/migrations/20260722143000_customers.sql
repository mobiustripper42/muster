-- 20260722143000_customers — the Customer contact record (12.12b, DEC-132).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- Customers exist so two bookings by the same person hang together. Identity is the phone;
-- the PK is a surrogate (DEC-132 — a carrier-recycled number must not inherit someone else's
-- history, and a mutable key means migrating every reference when a number changes).
--
-- CONSTRAINT POSTURE — read DEC-131 before copying this header. Earlier migrations say
-- "House style (DEC-DATA-1): NO foreign keys". That attribution was WRONG: DEC-DATA-1 decides
-- that domain logic stays in the service layer rather than in RLS/triggers/procs; it never
-- mentions foreign keys. DEC-131 draws the real line — the DB never holds BUSINESS RULES, but
-- it may hold STRUCTURAL INVARIANTS (NOT NULL, UNIQUE, FOREIGN KEY). So this table takes real
-- constraints, and the pre-existing FK-less graph is ratified as-built (no retrofit: the
-- contract suite deliberately writes dangling refs, src/adapters/repository-contract.ts).
--
-- Still house style: text PK, ISO-8601 timestamps as `text` (verbatim round-trip, parity with
-- the in-memory double), integer cents, `if not exists` for idempotent re-runs.
create table if not exists customers (
  id           text primary key,
  display_code text not null,   -- 'C-' + 6 Crockford base32; UNIQUE below
  name         text not null,
  phone_e164   text not null,   -- canonical E.164 — THE identity key; UNIQUE below
  email        text,
  created_at   text not null,   -- ISO-8601 UTC
  notes        text,
  active       boolean not null default true
);

-- The identity key. Same phone ⇒ same customer, enforced where concurrent writers can actually
-- be arbitrated: get-or-create at booking time races itself, and only the DB can settle it
-- (the same reason the checkout-hold mutex is a unique index, 20260718142705).
create unique index if not exists customers_phone_e164_key on customers (phone_e164);

-- The readable code is minted with retry against THIS index — TS generates a candidate, the
-- database decides. "Probably unique" values trusted in application code is how duplicates ship.
create unique index if not exists customers_display_code_key on customers (display_code);

-- Link reservations to their customer. NULLABLE: historical rows that never captured a
-- canonicalizable phone stay unlinked forever (acceptable — they are history), and NULL passes
-- the FK. ON DELETE RESTRICT documents "a customer with booking history can't be hard-deleted";
-- moot in practice under the soft-delete (`active`) posture, which is the intended path.
alter table reservations add column if not exists customer_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_customer_id_fkey'
  ) then
    alter table reservations
      add constraint reservations_customer_id_fkey
      foreign key (customer_id) references customers (id) on delete restrict;
  end if;
end $$;

-- Lookup path for the customer detail pane's booking history.
create index if not exists reservations_customer_id_idx on reservations (customer_id);
