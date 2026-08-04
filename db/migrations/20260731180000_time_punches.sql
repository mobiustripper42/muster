-- 20260731180000_time_punches — the time clock's storage (#625, SPEC §2.9).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- A punch is a free-standing interval owned by a crew member: `in_at`, an `out_at`
-- that is NULL while they're still on the clock, and a `shift_id` auto-matched at
-- clock-in (NULL on zero matches and on several — an ambiguous tag is worse than
-- none, and hours are owed either way).
--
-- INSTANTS, NOT WALL CLOCK. Stored as ISO-8601 UTC `text` per house style, but
-- unlike every other date in the schema these are absolute, not vessel-local
-- (DEC-032's deliberate exception, shared with the calendar feed): elapsed time
-- across a DST transition is only correct if both ends are absolute. Rendering and
-- pay-period bucketing convert back to vessel-local at the edge.
--
-- FK to crew_members: a punch without a person is meaningless, and DEC-131 settles
-- that structural constraints are storage's job. `on delete restrict` is a backstop,
-- not a live path — **the app has no crew delete at all** (they're archived via
-- `setCrewStatus`, DEC-096), so this only ever fires on a hand-run DELETE or a future
-- port method. Restrict rather than cascade because hours already worked are still
-- owed: losing them silently is worse than a loud refusal.
--
-- There is deliberately NO FK on shift_id: it's an auto-matched annotation (SPEC
-- §2.9.2), and a shift being reformed must never take a punch with it. That's exactly
-- why `checkIntegrity` walks it — a dangling tag is benign but should be visible.

create table if not exists time_punches (
  id              text primary key,
  crew_member_id  text not null references crew_members(id) on delete restrict,
  in_at           text not null,
  out_at          text,
  shift_id        text,
  -- Text, NOT a CHECK/enum — the same call 0023 made for `source`: which values a
  -- discriminator admits is a domain fact, and a CHECK would exist in Postgres but not
  -- in the in-memory double, breaking the adapter-equivalence the contract suite proves
  -- (DEC-DATA-1; DEC-131 permits structural constraints, not vocabularies). The default
  -- stays permanently: `clockIn` writes 'crew' unless an admin surface says otherwise.
  origin          text not null default 'crew',
  admin_edited_at text
);

-- THE one-open-punch invariant (§2.9.4). A partial unique index, not a TypeScript
-- check a double-tapped button can race: two concurrent `clockIn`s both pass an
-- application-level "is anything open?" read and only this stops the second row.
-- `clockIn` catches the resulting 23505 and returns `already_in`, so the user sees
-- a no-op and never a 500.
create unique index if not exists time_punches_one_open_per_crew
  on time_punches (crew_member_id)
  where out_at is null;

-- The pay-period query (13.4) scans by `in_at` across everyone.
create index if not exists time_punches_in_at on time_punches (in_at);

-- The per-crew list (13.2).
create index if not exists time_punches_crew on time_punches (crew_member_id, in_at desc);
