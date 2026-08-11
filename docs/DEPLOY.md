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
| `STAFFING_HORIZON_LEAD_DAYS` | optional — defaults `7` (DEC-022/062). Positive integer days; a bad value falls back | how far ahead the engine starts working a shift (Pending→Filling). Tune per pilot, no redeploy |
| `XOLA_PULL_LEAD_DAYS` | optional — **defaults to `STAFFING_HORIZON_LEAD_DAYS`** (DEC-080). Positive integer days; a bad value falls back | how far ahead the importer fetches Xola orders. **Decoupled** from the staffing horizon: set wider (e.g. `30`) to pull a month of bookings for review without the engine asking crew that far out |
| `ASK_DRIP_INTERVAL_MINUTES` | optional — defaults `15` (DEC-063). Non-negative integer minutes; `0` = blast the whole pool at once | spacing between staged Tier-1 asks (the ripple). Inside the 48h fills-by deadline the engine blasts regardless |
| `ASK_SILENT_TIMEOUT_MINUTES` | optional — defaults `120` (2h, DEC-067). Positive integer minutes | how long an unanswered ask waits before it counts as silent — past it the seat reopens and the engine moves to the next person |

### Required for a *working* deploy — the table above is not sufficient

Added 2026-07-25 (audit shard E). The list above covers the database, session, cron and engine-tuning
vars, but a deploy built from it alone comes up with **crew unable to sign in and no reservations
importing**. These are read by the code and were never backfilled here:

| Var | Where it comes from | Used for |
|-----|---------------------|----------|
| `CREW_SELF_SERVE` | **you set it** — `"1"` to enable | **The crew code-login front door** (`app/lib/flags.ts`, DEC-081). **OFF by default** so `main` stays promotable — so production must set it explicitly or crew cannot sign in at all |
| `XOLA_API_KEY`, `XOLA_SELLER_ID` | **you set them** — from Xola | **The reservation import** (DEC-036/043). Unset ⇒ `/admin/import` refuses with "Xola isn't configured on this server … nothing was pulled". There is no scheduled pull — every import is the operator pressing "Pull from Xola now" |
| `XOLA_API_BASE`, `XOLA_API_VERSION` | optional — defaults in `src/import/xola-client.ts` | Xola endpoint pinning; leave unset unless Xola moves |
| `RESEND_API_KEY`, `EMAIL_FROM` | **you set them** | Email delivery — the 6-digit login code has no way out without them (DEC-081) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_MESSAGING_SERVICE_SID` | you set them, **if** using SMS | The Twilio channel adapter (DEC-MSG-1). Omit to stay on the operator-relay outbox |
| `MESSAGING` | optional — off unless set | Gates `/admin/messages`, `/crew/threads` and the doorbell (`app/lib/flags.ts`) |
| `TENANT_ID`, `TENANT_NAME` | optional — defaults in `app/lib/tenant.ts` | Tenant identity + admin-nav label |
| `PICKUP_LOCATION`, `PICKUP_MAP_URL` | you set them | The dock pin on the crew shift card — a SPEC §2.6.3 binding constraint |
| `PAY_PERIOD_ANCHOR` | optional — has a default | Pay-period boundary math |
| `OUTBOX_TEST_PHONE` | optional — dev/staging only | Redirects outbox relay to one number for testing |
| `TEST_DATABASE_URL` | optional — local/CI only | The `muster_test` database; never set in production |

> **Why this section exists separately:** these were configured directly in Vercel as each feature
> landed and never backfilled into this runbook. The running production deploy has them. The gap bites
> the *next* one — a rebuild, a second environment, or a disaster-recovery restore.

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

### 7. Sign in as an admin (5.2, DEC-034; admin entity DEC-092)

**Admins (DEC-092/DEC-093).** Admin is a first-class, individually-revocable identity in the `admins`
table — and `admin.id` **is a crew member's id** (every admin is also crew). Admins are **managed by the
`db:admin` CLI**, not seeded (0019 removed 0018's provisional roster — the real crew ids + emails aren't
known at migration time). So the launch sequence is: import the crew roster → set each admin's crew
**email** (crew are **not** Xola customers, so emails don't arrive with bookings — set them on the crew
record) → add them:

```bash
DATABASE_URL="<neon-direct-unpooled>" npm run db:admin -- add --email=eric@stoffer.net --handle=eric
#   → resolves the crew member with that email, makes them an admin (id = their crew id)
DATABASE_URL="<neon-direct>" npm run db:admin -- add --crew=<crewId> --handle=drew   # or explicit id
DATABASE_URL="<neon-direct>" npm run db:admin -- list
```

The **primary sign-in for admins is the crew code login** (DEC-081, live now that email is wired): log in
with a code as crew, then **"Switch to admin"** (DEC-093). `db:mint --admin=<handle>` remains the
out-of-band **bootstrap** magic link — it must be a **seeded, active** handle (mint refuses an unknown or
deactivated one and prints the active handles). (`spink` is the dev/e2e-only operator, never a prod admin.)

`/crew/dev-link` is **hard-404 in production** (it must never mint links there), so an admin's first
sign-in is bootstrapped out-of-band. The script auto-sources `.env.local` (what step 3's
`vercel env pull` wrote), so once that file holds `APP_BASE_URL` + a DB string the command is just:
```bash
npm run db:mint -- --admin=eric
#  → Minted admin link · crew-eric-stoffer (eric)   (db: ep-xxx.neon.tech)
#      https://<domain>/crew/auth?t=<secret>
#      single-use · expires ... (60 min)
```
**The DB string is the catch.** Neon connection vars are **Sensitive**, so `vercel env pull` returns
`DATABASE_URL` *empty* (step 3) — `APP_BASE_URL` (not sensitive) pulls fine, but the DB string doesn't.
So either paste the **direct/unpooled** string into `.env.local` once (it's gitignored; survives until
the next `env pull` overwrites the file), or pass it inline — inline always wins. **Both `APP_BASE_URL`
and `DATABASE_URL` are required:** omit `APP_BASE_URL` and the printed link silently falls back to the
local host (`http://mill-dev:3000`), not your domain. Quote the DB string — an unquoted `&` in it is a
bash background operator and splits the command, so `DATABASE_URL` never reaches the script:
```bash
APP_BASE_URL=https://<prod-domain> DATABASE_URL="<paste-direct-unpooled-string>" npm run db:mint -- --admin=brendan
```
**Check both in the output** — the `db:` host must be the Neon host (not `localhost:5432`), AND the
printed link must be your `<prod-domain>` (not `http://mill-dev:3000`). Either one wrong means that env
var didn't take.

**On the dev box (mill-dev), don't edit `.env.local` for this.** Your `.env.local` points at *local*
dev (mill-dev origin + localhost DB), and inline env is one-shot — it never touches that file, so
there's nothing to restore afterward. Save a one-time alias and you get a clean second command:
```bash
echo 'postgres://<neon-direct-unpooled-string>' > ~/.muster-prod-db   # once; gitignored home file
# add this line to ~/.bashrc so it persists:
alias mint-prod='APP_BASE_URL=https://muster-sigma.vercel.app DATABASE_URL="$(cat ~/.muster-prod-db)" npm run db:mint --'
```
Then `mint-prod --admin=eric` mints a **prod** link, while plain `npm run db:mint -- --admin=eric`
still mints **local** — two commands, no editing, no switch-back. (Rarely needed: the sign-in cookie
lasts 14 days and renews on use, so it's a first-sign-in / long-gap thing.)

Open the printed URL in a browser → tap **Tap to sign in** → you land on **`/admin/at-risk`** with a
session cookie (a 14-day cookie that silently renews on use — you sign in once, not per visit). The link
is single-use and expires in 60 min (`--ttl-min=<n>` to change). `APP_BASE_URL` is **required** — the
script refuses without it (a CLI has no Host header, and a link on the wrong origin is host-spoofable /
unopenable). **Crew** need none of this: they sign in with an emailed code, or the link in an ask text
that Muster sends them automatically (`--crew=<id>` exists as a manual escape hatch, not the normal path).

### 7b. Deprovision / manage admins — `db:admin` (per-person revoke — DEC-092)

Removing **one** admin's access is **immediate** (their next request dies at `readSubject`'s admin gate)
and **scoped** (no other admin is affected; contrast rotating `SESSION_SECRET`, which logs everyone out).
Use the CLI — same DB wiring as `db:migrate` (direct/unpooled prod string):

```bash
DATABASE_URL="<neon-direct>" npm run db:admin -- revoke drew        # immediate, scoped
DATABASE_URL="<neon-direct>" npm run db:admin -- reactivate drew
DATABASE_URL="<neon-direct>" npm run db:admin -- list               # who's active (● / ○)
```

There is no admin-management UI at launch (DEC-092 — deferred); `db:admin` is the interface for ~3 admins
(it validates handle uniqueness, checks the id **is a real crew member**, and resolves `--email`→crew id —
guardrails raw SQL won't give you). `SESSION_SECRET` rotation remains the global break-glass (kills *all*
sessions at once).

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

## Stripe webhook events (#616)

**This section is narrow on purpose.** DEPLOY.md carries no other Stripe content — the env-var
table (#618) and the full go-live runbook (#623) are their own tasks. What is here is the one
thing that fails *silently* if it is missed.

### The endpoint must subscribe to `charge.refunded`

Muster's webhook handles four event types:

| Event | What it does |
|---|---|
| `checkout.session.completed` | hosted Checkout — balance + post-trip gratuity |
| `payment_intent.succeeded` | the inline-Elements booking (DEC-134) |
| `charge.refunded` | **reconciles a refund into the ledger (#616, DEC-153)** |

The **local** listener (`stripe listen`) forwards everything, so refunds reconcile in dev whether
or not anyone thought about it. **A production endpoint subscribes to an explicit list**, and if
`charge.refunded` is not on it there is no error anywhere: refunds still succeed at Stripe, and
Muster simply never learns. The reservation keeps reading paid, the boat stays held,
`balanceOwedCents` keeps billing the balance, and `/admin/purchases` keeps counting the revenue —
which is the exact defect #616 exists to remove, reintroduced by a checkbox.

Nothing in the repo can verify the subscription list (#544). It has to be read off the dashboard.

**Not subscribed, deliberately: `charge.refund.updated`.** A card refund can fail at the bank days
later, at which point Stripe *decrements* `amount_refunded` and emits that event. Muster's
`markPaymentRefunded` only ever ratchets upward (`greatest()`), so a reversed refund would be
recorded permanently as money returned that in fact came back. Low likelihood on cards and
deliberately out of scope for #616 — but if a reversal ever happens, the payment row needs
correcting by hand.

### Test it once in production, with real money

The refund path cannot be proven by the test suite: `FakePaymentPort` models Stripe's keyed
idempotency, not Stripe. Do this **once**, after the first deploy that carries #616, on a real
booking of your own:

1. Take a **real booking** through `/book` for the smallest amount the catalog allows, with a real
   card. It must be a genuine charge — a test-mode charge exercises a different key and a
   different endpoint.
2. Refund it **from the Stripe dashboard**, not from Muster. That is the route that was invisible
   and the one the subscription list can silently break.
3. Within a few seconds, `/admin/purchases` should show the row as **Refunded**, and the
   reservation's detail pane should show a **Refunded** line. If it still reads Paid, the endpoint
   is not subscribed to `charge.refunded` — fix the subscription, then use
   **Stripe → Developers → Events → Resend** on that same event rather than refunding again.
4. Then refund a second real booking **from Muster** (the Refund box on the detail pane) and
   confirm the same two surfaces. This proves the in-app route and the write-back agree; the
   webhook re-writes the same cumulative total, so the two cannot disagree by construction, but
   the API key and the endpoint are only exercised for real here.
5. **Cancel** that booking too, and confirm the departure returns to the calendar as open. The
   slot-resurrection path (DEC-153) is the one piece of #616 that touches a unique index under
   concurrency; it is covered against real Postgres in CI, but a first production cancel is cheap
   insurance.

Keep the amounts small. This is real money in the operator's real account, and steps 1 and 4 leave
Stripe's processing fee behind on each charge even after a full refund.

## Running the management CLIs against prod (`db:crew`, `db:admin`, `db:mint`)

This is the recipe for every operator CLI. All three connect through **`DATABASE_URL` = the Neon
direct/unpooled prod string** (same as `db:migrate`, step 3). They auto-source `.env.local`, but an inline
`DATABASE_URL` always wins. `db:crew`/`db:admin` need **no** `APP_BASE_URL` (they mint no links — only
`db:mint` does).

**The catch (see step 7):** the Neon string is a **Sensitive** Vercel var, so `vercel env pull` returns it
*empty* — you paste the direct/unpooled string yourself. On the dev box **don't edit `.env.local`** (it
points at local dev); pass it inline, or reuse the one-time prod-db file + an alias:

```bash
echo 'postgres://<neon-direct-unpooled>' > ~/.muster-prod-db                    # once; gitignored home file
# add to ~/.bashrc:
alias crew-prod='DATABASE_URL="$(cat ~/.muster-prod-db)" npm run db:crew --'
alias admin-prod='DATABASE_URL="$(cat ~/.muster-prod-db)" npm run db:admin --'
```

Then `crew-prod list`, `crew-prod add --name="…" --phone=… --ratings=captain,mate`, `admin-prod list`, etc.
— while plain `npm run db:crew -- …` still hits **local**. One-shot inline works too (quote the string — an
unquoted `&` in it is a bash background operator and splits the command):

```bash
DATABASE_URL="<paste-direct-unpooled>" npm run db:crew -- list
```

**Two checks before you trust a write:**
1. Every run prints `(db: <host>)` on the last line — confirm it's the **Neon host**, not `localhost:5432`.
   Wrong host ⇒ the env var didn't take (usually `.env.local` winning because the inline string was unquoted).
2. **Run `list` first.** If it shows the real roster, you're pointed at prod — then `add`/`set`/`disable` safely.

## Break-glass — fixing things in a pinch

The levers you have when something's wedged mid-pilot. Almost none of this needs a redeploy. Most CLI
levers take the direct/unpooled prod `DATABASE_URL` (same as `db:migrate`, step 3).

| The fire | Lever | How |
|----------|-------|-----|
| **Crew can't log in — wrong email on file** | `db:crew` | `db:crew -- set <id> --email=<addr>` then they re-request a code (or hand them a link — next row) |
| **Crew can't log in — locked out / need them in NOW** | `db:mint` | `APP_BASE_URL=<domain> DATABASE_URL="<direct>" npm run db:mint -- --crew=<id>` — a single-use magic link that **bypasses the login-code cap** entirely |
| **Crew not getting SMS — wrong phone** | `db:crew` | `db:crew -- set <id> --phone=+1XXXXXXXXXX` (must be E.164 — the CLI rejects anything else) |
| **Don't know the crew id** | `db:crew` | `db:crew -- list` — id · name · phone · email, sorted by name |
| **Onboard a new hire** | `db:crew` | `db:crew -- add --name="<name>" --phone=+1XXXXXXXXXX --ratings=captain,mate [--email=<addr>]` — creates them **and** the DEC-044 placeholder MMC, so they're actually askable. `--id` overrides the derived `crew-<slug>`; `--mmc=YYYY-MM-DD` sets a real credential date |
| **Take someone out of / back into rotation** | `db:crew` | `db:crew -- disable <id>` (won't be asked) · `db:crew -- enable <id>` (back in) |
| **Runaway / broken sends (notification storm)** | engine pause | `/admin` → **Pause staffing** — stops *new* asks/texts instantly, no redeploy. Texts already sent are out (there's no queue to recall) — pause stops the bleeding, then fix and resume |
| **Xola data stale or wrong** | re-import | `/admin/import` → re-pull (idempotent, keyed on reservation id — updates in place, never duplicates) |
| **Bad seat / assignment on a shift** | cockpit | `/admin/shift/<id>` → override / remove seat (remove = no reliability penalty) · split / merge |
| **An admin needs removing (or is locked out)** | `db:admin` | `db:admin -- revoke <handle>` / `reactivate <handle>` — immediate + scoped (§7b) |
| **Session compromise — log EVERYONE out** | `SESSION_SECRET` | Rotate the env var in Vercel + redeploy — kills all admin **and** crew sessions at once (the global hammer) |
| **Operational slate corrupted — clean re-import** | `reset-pilot.ts` | `DATABASE_URL="<direct>" npx tsx db/reset-pilot.ts` (dry-run), then re-run with `RESET_PILOT_CONFIRM=yes RESET_PILOT_EXPECT_DB=<name>`. Truncates shifts/asks/outbox/etc. but **keeps** crew/vessels/credentials/admins — then re-import from Xola. Heavy; guarded four ways |
| **Prod build broken** | Vercel | Redeploy a previous build from the dashboard — instant, DB untouched (see Operating notes) |

Guardrails to remember: `db:crew add` onboards a hire (with the placeholder MMC) and `set`/`enable`/`disable`
edit one, but neither `db:crew` nor `db:admin` **deletes** — a removed crew id would orphan their
seats/history, so take people out of rotation with `disable`, not deletion. There's **no per-crew session
revoke** (crew sessions are stateless by design — #300); the only crew-session lever is the global
`SESSION_SECRET` rotation. Every CLI prints the DB host it hit — read it before you trust a "done."

## Follow-ups (not blocking the pilot)
- `attachDatabasePool` from `@vercel/functions` closes idle connections before a function suspends —
  a connection-churn optimization worth adding if Neon shows connection pressure. One small dep; left
  out of the initial deploy to keep it dependency-clean.
- The `<VersionTag />` build-stamp (`templates/VersionTag.tsx`) can be wired into a layout so a
  deployed build shows its version/commit.
