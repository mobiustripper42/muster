-- 0005_outbox — the web-link pilot channel's operator outbox (DEC-030, DEC-MSG-3).
--
-- Same design rules as 0001/0002: text PK (deterministic id from the adapter —
-- one entry per ask, `obx-<askId>`), ISO date fields as `text` (verbatim
-- round-trip, parity with the in-memory double), no foreign keys (posture: DEC-131, NOT DEC-DATA-1; integrity is
-- the service layer's — DEC-DATA-1; the diagnostic checks ask/seat/crew refs).
--
-- ADAPTER-SIDE state, never domain state (DEC-030 guardrail): only the channel
-- adapter writes it and only the outbox page reads it. `body` + `link` are
-- frozen at enqueue (the magic link is minted once — a re-render must show
-- exactly what was texted). `sent_at` NULL = the operator hasn't texted it yet.

create table outbox_entries (
  id              text primary key,
  ask_id          text not null,
  seat_id         text not null,
  crew_member_id  text not null,
  body            text not null,             -- relay text, frozen at enqueue
  link            text not null,             -- magic link (24h TTL), frozen at enqueue
  status          text not null,             -- pending | sent
  created_at      text not null,             -- ISO-8601 UTC (enqueue = deliveredAt)
  sent_at         text                       -- ISO-8601 UTC; null until marked sent
);
create index outbox_entries_status_idx on outbox_entries(status);
