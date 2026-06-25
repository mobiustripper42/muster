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
statements — so migrate through the **direct/unpooled** connection string.

**Get the string from the dashboard, NOT `vercel env pull`.** Neon marks its connection vars
**Sensitive**, and `vercel env pull` returns Sensitive vars **empty** (keys only) — pull-then-source
gives you `DATABASE_URL=""`, which falls through to `migrate.ts`'s localhost default →
`ECONNREFUSED ::1:5432`. So:

1. Vercel → **Storage** → your Neon DB → copy the **direct** connection string (host has **no**
   `-pooler`; in the Neon console it's the "Direct connection" / unpooled one). Or open the DB in the
   Neon console → Connection Details → toggle off pooling.
2. Run migrations with it inline (one-off; nothing persists the secret to disk):
   ```bash
   DATABASE_URL="<paste-direct-unpooled-string>" npm run db:migrate
   ```
`db/migrate.ts` reads `DATABASE_URL`; we hand it the direct value just for this run.

### 4. Configure the production branch
- Vercel project → **Settings → Git** → set the **Production Branch** to **`production`** (DEC-S022;
  `main` stays the active trunk, `production` is the deploy pointer advanced by `/promote-production`).
- Vercel builds a Production deploy when `production` moves, plus Preview deploys for PR/task
  branches — with two exceptions: `main` deploys are disabled in `vercel.json`
  (`git.deploymentEnabled`, #138) so the trunk never hits the prod DB; and an **Ignored Build Step**
  (Settings → Build & Deployment, `bash -c '[ -f package.json ] && exit 1 || exit 0'`) skips any
  branch with no `package.json`, so the orphan `sessions` log branch doesn't deploy. The build
  command + cron come from `vercel.json`.

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

### 7. Sign in as the operator (5.2, DEC-034)
`/crew/dev-link` is **hard-404 in production** (it must never mint links there), so the operator's
first sign-in is bootstrapped out-of-band. The script auto-sources `.env.local` (what step 3's
`vercel env pull` wrote), so once that file holds `APP_BASE_URL` + a DB string the command is just:
```bash
npm run db:mint -- --admin=spink
#  → Minted admin link · spink   (db: ep-xxx.neon.tech)
#      https://<domain>/crew/auth?t=<secret>
#      single-use · expires ... (60 min)
```
**The DB string is the catch.** Neon connection vars are **Sensitive**, so `vercel env pull` returns
`DATABASE_URL` *empty* (step 3) — `APP_BASE_URL` (not sensitive) pulls fine, but the DB string doesn't.
So either paste the **direct/unpooled** string into `.env.local` once (it's gitignored; survives until
the next `env pull` overwrites the file), or pass it inline — inline always wins:
```bash
DATABASE_URL="<paste-direct-unpooled-string>" npm run db:mint -- --admin=spink
```
**Check the `db:` host** in the output — if it reads `localhost:5432` you minted against the wrong
database (the DB string didn't take); a prod link must show the Neon host.

**On the dev box (mill-dev), don't edit `.env.local` for this.** Your `.env.local` points at *local*
dev (mill-dev origin + localhost DB), and inline env is one-shot — it never touches that file, so
there's nothing to restore afterward. Save a one-time alias and you get a clean second command:
```bash
echo 'postgres://<neon-direct-unpooled-string>' > ~/.muster-prod-db   # once; gitignored home file
# add this line to ~/.bashrc so it persists:
alias mint-prod='APP_BASE_URL=https://muster-sigma.vercel.app DATABASE_URL="$(cat ~/.muster-prod-db)" npm run db:mint --'
```
Then `mint-prod --admin=spink` mints a **prod** link, while plain `npm run db:mint -- --admin=spink`
still mints **local** — two commands, no editing, no switch-back. (Rarely needed: the sign-in cookie
lasts 14 days and renews on use, so it's a first-sign-in / long-gap thing.)

Open the printed URL in a browser → tap **Tap to sign in** → you land on **`/admin/at-risk`** with a
session cookie (a 14-day cookie that silently renews on use — you sign in once, not per visit). The link
is single-use and expires in 60 min (`--ttl-min=<n>` to change). `APP_BASE_URL` is **required** — the
script refuses without it (a CLI has no Host header, and a link on the wrong origin is host-spoofable /
unopenable). **Crew** need none of this: their links flow through the DEC-030 outbox relay
(`--crew=<id>` exists as a manual escape hatch, not the normal path).

---

## Importing reservations (operator — 5.4a, DEC-037)
The board is fed from the Xola Reservations export. In Xola: **Reports → Reservations**, set the date
range to **Leading Year**, export the `.xlsx`, then upload it at **`/admin/import`** (admin sign-in
required). Upload → the board fills with upcoming trips + their crew seats.

- **Why Leading Year (every time).** That report filters by **booking date**, not trip date — so to
  capture every *upcoming* trip you need every booking *made* over a long span. Leading Year covers
  anyone who booked in the last ~12 months, i.e. essentially all your upcoming trips. A short/recent
  range would silently miss a trip booked months ago. A *forward* range makes no sense here (you
  can't book in the future).
- **Re-import freely.** It's idempotent — keyed on the Xola `Reservation ID` — so re-uploading the
  same week **updates in place, never duplicates**. Re-run before each crew weekend and whenever
  bookings change.
- **Cancellations propagate.** A cancelled booking exports as a `Cancelled` row; the import marks it
  cancelled, and a trip whose *every* booking has cancelled has its shift **auto-cancelled** (crew
  aren't asked for a dead trip).
- **Caveats.** A trip booked **more than a year ahead** falls outside Leading Year (rare for day
  trips — widen the range if it happens). And a trip that simply **vanishes** from the export isn't
  cleaned up — only one that appears as `Cancelled` is (DEC-037) — so keep using the same Leading-Year
  range rather than narrowing it. Skipped rows (unmapped product / bad date) are counted on the result
  and logged server-side (Vercel function logs) for the dev — an unmapped product needs a code change
  to `product-map.ts`, not an operator action.

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
