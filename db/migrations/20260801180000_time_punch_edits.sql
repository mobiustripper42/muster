-- 20260801180000_time_punch_edits — who changed a punch, when, from what, and why (#635).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- APPEND-ONLY, same idiom as reliability_events (DEC-008) and audit_events (DEC-118).
-- One row per change; never updated, never deleted. A punch's hours can be corrected —
-- what was done to it cannot be.
--
-- WHY A TRAIL AND NOT COLUMNS. `time_punches.admin_edited_at` answers "did someone else
-- touch this?" for the LAST edit only. Once crew and admin can both edit the same row,
-- and every crew edit carries a reason, last-write-wins metadata loses the story: a
-- punch edited by its owner and then corrected by the office keeps only the office's
-- reason. The question that gets asked when a paycheck is disputed — "who changed my
-- hours, and why?" — is per-edit, so the record is per-edit.
--
-- NO FK ON time_punch_id, deliberately, and it is the opposite call from the one the
-- punch itself makes on crew_member_id. A `deleted` row must OUTLIVE the punch it
-- describes: it is the only remaining evidence those hours ever existed, and a cascade
-- or a restrict would either erase that evidence or forbid the deletion it records.
-- `checkIntegrity` therefore does NOT report a punch-edit whose punch is gone — for
-- this table alone, a dangling reference is the expected steady state.
--
-- actor_id IS foreign-keyed: an edit by nobody is meaningless, and the same
-- `on delete restrict` reasoning applies as on time_punches (the app has no crew
-- delete at all — they're archived, DEC-096).
--
-- Times are ISO-8601 UTC text per house style; from_*/to_* are nullable because a
-- `created` row has no before and a `deleted` row has no after.

create table if not exists time_punch_edits (
  id             text primary key,
  time_punch_id  text not null,
  actor_kind     text not null,
  actor_id       text not null references crew_members(id) on delete restrict,
  at             text not null,
  action         text not null,
  from_in_at     text,
  from_out_at    text,
  to_in_at       text,
  to_out_at      text,
  reason         text not null default ''
);

-- The per-punch history read, which is every read this table has on a surface.
create index if not exists time_punch_edits_punch on time_punch_edits (time_punch_id, at);

-- Who has been editing, across punches — the operator question this table will grow
-- into ("has someone been rewriting their own hours?").
create index if not exists time_punch_edits_actor on time_punch_edits (actor_id, at desc);
