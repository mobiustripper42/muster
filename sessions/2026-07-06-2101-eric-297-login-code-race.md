---
session: 40
dev: eric
slug: 297-login-code-race
branch: task/297-login-code-race
started: 2026-07-06T21:01:31Z
ended: 2026-07-09T16:34:39Z
points: 6
pr_numbers: [305, 306, 307, 308, 309, 311, 314]
status: closed
transcript: /home/eric/.claude/projects/-home-eric-muster/ad6dae92-c42a-4bbd-a9d3-2d195b6d80fc.jsonl
---

# Session 40 — 297-login-code-race

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: db:crew CLI + operator break-glass runbook (10.5, DEC-094, closes #286)

**Completed:**
- **Reframed 10.5** ("support channel") as the **operator break-glass kit** — the fast levers to fix a wedged pilot. A survey found the toolkit already deep (engine pause, `db:admin` revoke, `SESSION_SECRET` rotation, Xola re-pull, `reset-pilot`, seat overrides) with one real gap: no way to fix a crew member's phone/email short of raw SQL.
- **`db:crew` CLI** (`src/crew/crew-cli.ts` + `db/crew.ts`, `npm run db:crew`) — `list` + `set <id> --email/--phone/--name`, mirrors `db:admin`. E.164/email-validated, empty `--email=` clears. Also unblocks `db:admin add --email`.
- **Break-glass runbook** in `docs/DEPLOY.md` (fire → lever table) + **DEC-094** (CLI-over-UI, extends DEC-092; the rollback-ceremony cut recorded as meaningless pre-data).
- Driven live against local `muster-postgres` (set/clear/reject paths), roster restored to seed.

**Code review:** 3 findings, all **fixed before PR** — (1) whole-row upsert was a lost-update against the live-written `crew_members` → new **targeted `updateCrewContact`** port method (narrow UPDATE, contract-tested on both adapters); (2) no duplicate-email guard → now refuses a collision (login resolves to one crew); (3) mistyped flags silently no-op'd → now rejected.
**PR:** [#305](https://github.com/mobiustripper42/muster/pull/305)
**Points:** 3
**Branch:** task/10.5-operator-breakglass
**Opened at:** 2026-07-06T23:35:00Z

## Task 2: Crew onboarding + quick-start + add-to-home-screen (10.6/10.7, closes #287 #288)

**Completed:**
- Merged 10.6 + 10.7 (crew intro message and crew quick-start are one content source). Skipped as already-done: session-aware root redirect (#97), operator manual (#68, `OPERATOR_MANUAL.md`).
- **In-app orientation:** ask card now states the silent commit — "In = you're on for the whole day. Out = you're not." (`app/(crew)/crew/page.tsx`); new **public** server-rendered `/crew/help` orientation page, linked from crew home.
- **Installable PWA:** `app/manifest.ts` (navy theme, `start_url:/`, standalone) + generated navy-"M" icon set in `public/` (`scripts/gen-icons.mjs`, sharp) + `app/layout.tsx` viewport/appleWebApp/icons.
- **Docs:** `docs/CREW_QUICKSTART.md` (crew-facing twin of the help page) + `OPERATOR_MANUAL.md` "onboard a new crew member" playbook with the **canned welcome SMS copy** (operator-sent — no auto-trigger since crew are seed-created) + break-glass cross-link.
- e2e `crew-help` **6/6** desktop + 375px; `crew-ask` **3/3** (ask flow unaffected).

**Code review:** 2 findings, both **fixed before PR** — (1) help-link `spinner="overlay"` had no `relative` box (scrim mis-rendered) → default inline spinner; (2) `sharp` imported transitively via Next → declared in devDependencies + lockfile synced.
**PR:** [#306](https://github.com/mobiustripper42/muster/pull/306) — **stacked** on #305 (base `task/10.5-operator-breakglass`); retargets to main on #305 merge.
**Points:** 3
**Branch:** task/10.6-onboarding-docs
**Opened at:** 2026-07-06T23:47:00Z

**Next Steps:**
- **Backlog issues (all filed):** #316 (At-Risk board N+1 — 10s→sub-second; fix = hoist crew+reliabilityEvents out of the per-shift loop, diagnosis in issue), #317 (Cohort subject prefix + Cohort button on /crew/shift/[id]), #318 (all-staff broadcast misses recently-added crew + double-rings — stale membership), #293 (retire OPERATOR_CREW_MEMBER_ID — helper `listActiveAdminRecipients` already seeded), #301/#247/#189 (hardening / civil-hours / login throttle).
- **Horizon lever:** set `STAFFING_HORIZON_LEAD_DAYS` in Vercel + redeploy. Analysis favored **~12.1** (asks land Mon/Tue off-days, ~12d notice); operator to decide. Research prompt written for the muster chat.
- **Roster:** add remaining admins (`db:admin add` brendan/drew), enable inactive crew as they come online. Melissa Montague still ○.

**Context:**
- **This was a marathon (2026-07-06→07-09) that shipped FAR beyond the 2 logged /kill-this tasks** — the rest were manual PRs: **v1.0.0 production launch** (retro + promote-production), db:crew add/enable/disable (#307), operator At-Risk SMS alert DEC-095 (#308), go-time OM/docs rewrite — retired Outbox, killed "locked", fixed bail model (#309), SMS GSM-7 1-segment cost fix (#311), assigned-crew-on-shifts #310 (#314), STAFFING_HORIZON float lever. **All merged + promoted: prod is at v1.0.2, live on crew.brewcle.com.**
- **Prod ops gotchas (now in memory):** run `npm run verify` not just `build` (webpack skips exactOptionalPropertyTypes); **MCP for reads, CLIs for prod writes** (never MCP for migrations); env changes need a **redeploy**; `~/.muster-prod-db` = the **direct (non-`-pooler`) Neon string + `?sslmode=require`, no `channel_binding`**; Twilio env must be **Production-scoped** + fresh (no build cache) redeploy.
- `OPERATOR_CREW_MEMBER_ID` deleted in prod (eric is now normal crew → gets own placement notices). Twilio sender = Drew's registered 10DLC number (+19846006778).
- Wall clock is huge (multi-day span with overnights) — ignore; retro infers active time.
