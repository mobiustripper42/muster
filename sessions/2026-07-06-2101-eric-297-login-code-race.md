---
session: 40
dev: eric
slug: 297-login-code-race
branch: task/297-login-code-race
started: 2026-07-06T21:01:31Z
ended:
points:
pr_numbers: [305, 306]
status: open
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

**Context:**
