-- 0024_audit_events.sql — crew audit log (#400, DEC-118).
--
-- An operator-facing, append-only trail of every crew add / drop / change, with
-- an actor dimension. Kept SEPARATE from reliability_events (scoring substrate,
-- DEC-008) on purpose: an admin removal / operator force-place / self-claim is
-- not the subject's behavior, and this log never feeds the scorer. Mirrors the
-- reliability_events column conventions (bigserial seq, deterministic text id,
-- ISO-text timestamp, jsonb metadata, no FKs — posture per DEC-131, not DEC-DATA-1).
--
-- No backfill: the add/drop transitions were never persisted before this, so
-- capture starts here — the /admin/audit UI says "audit begins <ship date>".

create table audit_events (
  seq             bigserial,
  id              text primary key,
  crew_member_id  text not null,             -- subject: who it happened to
  actor_kind      text not null,             -- crew | admin | importer | engine
  actor_id        text,                      -- nullable for engine / crew-self
  type            text not null,             -- crew_added | crew_removed | shift_changed
  timestamp       text not null,             -- ISO-8601 UTC
  metadata        jsonb not null default '{}'
);

-- The three query axes #400 needs (reliabilityEventsFor's per-crew-only can't serve):
create index audit_events_time_idx      on audit_events(timestamp desc);            -- all-crew / date-range
create index audit_events_crew_time_idx on audit_events(crew_member_id, timestamp desc); -- per-crew
create index audit_events_type_time_idx on audit_events(type, timestamp desc);      -- by-type
