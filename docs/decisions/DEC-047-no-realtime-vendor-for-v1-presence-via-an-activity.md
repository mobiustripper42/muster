---
id: DEC-047
title: "No realtime vendor for v1 — presence via an activity signal behind a `PresencePort`"
topic: "Messaging, presence & doorbell"
---

## DEC-047: No realtime vendor for v1 — presence via an activity signal behind a `PresencePort`

**Status:** Proposed (Phase 6) — operator-confirmed 2026-06-21.
**Decision:** v1 ships **no managed-realtime dependency** (no Ably / Pusher / Supabase Realtime) and
**no self-hosted socket server**. Presence — the doorbell's "is this person looking right now" input —
is a **coarse activity signal**: natural app activity (loading a thread, sending) plus an occasional
lightweight check, read behind an injected **`PresencePort`**. Instant live chat is **deferred**;
v1's crew chat is **refresh-to-see-new**. A hosted realtime service (or a self-hosted socket process)
is a **later, additive adapter swap** behind the same `PresencePort`, adopted only if/when instant
chat is wanted — with **zero change to the doorbell decider**.
**Why:** Vercel's serverless runtime (DEC-020) can't host a long-lived socket, and the doorbell's
value (suppress, batch, first-only-until-read, priority) is fully expressible over a coarse signal —
the batch window absorbs the signal's staleness, and "fail toward ringing" makes a missed-present
harmless. Crew is 20–25 → no scale forcing. Holds the dependency-minimal posture (DEC-020/033/034 all
rejected premature vendors).
**Tradeoff:** Live chat lags a few seconds (refresh/poll) until a realtime adapter lands — accepted;
instant chat isn't needed day one. **Rejected:** managed realtime *in* the slice (a vendor + cost the
doorbell doesn't need); a self-hosted socket server (breaks the single-app-on-Vercel topology — two
always-on deploy targets for one operator). **Revisit if:** crew want instant chat → drop a realtime
adapter behind `PresencePort`. **Phase:** Phase 6 (6.2).
