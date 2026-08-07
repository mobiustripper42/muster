# Muster Server Cutover — Handoff

Status: ready to execute · Companion to `hostingmigrationhandoff.md` (that doc's
§2 is still the codebase-audit checklist; this doc adds the DB resolution, the
disaster-recovery bar, and the ordered cutover runbook).
Purpose: a fresh CC session picks this up cold and drives the Vercel → VPS cutover
for `crew.brewcle.com`. Infrastructure only — do not let it become a refactor.

---

## 0. Decisions locked (delta from the earlier handoff)

- **Database: Neon stays.** Self-hosting Postgres was considered and rejected. Not
  because it's hard to *run* — because it makes you the DBA at 3am on the exact
  nights Muster breaks, and the three DR problems below all get worse when you own
  the WAL. Neon ships near-zero-RPO PITR out of the box. Log this as a DEC.
- **The DR bar is a hard go-live gate**, not a nice-to-have. See §1. No real
  booking is taken until the restore drill has passed once, green, witnessed.
- **Public hostname does not change.** `crew.brewcle.com` stays; only the *origin
  behind Cloudflare* moves from Vercel to the box. This has downstream mercy: the
  public cert stays Cloudflare's, and Twilio webhook URLs (pointed at
  `crew.brewcle.com/...`) don't move, so their HMAC signature keeps validating.

---

## 1. The disaster-recovery bar (blocks go-live)

Losing reservations = out of business. The three problems, and what each requires:

1. **RPO — how many bookings can vanish (measured in time).** Nightly dumps = up to
   24h of paid reservations gone = the reconciliation nightmare. Target **near-zero**:
   lean on Neon PITR (continuous WAL) as primary, and add an **independent** nightly
   `pg_dump` shipped to object storage you control (B2/S3) as the not-dependent-on-Neon
   copy. Confirm the Neon plan's **PITR retention window** is long enough to notice a
   problem before it rolls off.
2. **RTO — recovery time is turned-away guests.** Write a **rehearsed restore runbook**
   so a Saturday-night recovery is a script, not improv. Recovery speed is a
   customer-facing metric here.
3. **Silent backup failure — the net grows a hole quietly.** Monitor backup *health*
   (did last night's dump land? is WAL current?) with the ntfy/sheepdog pattern, and
   **schedule test-restores**. An unmonitored backup is a rumor.

**Correction that drives all of the above: Stripe is NOT a reservation backup.**
Stripe has the charge ("$240, card 4242, July 3"), never the booking (party of 4,
Sunday sunset sail, July 19, guest contact). That mapping lives ONLY in the DB. So
the DB is the *sole durable record of booking truth* — which is exactly why layers
1–3 are the business, not ops hygiene.

**Go-live gate (run once, before first real booking):**
- Spin a Neon **branch** from a timestamp 10 min ago → confirm reservations present.
  Proves PITR works *for your data*.
- Take last night's `pg_dump` → load into a throwaway Postgres → count rows. Proves
  the dump is restorable.
- Green on both → certainty is a checkmark, not a feeling. Then take bookings.

---

## 2. Cutover runbook (in order)

### Phase A — Codebase audit (GATE, read-only, no changes)
Run the earlier handoff's **§2** top-to-bottom. Deliverable is a written report:
1. **`VERCEL_URL` / magic-link** — does auth build absolute URLs from `VERCEL_URL`?
   If so, crew SMS links break silently on cutover. Replace with explicit `APP_URL`.
   **Lead the report with this.**
2. **Neon driver** — `@neondatabase/serverless` (HTTP/WS, built for ephemeral Vercel
   functions) vs `pg`/`postgres.js` TCP pool. `next start` is long-lived → a small
   TCP pool against the Neon **pooled** endpoint is now correct and faster. Report
   current shape + size of the change.
3. **The 3 scheduled GETs** — exact paths + schedules (likely `vercel.json` crons),
   ported to systemd timer units. Confirm they're idempotent + auth'd.
4. **Env var inventory** — full list from the Vercel dashboard, build-time
   (`NEXT_PUBLIC_*`) vs runtime. The single easiest thing to lose on cutover.
5. **`next build` peak RSS** — measured, not estimated (sizes the deploy mechanism).
6. Other Vercel-isms: `runtime='edge'`, `next/image`, `middleware.ts`, `@vercel/*`,
   `x-forwarded-for` (→ `CF-Connecting-IP` behind CF+Caddy).

**Stop here for review. No provisioning until the report is read.**

### Phase B — Fix blockers on branches
Whatever Phase A surfaces (APP_URL, driver swap, CF-Connecting-IP), fixed and merged
per normal workflow. These are code changes to `main`, independent of the box.

### Phase C — Provision prod box (Vercel still serving prod)
- **Linode Shared 4 GB, Chicago (us-ord)** + backups (~$5/mo). Vultr Chicago is the
  approved swap.
- **Caddy → `next start` on Node.** Node pinned to the repo's version. `next start
  -p 3000 -H 127.0.0.1` (never 0.0.0.0 — Caddy is the only thing facing the network).
- **Cloudflare Origin CA cert** served statically by Caddy (`tls <cert> <key>`,
  auto-HTTPS off). 15-year validity → no renewal → no renewal-through-proxy failure.
  This is the reason for the whole migration.
- If `next build` OOMs the 4 GB box (per Phase A peak): build on dev, rsync `.next`.
  Do NOT upsize prod.

### Phase D — Env + build on box
Port the Phase A env inventory to the box (build-time vars present when `next build`
runs, wherever that is). Set `APP_URL=https://crew.brewcle.com`. Build, start.

### Phase E — Smoke test the box BEFORE any DNS change
Hit the box directly (its IP / Tailscale name, Host-header override) and verify the
app renders and talks to Neon (pooled endpoint). Catch problems while Vercel is
still the live origin.

### Phase F — Crons → systemd timers
The 3 GETs as **systemd timers** (journald + `systemctl list-timers` beat crontab),
hitting **`127.0.0.1:3000` directly** with a shared-secret header. No round-trip
through Cloudflare to poke your own process.

### Phase G — DR setup + the go-live drill (§1 gate)
Stand up PITR confirmation + independent `pg_dump` + health monitoring, then run the
drill. **Green here is the permission slip to take money.**

### Phase H — The flip
- Lower the Cloudflare DNS record TTL ahead of time.
- In Cloudflare, repoint `crew.brewcle.com` origin from Vercel → **box IP** (A record,
  **proxied / orange cloud**). SSL/TLS mode stays **Full (Strict)** (already set).
  Public cert stays Cloudflare's — no public-side cert change.
- Verify end-to-end on the real hostname: **magic-link SMS**, a booking, Twilio
  status-callback/reply webhooks, the cron endpoints.
- Watch with the residential probe + monitors already on bee-grace.

### Phase I — Rollback window, then decommission
Keep the Vercel deployment intact as instant rollback (flip the CF origin back) for
a few days of stable operation. Then decommission Vercel. **Never rescale the old
Hetzner CCX23 in the meantime** — a resize re-prices it from $39.99 to $102.99.

---

## 3. First session's job (be explicit)

Run **Phase A only** and produce the report. That's it. It's read-only, it can't
break anything, and it converts this handoff into a go/no-go. Everything after A
waits on the report being reviewed.

---

## 4. Open / deferred (unchanged from earlier handoff)

- Deploy mechanism (rsync `.next` vs git-pull-and-build-on-box) — decide after the
  Phase A `next build` peak.
- Neon connection string: pooled (`-pooler`) for the app, direct for migrations.
- Netcup snapshot export is thin — not a backup strategy. Neon PITR + your own dump
  is the DR plan (§1).
- Nothing here touches the crew engine, the oracle, or Xola coexistence. Infra only.
