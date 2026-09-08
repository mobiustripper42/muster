---
schema: 1
id: DEC-167
title: "A cron interval is chosen against the host's idle timeout, not for latency alone"
topic: "Messaging, presence & doorbell"
status: "active"
date: "2026-09-08"
ruling: "The doorbell cron is withdrawn. A cadence shorter than the database's scale-to-zero window keeps it permanently awake, and a flag-off feature must return before its first I/O."
claims:
  - kind: "file"
    target: "vercel.json"
    note: "`crons` lists `/api/cron/tick` only"
  - kind: "file"
    target: "app/api/cron/doorbell-tick/route.ts"
    note: "returns on `!messagingEnabled()` before `getRepo()`"
revisit_if: "MESSAGING is turned back on, at which point a cadence is chosen against the deployed host's idle window rather than inherited"
---

## DEC-167: A cron interval is chosen against the host's idle timeout

Supersedes **DEC-070** on its `*/2` cadence only; the rest of that record stands.

### The measurement

Neon's scale-to-zero is 5 minutes. A 2-minute cron resets the idle timer before it can expire, so the production database never slept. Measured 2026-09-07: **157.27 compute-hours over 7 days**, 22.4 a day against a maximum of 24 — **93% awake**, roughly **$76/month**. `MESSAGING` has been off since 2026-07-12, so every sweep did nothing.

### The rule

Neither number is wrong alone. The cost lives in their **product**, and nothing in the repo, in Vercel or in Neon displays that product — the bill arrives a month later as "Compute." DEC-040 framed cadence as the latency lever; it is also a billing lever, and the two are compared out loud from now on.

### And the guard goes before the I/O

The route called `getRepo().isEnginePaused()` — a query — *before* `messagingEnabled()`. An off feature woke the database to ask a question it discarded. **A kill switch that fires after the connection is already open kills the behaviour, not the bill.**

This withdraws a schedule, not a feature — the route, decider, adapters and tests are all intact.
