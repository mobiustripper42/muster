---
id: DEC-054
title: "Operator engine pause/resume — edge-gated, typed-port-backed, default-running (#124)"
topic: "Core architecture & engine mechanics"
---

## DEC-054: Operator engine pause/resume — edge-gated, typed-port-backed, default-running (#124)

**Status:** Built (Session 23). @architect-gated 2026-06-23.

**Decision:** A `/admin` pause/resume toggle arms/disarms the autonomous engine without a redeploy.
Persistence: `app_settings(key text pk, value text not null, updated_at text not null)` — DEC-DATA-1
house style (text PK, ISO-text dates, no FK). The port exposes typed `isEnginePaused()` /
`setEnginePaused(paused, at)`; the adapter maps the `engine_paused` key and parses `"true"`/`"false"`
↔ `boolean` internally, so the domain/edge never touches stringly-typed KV (DEC-013). The pause check
lives in the **cron edge route** (`app/api/cron/tick/route.ts`): if paused, return `{ok, paused:true}`
without calling `tick()`. `tick()` stays pure (DEC-023/DEC-001) — pause is an ops concern, not engine
logic. The cron still fires every 15 min; a paused tick is a cheap no-op. Manual surfaces (the
per-shift cockpit asks) are a separate path and keep working while paused.

**Default = running** (row absent ⇒ engine on). The go-live "import and look around first" posture is
achieved by **explicitly** flipping to paused as a deliberate step in the pilot runbook, not by
inferring pause from an absent row — an autonomous "no babysitting" engine must never silently stop
because state was cleared by a restore/migration (the worst failure for this system, and invisible
since an empty board reads as success). Paused status surfaces on `/admin` **and** `/admin/at-risk`
(an empty board while paused is a muted engine, not success — guards the "empty board = success"
signal, the operator-confusion guard from #68).

**Why KV over a dedicated `engine_state` table:** same migration cost; the generality is confined to
one table whose shape the domain never sees (the port stays specific). **Not** justified by speculative
future flags.

**Seam guard:** `tick()` carries a comment that pause is enforced at the cron edge; any new autonomous
`tick()` caller must check `isEnginePaused` itself. The dev CLI (`db/tick-dev.ts`) and manual cockpit
asks intentionally bypass.

**Tradeoff:** A mutable singleton in persistence (the first non-aggregate setting). **Rejected:** an
`ENGINE_PAUSED` env var (a Vercel env change needs a redeploy — not instant); gating inside `tick()`
(couples engine logic to an ops toggle, breaks the pure-decider testability).
