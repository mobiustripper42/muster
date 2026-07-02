-- 0015_notice_outbox — the crew assignment-change relay's operator outbox (DEC-084).
--
-- The THIRD operator-relay outbox, sibling to outbox_entries (0005, asks) and
-- ring_outbox (0011, doorbell rings) — each its OWN table, NOT a union (the same call
-- DEC-050/DEC-069/DEC-073 made). A "you're on / you're off a shift" notice has no
-- ask/seat/claim (so not the ask outbox's NOT NULL correlation) and no thread/read-
-- state (so not the ring's drop-on-read). It carries a crew id + an action + a /crew
-- magic link the operator relays.
--
-- Same house rules as 0005/0011: text PK (deterministic
-- `notice-<shiftId>-<crewMemberId>-<action>` — ONE slot per shift+member+action,
-- upserted per re-issue, never piling duplicates), ISO dates as `text` (verbatim
-- round-trip, parity with the in-memory double), no foreign keys (integrity is the
-- service layer's — DEC-DATA-1). ADAPTER-SIDE state: only OutboxNoticeChannel writes
-- it, only the notice-outbox view reads it; the domain never does.
--
-- `body` + `link` frozen at enqueue (DEC-030). TERMINAL-ON-SENT (DEC-084): unlike the
-- ring (drop-on-read) and the ask (settle-on-answer), a sent notice STAYS — the
-- durable "we told them" record. The operator marks it sent and it moves to the sent
-- list; nothing auto-clears it.

create table notice_outbox (
  id              text primary key,          -- notice-<shiftId>-<crewMemberId>-<action>
  crew_member_id  text not null,
  action          text not null,             -- added | removed
  body            text not null,             -- relay text, frozen at enqueue
  link            text not null,             -- /crew magic link (24h TTL), frozen
  status          text not null,             -- pending | sent
  created_at      text not null,             -- ISO-8601 UTC (enqueue = deliveredAt)
  sent_at         text                       -- ISO-8601 UTC; null until the operator texts it
);
create index notice_outbox_status_idx on notice_outbox(status);
