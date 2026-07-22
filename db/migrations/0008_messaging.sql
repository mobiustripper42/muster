-- 0008_messaging — the in-app message store (#111, DEC-051).
--
-- The substrate behind full-mesh group chat: cohort (everyone crewing a day),
-- shift (one shift's crew), all-staff (the roster), and ad-hoc DM. All four are
-- one primitive — a thread + a participant set — but membership is DERIVED at
-- read for the three standing kinds (cohort/shift/all-staff, computed from
-- shifts/seats/roster) and PERSISTED only for DMs (DEC-051). A snapshotted cohort
-- goes stale the moment the schedule changes — the Xola-trap calendar (DEC-009
-- spirit) — so the only membership rows here are `thread_participants`, written
-- for DM threads alone.
--
-- House style (0001/0005/0007): text PK, ISO dates as `text`, NO foreign keys (posture: DEC-131)
-- (integrity is the service layer's — DEC-DATA-1); `kind` is data, not a DB enum
-- (DEC-ROLE-1 discipline applied to threads). ADDITIVE — no existing table changes.

create table threads (
  id          text primary key,   -- standing kinds: deterministic (standingThreadId); DM: sorted-pair (dmThreadId)
  tenant_id   text not null,
  kind        text not null,       -- cohort | shift | all_staff | dm  (data, not an enum branch — DEC-051)
  scope_ref   text,                -- ISO date (cohort) | shift id (shift) | null (all_staff, dm)
  created_at  text not null        -- ISO-8601 UTC
);
create index threads_tenant_idx on threads(tenant_id);

create table thread_participants (   -- DM membership ONLY (DEC-051); derived kinds persist nothing
  id              text primary key,
  thread_id       text not null,     -- → threads.id (no FK — DEC-131)
  crew_member_id  text not null
);
create index thread_participants_thread_idx on thread_participants(thread_id);

create table messages (
  id          text primary key,
  thread_id   text not null,        -- → threads.id (no FK — DEC-131)
  sender_id   text not null,        -- subject ref: a crew member id (crew) or an operator subject id
  sender_kind text not null,        -- crew | operator
  body        text not null,
  created_at  text not null         -- ISO-8601 UTC; the chronological order key
);
create index messages_thread_idx on messages(thread_id);
create index messages_created_at_idx on messages(created_at);
