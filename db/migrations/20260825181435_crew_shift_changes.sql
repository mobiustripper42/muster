-- 20260825181435_crew_shift_changes.sql — crew_shift_changes
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- #769, DEC-158 Decision 4: the app half of the change notice. The SMS half shipped first and is
-- a STRICT SUBSET by design — it carries the shortest true tokens that fit one GSM-7 segment and
-- drops the rest. That is only safe if the app carries all of it, which until now it did not: the
-- fallback text pointed at a surface showing the shift but not what changed about it. The SMS was
-- making a promise the app did not keep.
--
-- Two tables, following `message_reads` / `doorbell_notifications` (DEC-069, migration 0010).
-- House style throughout: ISO-8601 UTC as `text`, no foreign keys (DEC-131).
--
-- WHY THE DIFF IS PERSISTED AT ALL. `formShifts` already computes it and hands it to
-- `changedCrew` (`src/builder/form-shifts.ts:92-99`), where it reaches the notice and is then
-- gone. A crew member who arrives ten minutes later has no way to be told what moved. Storing it
-- is the difference between an app that can describe a change and one that can only say a change
-- happened.

-- One row per change, per crew member. Append-only; nothing updates a row here.
--
-- KEYED PER CREW MEMBER, not per shift, because `formShifts` pushes one entry per assigned seat
-- (`form-shifts.ts:493-503`) and dismissal is per person — two crew on the same boat dismiss
-- independently, so "seen" is not a property of the shift (DEC-158). It also means the banner's
-- "changed twice" is a row count for THAT crew member; folding per shift would multiply it by the
-- crew count and report a number that is wrong in exactly the way nobody checks.
--
-- No primary key: two genuinely distinct changes to one shift for one crew member in the same
-- instant are possible on a fast tick, and there is no natural column that separates them. The
-- read is a filtered scan by (shift_id, crew_member_id), which the index below serves.
create table if not exists shift_changes (
  shift_id        text not null,   -- no FK (DEC-131)
  crew_member_id  text not null,   -- no FK (DEC-131)
  changed_at      text not null,   -- ISO-8601 UTC, when the change was observed
  -- Event ids gained and lost in THIS change, JSON arrays. The reader nets them across the
  -- whole unseen window, so an id added on one change and removed on the next cancels out.
  added           text not null default '[]',
  removed         text not null default '[]',
  -- Earliest scheduled departure before/after, ISO instants. NULL is UNKNOWN, not "unchanged":
  -- a shift row written before the `earliest_start` watermark (20260817210230) has no prior
  -- start, and the banner must refuse to name a clock change it cannot substantiate, exactly as
  -- `changeSummary` does. The crew-facing SHIFT START is this minus CALL_LEAD_MINUTES, derived
  -- at the surface rather than stored twice (DEC-157).
  start_before    text,
  start_after     text
);

create index if not exists shift_changes_crew_idx
  on shift_changes (crew_member_id, shift_id, changed_at);

-- The per-crew read marker — exactly the `message_reads` shape (0010), latest-wins.
--
-- Re-raise falls out of this rather than from a policy: the reader asks for changes where
-- `changed_at > last_seen_at`, so a change arriving after a dismissal brings the banner back with
-- no rule written anywhere. A dismissal therefore cannot accidentally become permanent.
create table if not exists shift_change_reads (
  shift_id        text not null,
  crew_member_id  text not null,
  last_seen_at    text not null,   -- ISO-8601 UTC, latest-wins
  primary key (shift_id, crew_member_id)
);
