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
BOX_IP=              NODE_VERSION=        CRON_SECRET=
NEON_NEW_POOLED=     NEON_NEW_DIRECT=     NEON_OLD_DIRECT=
APP_BASE_URL=https://crew.brewcle.com
```

> Secrets in this file are recorded **by you, by hand**. Don't ask an agent session to read
> connection strings, keys or `CRON_SECRET` — a value read into a transcript is a copy of the
> credential somewhere nobody is guarding.

---

## Decisions (settled)

- **Host:** new **Linode Shared 4 GB, Chicago (us-ord)** with backups. Not a reused box, not
  `mill-dev`.
- **Database:** Neon stays as the provider, but the project **moves out of Vercel's managed org**
  into a **new Neon account you own** — not the existing `spinkbickle@gmail.com` org, which is on
  the free plan.
- **The Vercel account stays.** Other projects deploy from it. What gets decommissioned at the end
  of this migration is the **muster project** on Vercel, not the account. Read every later mention
  of "decommission Vercel" that way.
- **The database move is dump-and-restore.** Neon does not support project transfer out of a
  Vercel-managed org, and the claim-link path does not apply either (step 6, answered
  2026-08-11). Steps 12–18 are mandatory.

### Why the database moves first

The Neon project (`delicate-art-65084110`, org `org-spring-feather-31353161`) lives inside
Vercel's managed org — Vercel owns the billing relationship and the console access path
(`docs/DEPLOY.md` step 1: *"Billing stays in Vercel"*). Since the account is staying, this is no
longer a blocker to finishing the migration; it is an ownership decision, made deliberately. The
database is the sole durable record of booking truth and it should not sit behind another
product's billing relationship.

The handoff put this late, which creates a trap: migrate the database while Vercel is still your
rollback target, and Vercel's auto-injected `DATABASE_URL` still points at the **old** database.
Rolling back would then serve stale data — bookings taken since the migration simply absent, and
**nothing errors**.

**Doing it first removes the trap rather than managing it.** Vercel gets repointed while it is
still the only origin and the change is easy to reverse; the box is then built against the
database it will keep forever; and the restore drill — a go-live gate either way — happens early
enough to change the plan if it fails.

---

## Phase B — Reads and answers (no changes)

From a CLI session on `mill-dev`. Both `neon` and `vercel` in `.mcp.json` are remote/OAuth, so a
non-interactive session cannot authorize them.

**1.** Run `/mcp`. Authorize **neon** and **vercel** in the browser. One-time per machine.

**2.** **Reassemble the production env — you cannot export it.** `vercel env pull` prints
`[Sensitive]` in place of the values, so there is no export step; every secret has to come from
the system that issued it. The single easiest thing to lose in this migration.

The list below is **every var the code actually reads in production**, taken from `process.env.*`
across `app/`, `src/` and `db/` — so it is checkable against the repo rather than against a
dashboard scroll. Tick each one off against its source.

| Var | Read at | Source of truth |
|---|---|---|
| `DATABASE_URL` | `app/lib/repo.ts` | Neon console (pooled). Becomes `NEON_NEW_POOLED` after Phase D |
| `APP_BASE_URL` | `app/lib/base-url.ts` | `https://crew.brewcle.com` — app throws in prod without it (step 39) |
| `SESSION_SECRET` | `app/lib/auth.ts` | Unrecoverable — **mint fresh**. Rotating it logs everyone out |
| `RESERVATION_LINK_SECRET` | `app/reservations/manage/load.ts` | ⚠️ **Do NOT regenerate** — signs guest manage-booking links already sent. Must carry over |
| `CRON_SECRET` | `app/api/cron/*/route.ts` | Mint fresh; goes in the timer env file too (step 55) |
| `STRIPE_SECRET_KEY` | `app/api/webhooks/stripe/route.ts` | Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `app/api/webhooks/stripe/route.ts` | Stripe dashboard → the endpoint's signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `app/(public)/book/checkout/page.tsx` | Stripe. **Build-time** — see step 40 |
| `TWILIO_ACCOUNT_SID` | `app/lib/sms.ts` | Twilio console |
| `TWILIO_AUTH_TOKEN` | `app/lib/sms.ts` | Twilio console |
| `TWILIO_FROM` | `app/lib/sms.ts` | Twilio console |
| `TWILIO_MESSAGING_SERVICE_SID` | `app/lib/sms.ts` | Twilio console |
| `RESEND_API_KEY` | `app/lib/auth-delivery.ts` | Resend dashboard |
| `EMAIL_FROM` | `app/lib/auth-delivery.ts` | Not secret — the sending address |
| `XOLA_API_KEY` | `app/lib/xola.ts` | Xola |
| `XOLA_SELLER_ID` | `app/lib/xola.ts` | Xola |
| `XOLA_API_BASE` | `app/lib/xola.ts:31` | Optional — falls back to `XOLA_API_BASE_DEFAULT` in code |
| `XOLA_API_VERSION` | `app/lib/xola.ts:32` | Optional — falls back to the code constant |
| `TENANT_ID` / `TENANT_NAME` | `app/lib/tenant.ts` | Not secret |
| `TENANT_TZ` | `src/config/tenant.ts` | Not secret. Getting this wrong moves every departure time |
| `PICKUP_LOCATION` / `PICKUP_MAP_URL` | `src/config/tenant.ts` | Not secret |
| `WAIVER_TERMS_URL` / `WAIVER_TERMS_VERSION` | `src/config/tenant.ts` | Not secret. The version is recorded on signed waivers — carry it over, don't invent one |
| `PAY_PERIOD_ANCHOR` | `src/config/tenant.ts` | Not secret |
| `CHECKOUT_HOLD_MINUTES` | `src/reservations/claim.ts` | Not secret |
| `OPERATOR_CREW_MEMBER_ID` | `app/lib/operator.ts` | Not secret |
| `OPERATOR_NOTIFY_EMAIL` | `app/reservations/manage/actions.ts` | Not secret |
| `NODE_ENV` | — | `production`. See step 45; getting this wrong is a security hole |
| `CREW_SELF_SERVE` `MESSAGING` `RESERVATIONS` `TIME_CLOCK` | `app/lib/flags.ts` | Step 5 |

> Not needed on the box: `E2E`, `E2E_PROD`, `SEED_TODAY`, `TEST_DATABASE_URL`, `RESET_PILOT_*`,
> `BACKFILL_CONFIRM`, `OUTBOX_TEST_PHONE`, `XOLA_REPORT_*` (CLI script args), `PROBE_*`
> (`ops/site-monitor/`, runs elsewhere), `VERCEL_ENV` (absent by design — step 45 depends on it
> being absent).

> ⚠️ **`RESERVATION_LINK_SECRET` and `SESSION_SECRET` behave differently.** Losing the session
> secret costs everyone a re-login. Losing the reservation link secret **dead-links every
> manage-booking URL already in a guest's inbox**, with no way to reissue them.

**3.** Record from Vercel: the **Node major version** the project builds on, and the plan tier.

**4.** Record from Neon:
   - `select filename from _migrations order by filename;` against `delicate-art-65084110` —
     **read 2026-08-11: 45 rows, `0001_init.sql` … `20260806230000_retire_muster_owned_vessel_days.sql`.**
     `db/migrations/` holds **46**. The one not applied in production is
     **`20260810011500_payment_intent_lookup.sql`** (the refund lookup index). Apply it by hand
     before promoting the code that needs it — see § Unchanged by this migration
   - The **PITR retention window** on the current plan — **answered 2026-08-11: 24 hours**
     (`history_retention_seconds: 86400`, org on the `launch` plan). See step 22; this is short.
   - Both connection strings for the current project — pooled and **direct/unpooled**. Save the
     direct one as `NEON_OLD_DIRECT`. **Copy these yourself from the Neon console.**

**5.** Confirm which feature flags are ON in production: `CREW_SELF_SERVE`, `MESSAGING`,
`RESERVATIONS`. All three are OFF by default in code. `MESSAGING` decides whether the 2-minute
doorbell timer does anything at all.

**6.** ✅ **Answered 2026-08-11 — no transfer.** The Neon console's *Transfer project* control is
disabled for this project: *"Project transfers are not currently supported for Vercel-managed
organizations."* The claim-link path does not apply either. **Steps 12–18 are mandatory** — the
move is a dump-and-restore. Nothing to do here; kept for the record.

---

## Phase C — Code fixes (three small PRs to `main`, then promote)

None of these block anything. All are cheap and reduce cutover risk. Land them now so the box
clones a `production` that already has them.

**7.** **Pool sizing.** `app/lib/repo.ts` sets `max: 5` — correct for many warm serverless
instances, wrong for one long-lived `next start` process where it becomes the whole app's
ceiling. Raise to 10–20. Keep the pooled (`-pooler`) endpoint.

**8.** **Health-route pool.** `app/api/health/route.ts` builds a fresh `pg.Pool` per request and
`end()`s it. Fine on serverless, connection churn on a long-lived server, and the endpoint is
unauthenticated. Use the shared pool from `app/lib/repo.ts`.

**9.** **Pin Node.** Add `.nvmrc` and an `engines` field to `package.json`, matching step 3.
There is currently no pin of any kind. (Verified building on v22.22.2.)

**10.** *Optional:* set `output: 'standalone'` in `next.config.ts` — produces a self-contained
server directory instead of needing the full 662 MB `node_modules` on the box. Decide before
step 30.

**11.** `docs/DEPLOY.md`'s "Importing reservations" section still describes the xlsx upload that
DEC-043 retired. Fix or delete it — it's a doc you'll be reading during Phase F.

---

## Phase D — Move Neon out of Vercel (Vercel still serving production)

Mandatory — step 6 established there is no transfer path.

**12.** Create a **new Neon account** — your login, your billing, no Vercel. Create a project in
it, region matching the current one (**`aws-us-east-1`**, Postgres **17**).

> **Pick the plan against step 22, not the default.** The current project's retention is 24 hours
> and the free tier is no better. Retention is the one setting that cannot be fixed after you need
> it.

**13.** Record `NEON_NEW_POOLED` (host contains `-pooler`) and `NEON_NEW_DIRECT`.

**14.** **Dry run first, with production still live.** Dump from `NEON_OLD_DIRECT`, restore into
`NEON_NEW_DIRECT`, compare row counts on `reservations`, `crew_members`, `shifts`, `_migrations`.
Nothing is repointed yet — this only proves the mechanism.

> Use the **direct/unpooled** endpoint on both sides. PgBouncer breaks long sessions and DDL.

**15.** Fix whatever the dry run surfaced. Repeat until clean.

**16.** ⟳ **Rollback point.** Nothing has changed yet.

**17.** **The real move.** Pick a low-traffic window:
   1. Pause the engine from `/admin` (stops asks firing mid-move)
   2. Put the app into a state where no writes land — the practical version is a brief window
      where nobody is using it, not a maintenance mode the app doesn't have
   3. Dump from `NEON_OLD_DIRECT`
   4. Restore into `NEON_NEW_DIRECT`
   5. Verify row counts match, and that `_migrations` matches step 4's ledger exactly

**18.** **Repoint Vercel to the new database.** Set `DATABASE_URL` (pooled) and
`DATABASE_URL_UNPOOLED` (direct) explicitly in the Vercel project's env, overriding the
auto-injected values. **Redeploy** — Vercel env changes only apply to new deployments.

**19.** Verify production on `crew.brewcle.com` is reading the new database: `/api/health` → `ok`,
load `/admin/at-risk`, confirm today's shifts look right. Unpause the engine.

**20.** ⟳ **Rollback:** set `DATABASE_URL` back to the old Neon project and redeploy. The old
database is untouched and still live.

**21.** **Leave the old Neon project running** until the whole migration is finished. It is your
database-level rollback. Do not delete it at any point before step 68.

---

## Phase E — Disaster recovery (blocks go-live)

The database is the **sole durable record of booking truth**. Stripe has the charge, never the
booking — party size, date, guest contact live only in Postgres.

**22.** Confirm the new project's **PITR retention window** is long enough to notice a problem
before it rolls off. Raise the plan if not. For reference, the **old** project's window is 24
hours — a bad Saturday write is unrecoverable by Sunday afternoon.

**23.** Set up an **independent** nightly `pg_dump` to object storage you control (B2/S3) — a copy
that does not depend on Neon being reachable or solvent. Run it from `mill-dev` for now; move it
to the box after step 30 if you prefer.

**24.** Dumps use the **direct/unpooled** endpoint.

**25.** Monitor backup **health**, not just existence: did last night's dump land, is it
non-trivially sized. Use the ntfy pattern already in `ops/site-monitor/`.

**26.** Alert on a **missed** dump. An unmonitored backup is a rumor.

### The go-live drill — both must be green

**27.** Spin a Neon **branch** from a timestamp 10 minutes ago. Confirm reservations are present.
Proves PITR works for your data, not in theory.

**28.** Take last night's dump, load it into a throwaway Postgres, count rows. Proves the dump is
restorable.

**29.** ⚠️ **Green on both, or stop.** No real booking is taken until this passes once, witnessed.

---

## Phase F — Provision the box (Vercel still serving production)

**30.** Provision **Linode Shared 4 GB, Chicago (us-ord)**, **backups enabled**. Record `BOX_IP`.

**31.** Base hardening: non-root user with sudo, SSH key auth only, password auth off, firewall
allowing **only** 22 + 80 + 443.

**32.** Install Node at the version from step 3. Install `git`, `curl`, `postgresql-client`.

**33.** Add the box to Tailscale — gives you a private path for smoke-testing and admin CLI work.

**34.** Install Caddy.

**35.** Create the Cloudflare **Origin CA certificate** for `crew.brewcle.com` in the Cloudflare
dashboard. 15-year validity. Save cert + key to the box, root-owned, mode `600`.

> This cert is the reason for the migration — no renewal, so no renewal-through-proxy failure.

**36.** Configure Caddy: serve `crew.brewcle.com` with `tls <cert> <key>`, **auto-HTTPS off**,
reverse-proxy to `127.0.0.1:3000`.

**37.** Confirm Cloudflare SSL/TLS mode is **Full (Strict)**. It should already be.

---

## Phase G — Build and run

**38.** Clone the repo to the box. Check out `production`.

**39.** Write the env file. Every value from step 2, **plus**:
   - `APP_BASE_URL=https://crew.brewcle.com` ← the app throws in production without it
   - `NODE_ENV=production` ← see step 45
   - `DATABASE_URL=$NEON_NEW_POOLED`

**40.** ⚠️ **Build-time vars must be present when `next build` runs**, not just at runtime:
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — missing ⇒ checkout renders "Checkout is not
     configured"
   - `NEXT_PUBLIC_APP_VERSION` — injected automatically from `package.json`, no action
   - `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` — Vercel-only, absent here; `<VersionTag />` just drops
     the sha. Optionally set from `git rev-parse --short HEAD`

**41.** `npm ci`

**42.** `npm run build`

> Measured peak RSS: **1,017 MB** on a cold build. Fits 4 GB comfortably — do **not** use the
> rsync-`.next` contingency. If it OOMs anyway, add swap or
> `NODE_OPTIONS=--max-old-space-size=3072`.
>
> The build fetches IBM Plex from Google (`next/font/google` in `app/layout.tsx`), so the box
> needs outbound HTTPS to `fonts.googleapis.com` / `fonts.gstatic.com`.

**43.** Create the systemd unit for the app: `next start -p 3000 -H 127.0.0.1`.

> **`-H 127.0.0.1`, never `0.0.0.0`.** Caddy is the only thing that should face the network.

**44.** The unit sets `NODE_ENV=production`, loads the env file, `Restart=always`.

**45.** ⚠️ **Verify `NODE_ENV=production` is actually in effect.** Without `VERCEL_ENV` present,
`isProdDeploy()` (`app/lib/flags.ts`) falls through to `!VERCEL_ENV && NODE_ENV === "production"`.
If `NODE_ENV` is missing, **`/crew/dev-link` becomes a live unauthenticated magic-link minter on
the public origin.**

Check: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/crew/dev-link` → **404**.
Anything else, stop and fix before going further.

**46.** `systemctl enable --now` the unit. Reboot the box and confirm it comes back up on its own.

---

## Phase H — Smoke test before any DNS change

Vercel is still the live origin throughout.

**47.** `curl http://127.0.0.1:3000/api/health` → `{"status":"ok","db":{"reachable":true},…}`.
`degraded` means the connection string is wrong.

**48.** Through Caddy with a Host override:
`curl -k --resolve crew.brewcle.com:443:<BOX_IP> https://crew.brewcle.com/api/health`

**49.** Cron auth is fail-closed. Bare GET must be refused:
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/cron/tick` → **401**

**50.** With the secret: `curl -s http://127.0.0.1:3000/api/cron/tick -H "Authorization: Bearer
$CRON_SECRET"` → `{"ok":true,…}`

> This **can fire real asks** if a shift's horizon just opened. Pause the engine from `/admin`
> first if that's a concern, and unpause after.

**51.** Load real pages over Tailscale: `/admin/at-risk` and `/crew`. Confirm they render and read
from Neon.

---

## Phase I — Scheduled jobs as systemd timers

**52.** There are **two** scheduled jobs, not three:

| Path | Schedule | Notes |
|------|----------|-------|
| `/api/cron/tick` | every 15 min | the engine tick |
| `/api/cron/doorbell-tick` | every 2 min | inert unless `MESSAGING=1` |

**53.** ⚠️ **`/api/cron/xola-pull` gets NO timer.** Its schedule was deliberately removed
(`13d3fb5`); imports are operator-driven from the "Pull from Xola now" button. Its own header says
*"NO CRON IS ATTACHED, AND NONE IS COMING."*

**54.** Write two systemd **service + timer** pairs. Each curls
`http://127.0.0.1:3000/api/cron/<name>` with `Authorization: Bearer $CRON_SECRET`.

> Direct to loopback — no round-trip through Cloudflare to poke your own process.

**55.** `CRON_SECRET` goes in a root-owned `600` env file the units read. **Never in the unit file
itself** — unit files are world-readable.

**56.** `systemctl enable --now` both timers. Verify with `systemctl list-timers`.

**57.** Confirm real invocations land: `journalctl -u <unit> -f`. Wait for one firing of each.
Both are idempotent and no-op when the engine is paused, so a doubled or missed firing is safe.

---

## Phase J — The flip

**58.** Lower the Cloudflare DNS TTL for `crew.brewcle.com` **hours ahead**, and wait for the old
TTL to expire.

**59.** ⟳ **Rollback point.** Everything to here is reversible by doing nothing.

**60.** In Cloudflare, repoint `crew.brewcle.com` from Vercel to `BOX_IP` — **A record, proxied
(orange cloud)**. SSL/TLS stays **Full (Strict)**. The public certificate stays Cloudflare's, so
there is no public-side cert change.

**61.** Verify on the real hostname:
   - `https://crew.brewcle.com/api/health` → `ok`
   - **A crew magic-link SMS arrives and its link opens** — this is what `APP_BASE_URL` protects;
     a wrong value dead-links to localhost
   - `/crew/dev-link` → **404**
   - Sign in as admin, load `/admin/at-risk`
   - Both timers fire on schedule (`journalctl`)
   - If `RESERVATIONS` is on: a test Stripe event reaches `/api/webhooks/stripe` and returns 200.
     The HMAC is over the **raw body**, not the URL, so nothing needed re-pointing

**62.** ✅ **There are no inbound Twilio webhooks** — no status callback, no inbound SMS. Twilio is
outbound-only; crew answer via a web link. Nothing to re-point.

**63.** Watch with the residential probe and monitors in `ops/`.

**64.** ⟳ **Rollback:** flip the Cloudflare A record back to Vercel. Vercel is untouched, still
building from `production`, and — because of Phase D — pointed at the **same** database the box
is using. The rollback is real, not stale.

---

## Phase K — Rollback window, then decommission

**65.** Leave the muster Vercel project intact — building from `production` — for several days of
stable operation.

**66.** ⚠️ **Never rescale the old Hetzner CCX23 during this window** — a resize re-prices it from
$39.99 to $102.99.

**67.** Once stable: decommission the **muster project** on Vercel — set
`git.deploymentEnabled` false or delete the project. ⚠️ **The Vercel account stays.** Other
projects deploy from it, and a second Neon project (`neon-blue-cloud`, `autumn-heart-75034866`)
lives in the same Vercel-managed org. Do not touch the account, the org, or that project.

**68.** Delete the **old** Neon project (`delicate-art-65084110`, in Vercel's org) only after step
67 is done and you have a verified dump of it in your own storage. Deleting the muster Vercel
project may or may not tear the store down with it — either way, do not rely on that, and do not
let it reach `neon-blue-cloud`.

**69.** `docs/DEPLOY.md` now describes a topology that no longer exists. Rewrite it or mark it
superseded by this document. Two live runbooks describing incompatible topologies is how someone
follows the wrong one at 11pm.

**70.** `vercel.json` becomes documentation only — its `crons` and `git.deploymentEnabled` no
longer apply. Leave it until step 67 is done; it's part of the rollback path.

---

## Unchanged by this migration

- **Migrations are still applied by hand, out-of-band**, against the **direct/unpooled** endpoint.
  They were never part of the Vercel deploy. Apply to prod *before* promoting code that needs
  them.
- **`main` → `production`** stays the promotion path.
- Cookie flags, the service worker, and Cloudflare behaviour need no changes (Phase A §6).

## Watch item

Cloudflare's proxy request timeout (~100 s) applies to `/admin/import`'s "Pull from Xola now" — a
paginated loop with retries (`src/import/xola-client.ts`), no `maxDuration` set. It fits inside
Vercel's function limit today so it should fit Cloudflare's. If it bites, run the pull off the
request (an authenticated `127.0.0.1` call, same shape as the timers) rather than chasing a
timeout setting.

## Standing risk

The box holds a **copy** of `DATABASE_URL`, not a live binding — nothing re-injects it the way
Vercel's integration did. If the credential ever rotates, the box just starts failing.
`/api/health` returns `degraded` on an unreachable database, so keep it in your monitoring
(step 25).
