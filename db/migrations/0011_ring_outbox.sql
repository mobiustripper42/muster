-- 0011_ring_outbox — the doorbell-ring relay's operator outbox (the promotion gate, DEC-073).
--
-- Sibling to outbox_entries (0005) but its OWN table, NOT a union (DEC-073, the same
-- call DEC-050/DEC-069 made): a ring has a different owner (OutboxNotificationChannel
-- vs WebLinkChannel) and a different lifecycle (ring-cycle + drop-on-read vs
-- settle-on-answer). A separate table keeps the ask outbox's NOT NULL invariant
-- (ask_id/seat_id) untouched and drops cleanly at the 6.9 Twilio swap.
--
-- Same house rules as 0005: text PK (deterministic `ring-<threadId>-<crewMemberId>` —
-- ONE slot per (thread, member), upserted per ring-cycle, never piling duplicates),
-- ISO dates as `text` (verbatim round-trip, parity with the in-memory double), no
-- foreign keys (integrity is the service layer's — DEC-DATA-1). ADAPTER-SIDE state:
-- only the channel adapter writes it, only the ring-outbox view reads it.
--
-- `body` + `link` are frozen at enqueue (DEC-030) — but each ring-cycle mints a FRESH
-- one-time link (first-only-until-read makes each enqueue a genuinely new cycle). The
-- ring view drops an entry once the recipient has read the thread past `created_at`
-- (DEC-073 drop-on-read, the ring analog of the ask's drop-on-settled) — so `created_at`
-- is the read-cancellation anchor, not just a timestamp.

create table ring_outbox (
  id              text primary key,          -- ring-<threadId>-<crewMemberId>
  crew_member_id  text not null,
  thread_id       text not null,             -- the thread the ring covers (the deep-link target)
  body            text not null,             -- relay text, frozen at enqueue ("N new" / inlined short note)
  link            text not null,             -- thread deep-link magic link (24h TTL), frozen
  status          text not null,             -- pending | sent
  created_at      text not null,             -- ISO-8601 UTC (enqueue = deliveredAt); the drop-on-read anchor
  sent_at         text                       -- ISO-8601 UTC; null until the operator texts it
);
create index ring_outbox_status_idx on ring_outbox(status);
