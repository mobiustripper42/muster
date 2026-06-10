# Muster — Running It Locally

How to stand up the app, see the UI, and check a change. The stable recipe lives here so PRs don't
re-explain it — a PR's "test plan" should link here for setup and then name only the surface-specific
things to eyeball.

## Prerequisites
- **Docker** (for local Postgres) and **Node 22**.
- No `.env` needed for local work — `DATABASE_URL`, `SESSION_SECRET`, and the base URL all have dev
  defaults. (Copy `.env.example` → `.env.local` only if you want to override.)

## Quick start
```bash
npm install
npm run db:up        # docker compose up -d  → postgres:17 on :5432 (muster_dev + muster_test)
npm run db:migrate   # apply db/migrations/*.sql
npm run db:seed:crew # seed "crew-quint": 1 confirmed shift + 1 open ask (so the crew app has data)
npm run dev          # next dev --webpack on :3000
```
Teardown: `npm run db:down` (keeps the data volume; add nothing to wipe).

## Opening it in a browser
This runs on the **`mill-dev` VPS, reached over Tailscale**, so from your laptop the app is:

> **http://mill-dev:3000**  ← use this, not `localhost`

`localhost:3000` only resolves from a shell *on* the VPS (which is why scripted smoke tests use it).
A VSCode port-forward of 3000 works too. The app honors whatever host you arrive on (links and
redirects are host-relative), so all three — `mill-dev`, a port-forward, `localhost` on the box —
work without config.

## Seeing the crew app (it needs a magic link)
The crew surfaces require a session, so you can't visit `/crew` cold — you enter through a magic link.
In dev there's a link issuer:

1. Open **http://mill-dev:3000/crew/dev-link?crew=crew-quint** → returns `{"link": "http://mill-dev:3000/crew/auth?t=…"}`
2. Open **that link** → it verifies + consumes the token, sets the `muster_session` cookie, and
   redirects to **`/crew`**.
3. You should see Quint's **ask** (In/Out), **My shifts**, and the standing chip.

`/crew/dev-link` is **dev-only** (404 in production). What to try:
- Tap **In** / **Out** on the ask → it resolves (In claims the seat → moves to My shifts; Out reopens).
- Open `/crew` with no cookie (private window) → the signed-out state.
- Mangle the `?t=` value → the expired/used-link copy.

> **Gotcha:** the seed's shift dates are fixed (2026-07-04/05). They show as "upcoming" relative to
> mid-2026; if the machine clock is ever past them, My shifts goes empty (the ask still shows). Re-run
> `npm run db:seed:crew` to reset state.

## Seeing the At-Risk board (admin)
Admin needs **no seed** — there's no admin entity (DEC-020): the session subject is a free-form
handle, so any `?admin=<handle>` works in dev.

```bash
npm run db:seed:atrisk   # 4 board scenarios, trips anchored to NOW (re-run anytime to re-anchor)
```

1. Open **http://mill-dev:3000/crew/dev-link?admin=spink** → tap the returned link → you land
   signed-in on **`/admin/at-risk`** with "4 shifts need a call · 1 regression".
2. The four rows, top to bottom: **Firkin** (red *Regression · late bail* pill — always pinned
   first), **Tidewater** (trail: *asked 2 · 1 declined · 1 silent*, silent in red), **Growler**
   (*⊘ Gus's credential lapses before the trip*), **Mash Tun** (*not yet worked — flagged by the
   oracle* + the "nobody left in the eligible pool" line, no Lean buttons).
3. Tap **↗ Lean on Marisol** (Firkin row) → green *"Last action: leaned on Marisol — asked, not yet
   filled"* and the Firkin row is **gone** — its ask is now in flight, which is the engine working,
   not a bug. (`/crew/dev-link?crew=crew-ar-sub` shows Marisol's In/Out card if you want the loop.)
4. Tap **Open in Assignment ↗** (Tidewater row) → read-only seat view, badge **Filling**; in the
   pool, Lance reads *declined* (muted) and Gardner *silent* (red) — visibly different.

```bash
npm run db:tick          # run one engine tick by hand (DEC-023 — no scheduler in v1)
```
Prints the tick counters (asks fired, escalations, board landings). After a tick, refresh the
board: **Tidewater disappears too** — Tier-2 sent a direct nudge, so an ask is in flight again.
Re-running `db:seed:atrisk` resets all four scenarios (it closes any in-flight engine asks).

## Other endpoints
- `GET /api/health` → `{ status, db.reachable, integrity: { ok, violationCount } }` (runs the no-FK
  integrity diagnostic; `degraded` if the DB is down or a dangling ref exists).
- `/admin` → links to the At-Risk board (roster/builder surfaces are later phases).

## Checking a change
- **The gate:** `npm run verify` → core typecheck + app typecheck + tests + webpack build. Docker-free
  (the Postgres adapter contract suite skips cleanly when no DB is reachable). This is what `/kill-this`
  and CI run.
- **The adapter contract on real Postgres:** with the DB up, `npm run test:pg` (or just `npm run verify`
  while `db:up` is running) exercises the in-memory↔Postgres equivalence suite instead of skipping it.
  CI always runs this against a Postgres service container.
- **UI changes:** there's no browser test harness yet, so eyeball UI surfaces by hand via the flow
  above. PRs call out exactly which surface to look at.

## Production notes (not needed for local dev)
Two env vars are dev-defaulted locally but **must be set in production**:
- **`SESSION_SECRET`** — signs session cookies. Unset in prod = a repo-public signing key = session
  forgery; the app fails fast if it's missing in production.
- **`APP_BASE_URL`** — the real external origin, used to build any **delivered** magic link. Without it
  a delivered link is built from the client-controlled `Host` header (host-header injection → token
  theft). The dev Host-header fallback is convenience only.
- `DATABASE_URL` — the hosted Postgres connection string (the provider is deploy-time, vendor-agnostic).
