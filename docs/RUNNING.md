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
3. You should see Quint's **ask** (In/Out), **My shifts**, the standing chip, and the amber
   **credential line** (#57): "Your MMC expires &lt;~30d out&gt; — renew it to keep getting asked for shifts."

`/crew/dev-link` is **dev-only** (404 in production). What to try:
- Tap **In** / **Out** on the ask → it resolves (In claims the seat → moves to My shifts; Out reopens).
- **Bail (#56):** open the My-shifts row → at the card's bottom, expand **"I can’t make it…"** →
  tap **Drop this seat** → you land back on `/crew` with the calm "You’re off the … shift"
  notice and the shift is gone from My shifts. The fallout depends on who else is seeded
  (DEC-019, both honest):
  - **Crew seed only** → no other valid captain exists → the seat rests **Bailed** and the Hops
    shift shows on **/admin/at-risk** as a red **Lacking crew · late bail** regression.
    ⚠️ "Crew seed only" means a DB that has *never* run `db:seed:atrisk` — its captains persist
    (upserts never delete; `db:migrate` is forward-only and won't drop them), so a plain re-run of
    `db:seed:crew` on a contaminated DB **won't** get you here. Wipe the volume first:
    `docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:crew`,
    *then* bail.
  - **At-risk seed also loaded** → that seed adds eligible captains, so the bail **re-asks** instead
    → seat goes `Asked`, shift `Filling`. A live ask far from the trip is suppressed from the board
    by design — open the Hops cockpit (`/admin/shift/shift-soon`) and watch the pool read
    *awaiting reply*. (Quick check of which path you're on: if `/admin/at-risk` shows
    `vessel-ar-*` rows, the at-risk seed is loaded — you're on this branch.)

  Re-running `npm run db:seed:crew` resets Quint's seat to Confirmed (undoes the bail), but does
  **not** remove at-risk shifts — only `docker compose down -v` (drop the volume) does.
- Open `/crew` with no cookie (private window) → the signed-out state.
- Mangle the `?t=` value → the expired/used-link copy.

> **Gotcha:** the seed's shift dates are fixed (2026-07-04/05). They show as "upcoming" relative to
> mid-2026; if the machine clock is ever past them, My shifts goes empty (the ask still shows). Re-run
> `npm run db:seed:crew` to reset state.

## Seeing the At-Risk board (admin)
Admin needs **no seed** — there's no admin entity (DEC-020): the session subject is a free-form
handle, so any `?admin=<handle>` works in dev.

```bash
npm run db:seed:atrisk   # 4 board + 2 cockpit scenarios, trips anchored to NOW (re-run to re-anchor)
```

1. Open **http://mill-dev:3000/crew/dev-link?admin=spink** → tap the returned link → you land
   signed-in on **`/admin/at-risk`** with "4 shifts need a call · 1 late bail".
2. The four rows, top to bottom: **Firkin** (red *Lacking crew · late bail* pill — always pinned
   first), **Tidewater** (trail: *asked 2 · 1 declined · 1 silent*, silent in red), **Growler**
   (*⊘ Gus's credential lapses before the trip*), **Mash Tun** (*Lacking crew · none eligible*,
   "not yet worked — flagged by the oracle" + the "nobody left in the eligible pool" line, no Lean
   buttons).
3. Tap **↗ Nudge Marisol** (Firkin row) → green *"Last action: nudged Marisol — asked, not yet
   filled"* and the Firkin row is **gone** — its ask is now in flight, which is the engine working,
   not a bug. (`/crew/dev-link?crew=crew-ar-sub` shows Marisol's In/Out card if you want the loop.)
4. Tap **Assignment ↗** (Tidewater row) → the assignment cockpit (#54), badge **Filling**;
   in the pool, Lance reads *declined* (muted, with a **↗ Nudge** button) and Gardner *👻 silent*
   (red, **↗ Nudge**) — visibly different.

## The assignment cockpit (#54/#55)
Same seed. The cockpit is each board row's click-through, plus two off-board scenarios by URL:

1. Open **http://mill-dev:3000/admin/shift/shift-ar-claimed** → header shows trips + a mono
   **departs in Xd Xh** countdown; Petra's seat card is amber **Claimed** with *accepted — awaiting
   your confirm*. Tap **Confirm into seat** → green *"Petra confirmed into the seat"*, card turns
   green **Confirmed** with ✆ Call / ✉ Text links, badge flips to **Crewed**.
2. On any cockpit, tap **Warming signals →** (bottom) → the warming panel (#55) lists **Kettle**
   (*departs in ~4d · 1 seat unfilled · 50% answered · 1 silent*) — trending, deliberately NOT on
   the board. Tap its link → Kettle's cockpit: Dale *declined*, Tessa *👻 silent*, both nudgeable.
3. On Kettle, expand **Manual override…** on the seat card → tap **Place Marisol** → green
   *"Marisol placed by override — confirmed"*; the warming panel empties ("Nothing warming.").
4. Re-run `npm run db:seed:atrisk` to reset everything you just changed.

```bash
npm run db:tick          # run one engine tick by hand (DEC-023 — no scheduler in v1)
```
Prints the tick counters (asks fired, escalations, board landings). After a tick, refresh the
board: **Tidewater disappears too** — Tier-2 sent a direct nudge, so an ask is in flight again.
Re-running `db:seed:atrisk` resets all scenarios (it closes any in-flight engine asks).

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
