-- 0009_presence — the Smart Doorbell's presence signal (#112, DEC-046/047/058).
--
-- A coarse "is this subject active right now" store the doorbell decider reads to
-- SUPPRESS a ring (they're already looking). NOT a realtime vendor and NOT a
-- socket server (DEC-047): just an observed last-active timestamp, upserted on
-- natural app activity + the occasional lightweight check, read behind the
-- injected `PresencePort`. The realtime swap is a later additive adapter behind
-- the same port — zero change to the decider.
--
-- Observed-only, never crew-curated (DEC-046): rows are written by observing
-- activity, never by a crew "set my availability" surface (the DEC-009 trap).
--
-- House style (0001/0005/0007/0008): ISO dates as `text`, NO foreign keys
-- (integrity is the service layer's — DEC-DATA-1). Keyed by the canonical subject
-- as a COMPOSITE `(subject_kind, subject_id)` (DEC-058): ids are only collision-
-- free WITHIN a kind, so the kind is part of the key — never a flat `kind:id`
-- string (that's the in-memory Map key only). ADDITIVE — no existing table changes.

create table presence (
  subject_kind   text not null,   -- canonical AuthSubjectKind: crew | admin (+ customer, portal-era — DEC-058)
  subject_id     text not null,   -- namespace-local subject id (no FK — DEC-DATA-1)
  last_active_at text not null,   -- ISO-8601 UTC; observed activity, latest-wins (DEC-046)
  primary key (subject_kind, subject_id)
);
