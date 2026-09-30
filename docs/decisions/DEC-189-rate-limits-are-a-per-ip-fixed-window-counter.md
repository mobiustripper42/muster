---
schema: 1
id: DEC-189
title: "Rate limits are a per-IP fixed-window counter in our own Postgres"
topic: "Core architecture & engine mechanics"
status: "active"
date: "2026-09-30"
ruling: "Public forms are rate-limited per client IP by a fixed-window counter in our own database, with refusals logged. If the limiter itself breaks, the request goes through."
claims:
  - kind: "file"
    target: "src/rate-limit/rate-limit.ts"
    note: "takeRateLimit and limitKeyFor"
  - kind: "file"
    target: "app/lib/client-ip.ts"
    note: "the only place a client IP is read"
revisit_if: "A real guest or crew member is refused by a limit, or a consumer needs a limit that must fail closed"
---

## DEC-189: Rate limits are a per-IP fixed-window counter in our own Postgres

The most common algorithm: one row per bucket, key and window, bumped by one atomic upsert;
ended windows are swept on the way in, as `recovery_throttle` does. Its 2× burst at a window edge
does not matter at limits no dock reaches. Refused windows go to a log kept 90 days, so being
targeted, or turning real people away, is answerable (operator, 2026-09-30).

Repository methods, not a port: the table shares Postgres's fate. Upstash is a vendor and a secret
to save one table. A Vercel firewall rule is dashboard state the repo cannot test (DEC-180), and answers
with the platform's page, losing a half-signed waiver.

The key is the client IP, read once at the edge: Vercel's `x-forwarded-for`, which it overwrites,
and `CF-Connecting-IP` only when that hop is in Cloudflare's published ranges. IPv6 keys on its /64.
No address, no limit; never a shared bucket. Per-email and per-trip keys were rejected: each lets a
stranger lock out a real person.

Fail open, declared per policy: each consumer has a real control behind this one.
