-- 0010_doorbell_state — doorbell read + notify state + message priority (6.6a, #116, DEC-069).
--
-- The persistence the Smart Doorbell decider's INJECTED inputs flow from (DEC-068):
--   - message_reads         : per-(subject,thread) last-read — the decider's readState
--                             (cancel-on-read + first-only-until-read). Written by the
--                             crew-app read path (6.7); the doorbell only reads it.
--   - doorbell_notifications: per-(subject,thread) last-rang — the decider's notifyState
--                             (first-only-until-read / re-arm). Written by the doorbell
--                             tick on a ring (6.6b).
--   - messages.priority     : §7.4 priority-jump — the decider's PendingMessage.priority
--                             flows from this column (1:1 intrinsic to the message).
--
-- TWO single-writer tables, not one consolidated row (DEC-069): reads are the
-- crew-app unread substrate (6.7), notifications are doorbell-private (6.6b) —
-- different owners, different lifecycles.
--
-- House style (0008/0009): ISO dates as `text`, NO foreign keys (posture: DEC-131; integrity is the
-- service layer's — DEC-DATA-1), keyed by the canonical subject as a COMPOSITE
-- `(subject_kind, subject_id)` (DEC-058) with `thread_id` leading (the doorbell's
-- thread-scoped access path). `priority` is the schema's first native `boolean`
-- typed column — NOT text-encoded (that's a KV-store artifact, not house style).

create table message_reads (
  thread_id     text not null,
  subject_kind  text not null,   -- canonical AuthSubjectKind: admin | crew (DEC-058)
  subject_id    text not null,   -- namespace-local subject id (no FK — DEC-131)
  last_read_at  text not null,   -- ISO-8601 UTC, latest-wins
  primary key (thread_id, subject_kind, subject_id)
);

create table doorbell_notifications (
  thread_id         text not null,
  subject_kind      text not null,
  subject_id        text not null,
  last_notified_at  text not null,   -- ISO-8601 UTC; when the doorbell last rang, latest-wins
  primary key (thread_id, subject_kind, subject_id)
);

-- §7.4 — operator-flagged / type-derived; the decider bypasses the batch window and
-- first-only-until-read for a priority message. Default false; existing rows backfill
-- to non-priority. ADDITIVE — the only change to an existing table.
alter table messages add column priority boolean not null default false;
