# Cutover Phase A — codebase audit report

**Date:** 2026-08-05 · **Verdict: GO** · **Scope:** read-only. No files changed, nothing provisioned.

Phase A of the Vercel → VPS cutover runbook (`mustercutoverhandoff.md` §2, Phase A; the checklist
originates in the earlier `hostingmigrationhandoff.md` §2). The public hostname
`crew.brewcle.com` does not change — only the origin behind Cloudflare moves.

**Headline: no blockers.** The two items the handoff flagged as most likely to break —
`VERCEL_URL` magic links and the Neon serverless driver — are already correct in the repo.
Phase B's queue is three small items, none on the critical path.

**The one thing that does need a decision before Phase I** is not a code issue: the Neon
database is provisioned *inside* Vercel's managed org. See §8.

---

## 1. `VERCEL_URL` / magic links — already solved, not a blocker

`VERCEL_URL` appears **zero times** in the repo. The app has used an explicit env var since
well before this migration was contemplated.

- `app/lib/base-url.ts` prefers `APP_BASE_URL`; the `Host`-header fallback is documented
  dev-only, with the host-header-poisoning threat spelled out in the doc comment.
- Three delivery paths **throw in production** when it is unset: `app/lib/channel.ts`,
  `app/lib/alert.ts`, `app/lib/doorbell.ts` — *"delivered links would ride the
  client-controlled Host header."*
- The CLI link minter refuses without it (`docs/DEPLOY.md` §7).

**The variable is `APP_BASE_URL`, not `APP_URL`.** Do not introduce a second spelling.
Set `APP_BASE_URL=https://crew.brewcle.com` on the box. Config step, zero code change.

## 2. Neon driver — already `pg`, config-only change

`package.json` depends on `pg`; `@neondatabase/serverless` is not a dependency and never was.
`app/lib/repo.ts` holds a single `pg.Pool` cached on `globalThis`, `max: 5`,
`idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 10_000`.

Under `next start` there is exactly one long-lived process, so `max: 5` stops being a
per-warm-instance figure and becomes the **whole application's** connection ceiling. Raise it
(~10–20) and keep the pooled (`-pooler`) endpoint — PgBouncer buys less with one process, but it
costs nothing and still absorbs a Neon scale-to-zero cold start.

Second, smaller: `app/api/health/route.ts` builds a **fresh Pool per request** and `end()`s it.
Correct for serverless, connection churn on a long-lived server — and the endpoint is
unauthenticated. Fold into the same PR.

## 3. Scheduled GETs — it is **two**, not three

| Path | Schedule | Auth | Notes |
|------|----------|------|-------|
| `/api/cron/tick` | `*/15 * * * *` | `Bearer $CRON_SECRET`, fail-closed | idempotent; no-ops when engine paused |
| `/api/cron/doorbell-tick` | `*/2 * * * *` | same | same; **also inert unless `MESSAGING=1`** |

`app/api/cron/xola-pull/route.ts` exists but has **no schedule and must not be given one**. Its
own header comment: *"NO CRON IS ATTACHED, AND NONE IS COMING"* — the schedule was removed at
`13d3fb5` because the operator wants to control when imports land. The route survives only as the
shared runner behind the "Pull from Xola now" button at `/admin/import`. **Do not port it to a
systemd timer.**

Both real jobs are `runtime="nodejs"`, `dynamic="force-dynamic"`, GET-only, idempotent
(documented and unit-tested with injected `now`), and gate on `repo.isEnginePaused()`. They port
to systemd timers cleanly, hitting `127.0.0.1:3000` directly with the shared secret — no
round-trip through Cloudflare.

Bonus: the `*/15` cadence required a Vercel **Pro** plan (Hobby silently throttles crons to daily
— `docs/DEPLOY.md`, Operating notes). That constraint disappears on the box.

## 4. Env var inventory

### Build-time — inlined into the client bundle; must be present wherever `next build` runs

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — **the easiest single thing to lose on cutover.**
  Missing at build time ⇒ checkout renders "Checkout is not configured"
  (`app/(public)/book/checkout/page.tsx`).
- `NEXT_PUBLIC_APP_VERSION` — injected automatically by `next.config.ts` from `package.json`.
  No action.
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` — Vercel-supplied, absent on the box. `<VersionTag />`
  simply drops the sha. Cosmetic; optionally feed it from `git rev-parse --short HEAD` at build.

### Runtime — required

`DATABASE_URL` · `SESSION_SECRET` · `CRON_SECRET` · `APP_BASE_URL`

### Runtime — feature gates, all OFF by default

- `CREW_SELF_SERVE=1` — the crew login front door. Unset ⇒ **crew cannot sign in at all.**
- `MESSAGING=1`
- `RESERVATIONS=true` — note the value is `"true"`, **not** `"1"` like its two siblings. The
  asymmetry is deliberate and documented in `app/lib/flags.ts`; do not "fix" it.

### Runtime — integrations

`STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `RESERVATION_LINK_SECRET` ·
`RESEND_API_KEY` `EMAIL_FROM` ·
`TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM` `TWILIO_MESSAGING_SERVICE_SID` ·
`XOLA_API_KEY` `XOLA_SELLER_ID` `XOLA_API_BASE` `XOLA_API_VERSION`

### Runtime — tenant / operator config

`TENANT_ID` `TENANT_NAME` `TENANT_TZ` `PICKUP_LOCATION` `PICKUP_MAP_URL` `PAY_PERIOD_ANCHOR`
`OPERATOR_CREW_MEMBER_ID` `OPERATOR_NOTIFY_EMAIL` `WAIVER_TERMS_URL` `WAIVER_TERMS_VERSION`
`OUTBOX_TEST_PHONE`

### Runtime — engine knobs (defaults live in code; never hardcode, never quote from memory)

`STAFFING_HORIZON_LEAD_DAYS` `XOLA_PULL_LEAD_DAYS` `ASK_DRIP_INTERVAL_MINUTES`
`ASK_SILENT_TIMEOUT_MINUTES` `FILL_DEADLINE_HOURS` `STAFFING_HORIZON_WEEKEND_DAYS`
`STAFFING_HORIZON_TRIGGER_DAY` `STAFFING_HORIZON_WEEKEND_ASK_TIME` `DOORBELL_BATCH_WINDOW_MS`
`DOORBELL_PRESENCE_WINDOW_MS` `DOORBELL_SHORT_NOTICE_MAX_CHARS` `CIVIL_SEND_START`
`CIVIL_SEND_END`

### Never set on the box

`TEST_DATABASE_URL` `E2E` `E2E_PROD` `E2E_BASE_URL` `E2E_PORT` `CI` `SEED_TODAY`
`BACKFILL_CONFIRM` `RESET_PILOT_CONFIRM` `RESET_PILOT_EXPECT_DB`

### ⚠️ Security item — `NODE_ENV` becomes load-bearing on the box

`VERCEL_ENV` is absent on a self-hosted deploy, so `isProdDeploy()` (`app/lib/flags.ts`) falls
through to `!VERCEL_ENV && NODE_ENV === "production"`. DEC-057 wrote that branch **for exactly
this case**, so the dev-link and dev-code minters stay 404 — *provided `NODE_ENV=production` is
genuinely set*.

If the systemd unit omits it, `/crew/dev-link` becomes a **live, unauthenticated magic-link
minter on the public origin**. `next start` sets `NODE_ENV=production` itself, but set it
explicitly in the unit anyway. This is `docs/SECURITY_AUDIT.md` item 12, filed as "matters only
if self-hosted" — self-hosting is now the plan.

### The gap this inventory cannot close

Roughly 22 production values live **only in the Vercel dashboard** and were never backfilled into
`docs/DEPLOY.md` (2026-07-25 audit, shard E). Export them before touching anything.
`vercel env pull` returns **Sensitive** vars — the Neon connection strings — *empty*; copy those
from the Neon console by hand. See §9.

## 5. `next build` peak RSS — **1,017 MB, measured**

Whole process group, sampled at 200 ms, cold `.next`, `npm run build`, exit 0.
Node v22.22.2, 4 cores / 16 GB. Artifacts: `.next` 193 MB, `node_modules` 662 MB.

**Builds comfortably on the 4 GB box. Do not plan the rsync-`.next` workaround.** Peak scales
with webpack worker count, which scales with core count — a 2-vCPU Linode should peak *lower*,
not higher. For margin, add swap or `NODE_OPTIONS=--max-old-space-size=3072`.

One build-time dependency the handoff does not anticipate: `next/font/google` (`app/layout.tsx`)
fetches IBM Plex **during the build**. Building on the box requires outbound HTTPS to
`fonts.googleapis.com` / `fonts.gstatic.com`. Cached in `.next/cache` after the first build.

## 6. Other Vercel-isms — clean

| Checked | Result |
|---------|--------|
| `runtime = 'edge'` | **zero occurrences** — every route is `nodejs` |
| `@vercel/*` packages | **none**, in dependencies or source |
| `next/image` | **not used anywhere** (`sharp` is a devDependency only) |
| `middleware.ts` | **does not exist** |
| `x-forwarded-for` / `ipAddress()` / geolocation | **none** — nothing reads client IP, so the anticipated `CF-Connecting-IP` swap is a non-issue |
| `x-forwarded-proto` | 3 uses, all inside the `APP_BASE_URL`-unset fallback branch — dead code in prod; Caddy sets it correctly regardless |
| SSE / WebSockets / client polling | **none** — nothing that fights a Cloudflare proxy |
| Service worker | `public/sw.js` is a pure network pass-through with **no caching** — no stale-shell risk at cutover |
| Cookies | `httpOnly`, `sameSite: lax`, `secure: NODE_ENV === "production"` — correct behind Cloudflare (the browser sees HTTPS). No change |

Two things to **decide**, not fix:

- **`output: 'standalone'` is not set** in `next.config.ts`, so `next start` needs the full
  662 MB `node_modules` on the box. Either `npm ci --omit=dev` there, or adopt
  `output: 'standalone'` — a one-line config change producing a self-contained server directory
  that would simplify the deploy mechanism. *Proposed; not currently in the codebase.*
- **No Node version pin.** No `.nvmrc`, no `engines` in `package.json`. Phase C assumes "Node
  pinned to the repo's version" — there isn't one. Verified building on **v22.22.2**; pin to
  whatever the Vercel project currently runs (see §9).

## 7. Corrections to the handoff

**There are no inbound Twilio webhooks — none, of any kind.** No status-callback route, no
inbound-SMS route. `src/adapters/twilio-channel.ts`: *"No inbound SMS parsing."* Twilio is
outbound-only; crew answer by tapping a web link back into the app. The handoff's reasoning that
"Twilio webhook URLs don't move, so their HMAC signature keeps validating" is **moot** — there is
nothing to validate and nothing to re-point.

→ **Phase H's verification list should drop the Twilio webhook steps** and keep only "an ask SMS
arrives and its link opens."

The **only** inbound webhook is Stripe (`app/api/webhooks/stripe/route.ts`), which verifies an
HMAC over the **raw body** against the `stripe-signature` header. URL-independent. Nothing to
change.

**Three scheduled GETs → two.** See §3.

## 8. The Neon database is provisioned *inside* Vercel — Phase I is affected

This is not a code finding and it did not come out of the §2 checklist, but it is the item most
likely to hurt.

Confirmed from the repo, this is **not** a standalone Neon account that merely bills through
Vercel:

- `.claude/CLAUDE-context.md` — project `delicate-art-65084110` (neon-red-pendant), org
  `org-spring-feather-31353161`, **"in the Vercel-managed Neon org"**
- `docs/DEPLOY.md` step 1 — created via Vercel → Storage → Create Database → Neon;
  **"Billing stays in Vercel."**
- `docs/DEPLOY.md` — `DATABASE_URL` is **auto-injected by the integration**, and marked Sensitive

So Vercel owns the Neon org, the billing relationship, and the access path to the Neon console.

**Phases C–H are unaffected.** Neon does not care that the client IP moved from Vercel's fleet to
a Linode in Chicago. A connection string is a connection string.

**Phase I is the problem.** "Then decommission Vercel" is incoherent as written, because the
database lives inside the thing being decommissioned. Deleting the Vercel project is a plausible
way to delete the database. Given §1 of the handoff — losing reservations is out of business —
that is not a thing to discover empirically.

### Not answerable from the repo

Whether the existing project can be **transferred** out of Vercel's managed org into a
directly-owned one, and what that does to the connection strings. Ask Neon support, or check from
an authorized MCP session. Do not guess at marketplace detach mechanics — that behavior changes
quietly.

### Recommended approach — migrate rather than detach, folded into Phase G

Create a Neon org you own outright (your login, your billing, no Vercel), create a project,
`pg_dump` the current database, restore into the new one, repoint. **This is the same operation
as the §1 restore drill** — the dump→restore rehearsal was already a go-live gate, so doing it
*as* the account migration proves the backup is restorable **and** cuts the Vercel dependency in
one exercise instead of two separate high-stakes days.

Requires a brief write freeze (stop `next start`, dump, restore, repoint, start) or any booking
taken in the gap is lost. At BrewBoat's volume that is minutes, on a weekday morning.

### ⚠️ The sequencing trap — this interacts badly with the Phase I rollback window

Once the data lives in the new Neon project, the Vercel deployment's auto-injected `DATABASE_URL`
still points at the **old** one. Flipping the Cloudflare origin back to Vercel as the "instant
rollback" would then serve a stale database — bookings taken on the box since the migration are
simply absent, and **nothing errors**. A safety net that silently loses reservations is worse
than no safety net.

Two ways out; prefer the second:

1. Migrate Neon only *after* the rollback window closes — but then decommissioning Vercel is
   gated on a second unrehearsed step.
2. **Immediately after the migration, manually override `DATABASE_URL` on the Vercel project** to
   the new Neon project's pooled string. The auto-injected value is replaced by an explicit one,
   both origins read the same database, and rollback stays real. Redeploy on Vercel afterwards —
   env changes only apply to new deployments.

### Smaller consequence — the box holds a copy, not a live binding

Today Vercel re-injects `DATABASE_URL` if the integration rotates it. The box will not receive
that; it will simply start failing. `/api/health` already returns `degraded` on an unreachable
DB, and the `ops/site-monitor` probe pattern can watch it, so detection is essentially already
built — just know the failure mode exists.

### Effect on the DEC to be logged

The handoff calls for a DEC recording "Neon stays." That is only half the decision. It should
read: **Neon stays as the Postgres provider, *and* the project is extracted from Vercel's
marketplace org into a directly-owned Neon account** — keeping Neon while decommissioning Vercel
is otherwise self-contradictory. The rejection of self-hosted Postgres is unaffected; that
reasoning was never about who sends the invoice.

Next free decision id at the time of writing: **DEC-148**.

## 9. What Phase A could not determine — for the authorized MCP session

Both `neon` and `vercel` in `.mcp.json` are remote/OAuth servers. This audit ran in a
non-interactive session where neither could be authorized, so the following stayed open. Run
`/mcp` in an interactive CLI session first.

**Vercel MCP:**
1. **The ~22 deployed env values** absent from `docs/DEPLOY.md` (§4). Biggest open unknown in the
   cutover. Expect Sensitive vars (the Neon strings) to come back empty — that protection is
   platform-level, not a `vercel env pull` quirk; copy those from the Neon console by hand.
2. **Which Node major the project builds on** → the version to pin in §6 / Phase B item 2.
3. Plan tier confirmation (the `*/15` cadence needed Pro).
4. Build logs, to sanity-check the 1,017 MB peak RSS against the real builder.

**Neon MCP** — read/diagnose only, per the write discipline in `.claude/CLAUDE-context.md`:
1. `select filename from _migrations order by filename;` against `delicate-art-65084110` — the
   pre-promote ledger check. Do this *before* the box exists.
2. **The PITR retention window on the current plan.** A hard §1 go-live gate; not answerable from
   the repo.
3. The org/project structure — what `org-spring-feather-31353161` being Vercel-managed means in
   practice, and whether a transfer out is offered at all (§8).

## 10. Phase B queue — none blocking

1. `pg` pool sizing for a long-lived process, plus the per-request pool in
   `app/api/health/route.ts` (§2). **~1 point.**
2. Pin Node — `.nvmrc` + `engines` — once §9 establishes the current version. **~1 point.**
3. `docs/DEPLOY.md`'s "Importing reservations" section still describes the **xlsx upload that
   DEC-043 retired**. Unrelated to the cutover, but it is the document someone reads during
   Phase D. **~1 point.**

Optional, decide separately: `output: 'standalone'` (§6).

## 11. Watch item for Phases E / H

Cloudflare's proxy request timeout (~100 s) applies to `/admin/import`'s "Pull from Xola now" — a
paginated loop with retries (`src/import/xola-client.ts`), with no `maxDuration` set. It fits
inside Vercel's function limit today so it should fit Cloudflare's, but it is the one request
that could plausibly exceed 100 s on a wide `XOLA_PULL_LEAD_DAYS`.

If it bites, the fix is to run the pull **off the request** — an authenticated `127.0.0.1` call,
the same shape as the systemd timers — not to chase a timeout setting.

---

## Verdict

**GO.** Nothing found requires a code change before provisioning. Phase B's three items are small
and none blocks Phase C.

The one item requiring a decision before Phase I is §8, and it is an account-ownership question,
not an engineering one.
