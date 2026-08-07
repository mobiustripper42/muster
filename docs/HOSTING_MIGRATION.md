# Muster — Vercel → VPS migration runbook

**What this is:** the step-by-step procedure for moving Muster's origin from Vercel to a VPS.
Public hostname `crew.brewcle.com` does not change — only the origin behind Cloudflare moves.

**Source of intent:** `docs/hosting-migration-handoff.md` (the handoff, unmodified).
**Audit backing:** `docs/audit/2026-08-07-cutover-phase-a.md` (Phase A, complete, verdict GO).

**How to use it:** steps are numbered continuously. Work top to bottom. Each step is either a
command to run, a value to record, or a decision to make. `⟳` marks a rollback point.
Infrastructure only — no refactoring.

**Record values as you go** in a scratch file on your machine (never committed):

```
BOX_IP=            NODE_VERSION=        CRON_SECRET=
BOX_HOST=          APP_BASE_URL=https://crew.brewcle.com
```

---

## Pre-flight decisions

### D1 — Which box? (blocks step 12)

The handoff specifies **Linode Shared 4 GB, Chicago (us-ord)** + backups, Vultr Chicago as the
approved swap. But it also references an existing **Hetzner CCX23** ($39.99, must never be
rescaled — a resize re-prices it to $102.99) and a **Netcup** box whose snapshot export is
"thin." `docs/RUNNING.md` says `mill-dev` is itself a VPS reached over Tailscale.

**Decide before step 12:** new Linode, or reuse an existing box.

Reuse only if the box has ≥4 GB RAM, ≥10 GB free disk, and nothing else on it that matters. Do
**not** co-locate prod on `mill-dev` — a dev box that gets rebooted and experimented on is not a
production origin, and you would lose the ability to break dev freely.

Default if undecided: **new Linode.** Clean slate, no shared blast radius, backups included.

### D2 — Neon's Vercel dependency (blocks step 63, not before)

The Neon project (`delicate-art-65084110`, org `org-spring-feather-31353161`) lives **inside
Vercel's managed org** — Vercel owns the billing relationship and the console access path
(`docs/DEPLOY.md` step 1: *"Billing stays in Vercel"*). So "decommission Vercel" cannot happen
while the database lives there.

Two paths:

- **(a) Migrate the DB to a Neon account you own** — `pg_dump` → restore into a new project →
  repoint. This is the same operation as the restore drill (steps 50–56), so it doubles as the DR
  rehearsal. **Recommended.**
- **(b) Keep a Vercel account alive** purely as the Neon billing shell, indefinitely. Simpler
  today, leaves the dependency in place forever.

**Not answerable from the repo:** whether the existing project can be *transferred* out of
Vercel's org instead of dump-and-restored. Ask Neon support (step 4). If transfer is offered, it
beats both paths.

⚠️ **If you pick (a), read step 63's warning before doing it.** Migrating the DB while Vercel is
still your rollback target silently breaks the rollback.

---

## Phase B — Answer the open questions (no changes yet)

Do these from a CLI session on `mill-dev` with `/mcp` authorized (both `neon` and `vercel` in
`.mcp.json` are remote/OAuth; a non-interactive session cannot authorize them).

**1.** Start a CLI session and run `/mcp`. Authorize **neon** and **vercel** in the browser.
One-time per machine.

**2.** **Export every production env var from Vercel.** ~22 values exist in the dashboard that
`docs/DEPLOY.md` never recorded. This is the single easiest thing to lose in the whole migration.
Save them to your scratch file.

> `vercel env pull` returns **Sensitive** vars (the Neon connection strings) **empty** — keys
> only. Copy those from the Neon console by hand.

**3.** Record from Vercel: the **Node major version** the project builds on, and the **plan tier**.

**4.** From the Neon console or MCP, record:
   - `select filename from _migrations order by filename;` against `delicate-art-65084110`
   - The **PITR retention window** on the current plan — this is a go-live gate (step 51) and is
     not answerable from the repo
   - Whether the project can be transferred out of the Vercel-managed org (D2)

**5.** Confirm which feature flags are ON in production: `CREW_SELF_SERVE`, `MESSAGING`,
`RESERVATIONS`. All three are OFF by default in code. `MESSAGING` decides whether the
2-minute doorbell timer (step 42) is doing anything at all.

**6.** Decide **D1**. If reusing a box, record its specs and confirm the free disk.

---

## Phase C — Code fixes (three small PRs, main branch)

None of these block provisioning; all three are cheap and reduce cutover risk.

**7.** **Pool sizing.** `app/lib/repo.ts` sets `max: 5` — correct for many warm serverless
instances, wrong for one long-lived `next start` process where it becomes the whole app's
ceiling. Raise to 10–20. Keep the pooled (`-pooler`) endpoint.

**8.** **Health-route pool.** `app/api/health/route.ts` builds a fresh `pg.Pool` per request and
`end()`s it. Fine on serverless, connection churn on a long-lived server, and the endpoint is
unauthenticated. Use the shared pool from `app/lib/repo.ts`.

**9.** **Pin Node.** Add `.nvmrc` and an `engines` field to `package.json`, matching step 3.
There is currently no pin of any kind. (Verified building on v22.22.2.)

**10.** *Optional, decide separately:* set `output: 'standalone'` in `next.config.ts`. Produces a
self-contained server directory instead of needing the full 662 MB `node_modules` on the box.
Simplifies deploys; changes the deploy mechanism, so decide before step 25.

**11.** `docs/DEPLOY.md`'s "Importing reservations" section still describes the xlsx upload that
DEC-043 retired. Unrelated to hosting, but it's the doc you'll be reading during Phase E. Fix or
delete it.

---

## Phase D — Provision the box (Vercel still serving production)

**12.** Provision per **D1**. If new: Linode Shared 4 GB, Chicago (us-ord), **enable backups**.
Record `BOX_IP`.

**13.** Base hardening: non-root user with sudo, SSH key auth only, password auth off, firewall
allowing **only** 22 + 80 + 443.

**14.** Install Node at the version from step 3. Install `git`, `curl`, `postgresql-client`
(needed for `pg_dump` in Phase G).

**15.** Add the box to Tailscale if you want a private path for smoke-testing (step 33) and
admin CLI work. Optional but convenient.

**16.** Install Caddy.

**17.** Create the Cloudflare **Origin CA certificate** for `crew.brewcle.com` in the Cloudflare
dashboard. 15-year validity. Save cert + key to the box, root-owned, mode `600`.

> This cert is the reason for the migration — no renewal, so no renewal-through-proxy failure.

**18.** Configure Caddy: serve `crew.brewcle.com` with `tls <cert> <key>`, **auto-HTTPS off**,
reverse-proxy to `127.0.0.1:3000`.

**19.** Confirm Cloudflare SSL/TLS mode is **Full (Strict)**. It should already be.

---

## Phase E — Build and run

**20.** Clone the repo to the box. Check out `production`.

**21.** Write the env file. Every value from step 2, **plus**:
   - `APP_BASE_URL=https://crew.brewcle.com` ← the app throws in production without it
   - `NODE_ENV=production` ← see step 27
   - `DATABASE_URL` = the Neon **pooled** (`-pooler`) string

**22.** ⚠️ **Build-time vars must be present when `next build` runs**, not just at runtime:
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — missing ⇒ checkout renders "Checkout is not
     configured"
   - `NEXT_PUBLIC_APP_VERSION` — injected automatically from `package.json`, no action
   - `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` — Vercel-only, absent here; `<VersionTag />` just drops
     the sha. Optionally set from `git rev-parse --short HEAD`

**23.** `npm ci`

**24.** `npm run build`

> Measured peak RSS: **1,017 MB** on a cold build. Fits 4 GB comfortably — do **not** use the
> rsync-`.next` contingency. If it OOMs anyway, add swap or
> `NODE_OPTIONS=--max-old-space-size=3072`.
>
> The build fetches IBM Plex from Google at build time (`next/font/google` in `app/layout.tsx`),
> so the box needs outbound HTTPS to `fonts.googleapis.com` / `fonts.gstatic.com`.

**25.** Create the systemd unit for the app: `next start -p 3000 -H 127.0.0.1`.

> **`-H 127.0.0.1`, never `0.0.0.0`.** Caddy is the only thing that should face the network.

**26.** The unit must set `NODE_ENV=production` and load the env file. `Restart=always`.

**27.** ⚠️ **Verify `NODE_ENV=production` is actually in effect.** Without `VERCEL_ENV` present,
`isProdDeploy()` (`app/lib/flags.ts`) falls through to `!VERCEL_ENV && NODE_ENV === "production"`.
If `NODE_ENV` is missing, **`/crew/dev-link` becomes a live unauthenticated magic-link minter on
the public origin.** `next start` sets it itself, but set it explicitly anyway.

Check: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/crew/dev-link` → **404**.
Anything else, stop and fix before going further.

**28.** `systemctl enable --now` the unit. Confirm it survives a reboot.

---

## Phase F — Smoke test the box before any DNS change

Vercel is still the live origin throughout this phase.

**29.** `curl http://127.0.0.1:3000/api/health` → `{"status":"ok","db":{"reachable":true},…}`.
`degraded` means the Neon connection is wrong.

**30.** Hit the box through Caddy with a Host-header override:
`curl -k --resolve crew.brewcle.com:443:<BOX_IP> https://crew.brewcle.com/api/health`

**31.** Cron auth is fail-closed. Bare GET must be refused:
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/cron/tick` → **401**

**32.** With the secret, it ticks:
`curl -s http://127.0.0.1:3000/api/cron/tick -H "Authorization: Bearer $CRON_SECRET"` →
`{"ok":true,…}`

**33.** Load a real page over Tailscale or the `--resolve` trick. Confirm it renders and reads
from Neon. Check `/admin/at-risk` and `/crew`.

**34.** Confirm no data was written that shouldn't be — the tick in step 32 is idempotent and
guard-railed, but it **can fire real asks** if a shift's horizon just opened. If that's a
concern, pause the engine from `/admin` first and unpause after.

---

## Phase G — Scheduled jobs as systemd timers

**35.** There are **two** scheduled jobs, not three:

| Path | Schedule | Notes |
|------|----------|-------|
| `/api/cron/tick` | every 15 min | the engine tick |
| `/api/cron/doorbell-tick` | every 2 min | inert unless `MESSAGING=1` |

**36.** ⚠️ **`/api/cron/xola-pull` gets NO timer.** Its schedule was deliberately removed
(`13d3fb5`); imports are operator-driven from the "Pull from Xola now" button. Its own header
says *"NO CRON IS ATTACHED, AND NONE IS COMING."* Do not add one.

**37.** Write two systemd **service + timer** pairs. Each service curls
`http://127.0.0.1:3000/api/cron/<name>` with `Authorization: Bearer $CRON_SECRET`.

> Direct to loopback — no round-trip through Cloudflare to poke your own process.

**38.** Put `CRON_SECRET` in a root-owned `600` env file the units read. Never in the unit file
itself (unit files are world-readable).

**39.** `systemctl enable --now` both timers. Verify with `systemctl list-timers`.

**40.** Confirm invocations land: `journalctl -u <unit> -f`. Wait for one real firing of each.

**41.** Both jobs no-op when the engine is paused and are idempotent, so a missed or doubled
firing is safe.

**42.** If `MESSAGING` is off (step 5), the doorbell timer will run and do nothing. That's fine —
install it anyway so the flag works when flipped.

---

## Phase H — Disaster recovery (blocks go-live)

The database is the **sole durable record of booking truth**. Stripe has the charge, never the
booking — party size, date, guest contact live only in Postgres. Do not skip this phase.

**43.** Confirm the Neon **PITR retention window** from step 4 is long enough to notice a problem
before it rolls off. If it isn't, raise the plan.

**44.** Set up an **independent** nightly `pg_dump` to object storage you control (B2/S3) — not
dependent on Neon. Run it from the box or from `mill-dev`.

**45.** Use the **direct/unpooled** Neon endpoint for dumps. PgBouncer breaks long sessions.

**46.** Monitor backup **health**, not just backup existence: did last night's dump land, is it
non-trivially sized. Use the ntfy pattern already in `ops/site-monitor/`.

**47.** Wire an alert for a **missed** dump. An unmonitored backup is a rumor.

**48.** Add `/api/health` to your monitoring. It returns `degraded` on an unreachable DB, which is
also how you'd detect the box losing its Neon credential (the box holds a copy, not a live
binding — nothing re-injects it the way Vercel did).

### The go-live drill — both must be green

**49.** Spin a Neon **branch** from a timestamp 10 minutes ago. Confirm reservations are present.
Proves PITR works *for your data*, not in theory.

**50.** Take last night's `pg_dump`, load it into a throwaway Postgres, count rows. Proves the
dump is restorable.

**51.** ⚠️ **Green on both, or stop.** No real booking is taken until this passes once, witnessed.

**52.** If you chose **D2 path (a)**, do the Neon account migration now — steps 49–50 *are* the
rehearsal, so run it for real: new Neon project you own → dump → restore → verify row counts →
repoint `DATABASE_URL` on the box. Requires a brief write freeze (stop the app, dump, restore,
repoint, start). Minutes at current volume. **Then read step 63.**

---

## Phase I — The flip

**53.** Lower the Cloudflare DNS TTL for `crew.brewcle.com` **ahead of time** — hours before, not
minutes. Wait for the old TTL to expire.

**54.** ⟳ **Rollback point.** Everything up to here is reversible by doing nothing.

**55.** In Cloudflare, repoint `crew.brewcle.com` from Vercel to `BOX_IP` — **A record, proxied
(orange cloud)**. SSL/TLS stays **Full (Strict)**. The public certificate stays Cloudflare's, so
there is no public-side cert change.

**56.** Verify on the real hostname:
   - `https://crew.brewcle.com/api/health` → `ok`
   - A crew magic-link SMS arrives **and its link opens** (this is what `APP_BASE_URL` protects —
     a wrong value dead-links to localhost)
   - `/crew/dev-link` → **404**
   - Sign in as admin, load `/admin/at-risk`
   - Both cron timers fire on schedule (`journalctl`)

**57.** If `RESERVATIONS` is on: verify the Stripe webhook. It HMACs the **raw body**, not the
URL, so nothing needs re-pointing — but confirm a test event reaches
`/api/webhooks/stripe` and returns 200.

**58.** ✅ **There are no inbound Twilio webhooks.** No status callback, no inbound SMS. Twilio is
outbound-only; crew answer via a web link. Nothing to re-point, nothing to verify beyond step 56.

**59.** Watch with the residential probe and monitors already in `ops/`.

**60.** ⟳ **Rollback:** flip the Cloudflare A record back to Vercel. Vercel is untouched and still
building from `production`.

---

## Phase J — Rollback window, then decommission

**61.** Leave the Vercel deployment **intact** for several days of stable operation. It is your
instant rollback.

**62.** ⚠️ **Never rescale the old Hetzner CCX23 during this window** — a resize re-prices it from
$39.99 to $102.99.

**63.** ⚠️ **If you migrated Neon (step 52), the rollback is now broken until you fix it.**

Vercel's auto-injected `DATABASE_URL` still points at the **old** database. Flipping back would
serve stale data — bookings taken on the box since the migration would simply be absent, and
**nothing would error**.

**Fix immediately after step 52:** manually override `DATABASE_URL` in the Vercel project's env
to the new Neon pooled string, then **redeploy** (Vercel env changes only apply to new
deployments). Both origins then read the same database and rollback stays real.

**64.** Once stable and the rollback window has closed: decommission Vercel. Confirm first that
nothing else depends on the account — **including the Neon project**, if you chose D2 path (b).

**65.** After decommissioning, `docs/DEPLOY.md` describes a topology that no longer exists.
Rewrite it or mark it superseded by this document. Two live runbooks describing incompatible
topologies is how someone follows the wrong one at 11pm.

**66.** `vercel.json` becomes documentation only. Its `crons` and `git.deploymentEnabled` no
longer apply. Leave it until step 64 is done — it's part of the rollback path.

---

## Unchanged by this migration

- **Migrations are still applied by hand, out-of-band**, against the **direct/unpooled** endpoint.
  They were never part of the Vercel deploy. Apply to prod *before* promoting code that needs
  them.
- **`main` → `production`** stays the promotion path.
- Cookie flags, the service worker, and Cloudflare behaviour all need no changes (Phase A §6).

## Known watch item

Cloudflare's proxy request timeout (~100 s) applies to `/admin/import`'s "Pull from Xola now" — a
paginated loop with retries (`src/import/xola-client.ts`), no `maxDuration` set. It fits inside
Vercel's function limit today so it should fit Cloudflare's. If it bites, the fix is to run the
pull off the request (an authenticated `127.0.0.1` call, same shape as the timers), not to chase
a timeout setting.
