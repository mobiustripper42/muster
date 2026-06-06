-- 0001_init — the M0–M3 domain entities as plain Postgres DDL (DEC-020, DEC-DATA-1).
--
-- Design notes:
--  * IDs are the domain's branded strings → `text` primary keys (deterministic,
--    natural-key ids minted in the core; no surrogate sequences except the
--    append-only reliability log, which needs an insertion-order column).
--  * Date/time domain fields (expiry, dates, ISO timestamps) are stored as `text`
--    — the core treats them as ISO strings and re-parses them, so a string
--    round-trip matches the in-memory adapter EXACTLY (no date/timezone coercion
--    divergence between the two substrates the contract suite proves equivalent).
--  * Array/nested domain fields (manning, ratings, eventIds, metadata) → `jsonb`.
--  * No CHECK constraints on the state vocabularies, and **no foreign keys**: the
--    domain/service layer owns validation and referential integrity (DEC-DATA-1);
--    the DB is storage, not where logic lives. This also keeps the Postgres
--    adapter behaviorally identical to the in-memory double (a dumb per-aggregate
--    store with no referential enforcement) — the equivalence the contract suite
--    proves. Indexes stay (query performance, no behavior). RLS, when it lands, is
--    authorization-only — also per DEC-DATA-1.

create table role_types (
  id         text primary key,
  tenant_id  text not null,
  name       text not null
);

create table vessels (
  id           text primary key,
  name         text not null,
  coi_max_pax  integer not null,
  manning      jsonb not null            -- [{roleTypeId, count}]
);

create table crew_members (
  id                 text primary key,
  name               text not null,
  phone              text not null,
  email              text,
  ratings            jsonb not null,      -- [roleTypeId]
  status             text not null,
  manual_boost       double precision,
  manual_floor       double precision,
  protocol_override  text,
  reliability_score  double precision     -- null = "no history yet" (DEC-008)
);

create table credentials (
  id              text primary key,
  crew_member_id  text not null,
  type            text not null,
  identifier      text,
  expiry          text not null           -- ISO-8601 date string
);
create index credentials_crew_idx on credentials(crew_member_id);

create table pto_windows (
  id              text primary key,
  crew_member_id  text not null,
  start_date      text not null,          -- ISO-8601 (domain: PtoWindow.start)
  end_date        text not null           -- ISO-8601 (domain: PtoWindow.end)
);
create index pto_windows_crew_idx on pto_windows(crew_member_id);

create table events (
  id         text primary key,
  vessel_id  text not null,
  date       text not null,               -- ISO-8601 date (vessel-local day)
  time       text not null,               -- departure clock time, e.g. "14:00"
  capacity   integer not null,
  status     text not null
);

create table reservations (
  id             text primary key,
  event_id       text not null,
  customer_name  text not null,
  party_size     integer not null,
  email          text,
  phone          text,                     -- nullable (DEC-017)
  status         text not null
);
create index reservations_event_idx on reservations(event_id);

create table shifts (
  id          text primary key,
  vessel_id   text not null,
  date        text not null,
  state       text not null,               -- derived (DEC-005)
  locked_at   text,
  event_ids   jsonb not null               -- [eventId]
);

create table seats (
  id                      text primary key,
  shift_id                text not null,
  role                    text not null,    -- roleTypeId (DEC-ROLE-1)
  kind                    text not null,    -- required | supernumerary
  state                   text not null,    -- Open|Asked|Claimed|Confirmed|Bailed
  assigned_crew_member_id text
);
create index seats_shift_idx on seats(shift_id);

create table asks (
  id              text primary key,
  seat_id         text not null,
  crew_member_id  text not null,
  channel         text not null,
  sent_at         text not null,            -- ISO-8601 UTC
  responded_at    text,
  response        text,
  type            text,                     -- ⏳ Pass D (DEC-004); null reads "confirm"
  decision_by     text                      -- ⏳ Pass D (DEC-004)
);
create index asks_seat_idx on asks(seat_id);

-- Append-only (DEC-008). `seq` gives the insertion order `reliabilityEventsFor`
-- returns — the in-memory adapter uses array push order; this matches it.
create table reliability_events (
  seq             bigserial,
  id              text primary key,
  crew_member_id  text not null,
  type            text not null,
  timestamp       text not null,            -- ISO-8601 UTC
  metadata        jsonb not null
);
create index reliability_events_crew_seq_idx on reliability_events(crew_member_id, seq);
