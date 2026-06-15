# Muster — Deploy Runbook (Vercel + Neon Postgres)

The **go-live** reference (Phase 5.1, DEC-033). Muster is a Next.js (App Router) app on **Vercel**,
talking to **Vercel-provisioned Postgres (Neon-backed)** via the `pg` driver — plain Postgres behind
the `Repository` port, so this is a hosting choice, not a rewrite. Local dev is unchanged
(`docs/RUNNING.md`); this is the *deploy* path.

> **This is a hosted _pilot_, not production.** What keeps it pilot-grade is the channel (#70: manual
> SMS relay, single hardcoded operator), **not** the database. Say so in any external comms.

---

## What's already wired (this PR — task 5.1)
- **`app/api/cron/tick/route.ts`** — the engine tick on a schedule (DEC-023 trigger). `nodejs`
  runtime, `CRON_SECRET` Bearer auth, calls `tick` then forwards fired asks to the outbox.
- **`vercel.json`** — `buildCommand: "next build --webpack"` (Next 16 defaults to Turbopack; the core's
  NodeNext `.js` specifiers need webpack — DEC-020) + the cron (`*/15 * * * *`).
- **`app/lib/repo.ts`** — pool tuned for serverless (small `max`, cold-start-tolerant timeout).

What's **yours** to do: provision the DB, set secrets, run migrations, deploy. The steps below.

---

## Environment variables

| Var | Where it comes from | Used for |
|-----|---------------------|----------|
| `DATABASE_URL` | **auto-injected** by the Neon integration — the **pooled** (PgBouncer) endpoint | app queries (`app/lib/repo.ts`) |
| `DATABASE_URL_UNPOOLED` | auto-injected — the **direct** endpoint | **migrations / seeds only** (DDL + long scripts break through PgBouncer) |
| `SESSION_SECRET` | **you set it** (`openssl rand -base64 32`) | magic-link session signing |
| `CRON_SECRET` | **you set it** (`openssl rand -base64 32`) | cron auth — Vercel sends it as `Authorization: Bearer …` |
| `APP_BASE_URL` | **you set it** — the real production origin (e.g. `https://muster.vercel.app`) | minting **delivered** magic links; MUST be set or (a) links are host-spoofable (`app/lib/base-url.ts`) and (b) **the cron silently enqueues outbox links pointing at `localhost`** — it runs with no request Host header, so the fallback is wrong there |
| `TENANT_TZ` | optional — defaults `America/New_York` (DEC-032) | vessel timezone; set explicitly if BrewBoat ever isn't Eastern |

---

## Steps

### 0. Create the Vercel project (one-time)
[vercel.com](https://vercel.com) → **Add New… → Project** → **Import** the `mobiustripper42/muster`
GitHub repo (authorize the Vercel GitHub app for the repo if it's the first import).
- **Framework preset:** Next.js (auto-detected). **Root directory:** repo root (`./`).
- **Build command:** leave it — `vercel.json` already pins `next build --webpack` (don't let the UI's
  default Turbopack build stick; the core's NodeNext specifiers need webpack, DEC-020).
- The import kicks off a first build from the default branch (`main`). **That build succeeds with no
  database** — `next build` is static compilation; nothing connects to Postgres until runtime. The
  deployed *pages* will error/`degraded` until you finish steps 1–2 and redeploy. That's expected.
- CLI alternative: `npm i -g vercel`, then `vercel link` in the repo.

> Do **step 4 (set Production Branch = `production`) before you rely on a prod deploy** — on import
> Vercel treats `main` as production; we want `production` to be the deploy pointer (DEC-S022).

### 1. Provision Postgres
In the **project** from step 0 → **Storage** → **Create Database** → **Neon** → follow the modal.
Billing stays in Vercel. This auto-injects `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct)
into the project's env for Production (and per-deployment for Preview).

### 2. Set the secrets
Dashboard → **Settings → Environment Variables** (or CLI `vercel env add <NAME> production`):
```
SESSION_SECRET   = <openssl rand -base64 32>
CRON_SECRET      = <openssl rand -base64 32>
APP_BASE_URL     = https://<your-vercel-domain>
# TENANT_TZ      = America/New_York   (optional; this is the default)
```
Env changes only apply to **new** deployments — redeploy after adding.

### 3. Run migrations (against the DIRECT endpoint)
PgBouncer (the pooled URL) discards session state between transactions and breaks DDL/prepared
statements — so migrate through `DATABASE_URL_UNPOOLED`:
```bash
vercel env pull .env.local                       # WRITES the vars to a FILE — not your shell
set -a; . ./.env.local; set +a                   # load them INTO this shell (the easy-to-miss step)
echo "$DATABASE_URL_UNPOOLED"                     # sanity: a postgres:// URL whose host has NO "-pooler"
DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:migrate
```
`db/migrate.ts` reads `DATABASE_URL`; we point it at the unpooled value just for this run.

> **Gotcha (you'll hit it otherwise):** `vercel env pull` only writes the `.env.local` *file* — it does
> **not** export into your shell. Skip the `source` line and `$DATABASE_URL_UNPOOLED` is empty, so
> `DATABASE_URL=""` falls through to `migrate.ts`'s **localhost** default → `ECONNREFUSED ::1:5432`.
> If the var is empty even after sourcing, check the actual name: `grep -iE 'postgres|database'
> .env.local` (Neon also injects the legacy `POSTGRES_URL_NON_POOLING` — same direct endpoint).

### 4. Configure the production branch
- Vercel project → **Settings → Git** → set the **Production Branch** to **`production`** (DEC-S022;
  `main` stays the active trunk, `production` is the deploy pointer advanced by `/promote-production`).
- Vercel auto-builds Preview deploys for every PR/branch and a Production deploy when `production`
  moves. The build command + cron come from `vercel.json`.

### 5. Deploy
Push `production` (or merge `main` → `production` via `/promote-production`). Vercel builds with
`next build --webpack` and registers the cron.

### 6. Smoke-check
```bash
# Source the pulled env so $CRON_SECRET is in this shell (step 3 wrote .env.local):
set -a; . ./.env.local; set +a

# a. Health — DB reachable + integrity clean
curl https://<domain>/api/health
#    → { status: "ok", db: { reachable: true }, integrity: { ok: true, violationCount: 0 } }

# b. Cron auth — a bare GET must be refused
curl -i https://<domain>/api/cron/tick            # → 401 Unauthorized

# c. Cron fires — with the secret, it ticks
curl -s https://<domain>/api/cron/tick -H "Authorization: Bearer $CRON_SECRET"
#    → { ok: true, at: "...", shiftsAdvanced: N, asksFired: N, ... }

# d. Unattended — wait for the :00/:15/:30/:45 mark; Vercel → project → Cron Jobs
#    shows the invocation. A fresh import + a wait should show asksFired > 0 on a
#    shift whose horizon just opened, with cards landing in /admin/outbox.
```

---

## Operating notes
- **The cron is the only autonomous mover.** Shift *state* is derived lazily on read; the cron only
  drives the outbound sends (firing asks). If it's wedged, the board still reads correctly — nothing
  gets *sent*. Check **Vercel → Cron Jobs** for invocation history + logs.
- **The `*/15` cadence needs a Pro plan.** Vercel **Hobby** silently throttles crons to **once a day**
  (and 2 jobs); Pro allows minute-level. Confirm the project is on Pro, or the engine only ticks daily.
- **Migrations are forward-only**, run by hand against the unpooled URL (step 3) per release that adds
  a `db/migrations/*.sql`. No auto-migrate on deploy (deliberate — a deploy never mutates schema
  silently).
- **`/api/health` `degraded`** = DB unreachable or a dangling reference (the no-FK integrity tripwire,
  DEC-DATA-1). Map it to a 503 at the edge / an uptime check.
- **Rollback** = redeploy a previous build from the Vercel dashboard (instant; the DB is unchanged
  unless a migration ran).

## Follow-ups (not blocking the pilot)
- `attachDatabasePool` from `@vercel/functions` closes idle connections before a function suspends —
  a connection-churn optimization worth adding if Neon shows connection pressure. One small dep; left
  out of the initial deploy to keep it dependency-clean.
- The `<VersionTag />` build-stamp (`templates/VersionTag.tsx`) can be wired into a layout so a
  deployed build shows its version/commit.
