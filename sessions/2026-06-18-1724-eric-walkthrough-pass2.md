---
session: 18
dev: eric
slug: walkthrough-pass2
branch: walkthrough-pass2
started: 2026-06-18T17:24:12Z
ended:
points:
pr_numbers: [88, 89, 91]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/4daf4597-f010-42e0-8823-7cb2fb10869e.jsonl
---

# Session 18 — walkthrough-pass2

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: #87 — split confirmed-seat vacate into Remove (no penalty) vs Bailed (logs lateness)

**Completed:**
- Core `vacateSeat()` in `src/asks/ask-loop.ts` — `bail()` minus `logShiftBailed`; exhausted pool rests at `Open` (not `Bailed`), removed occupant excluded from re-ask, same occupant-pin race guard.
- `removeSeat` server action in `app/(admin)/admin/shift/[shiftId]/actions.ts` (`removed=`/`raced`/`not_confirmed`/`unavailable`); `reportBail` unchanged for the Bailed button.
- `components/assignment/seat-card.tsx` — Confirmed seat now two buttons (plain Remove / red Bailed) + intro line.
- Cockpit `page.tsx` — `removed=` → no-penalty `ok` notice; generalized the shared `not_confirmed` copy (dropped "to bail", per review).
- `docs/DECISIONS.md` DEC-039 (supersedes the DEC-038 single button; explicit choice, not a default checkbox).
- `docs/E2E-PILOT-WALKTHROUGH.md` step 3.4b exercises the split; checklist synced.
- Tests: 3 new `vacateSeat` cases (no `shift_bailed`; empty pool → Open; occupant-pin → throws). `src/asks/` 71/71; both typechecks + `next build` green.
- NOTE: PR #88 bundles the whole pass-2 walkthrough (18 commits — cockpit/board copy across Parts 1–3 + this #87 split), committed directly onto `walkthrough-pass2` per operator call.

**Code review:** One finding — shared `not_confirmed` copy said "to bail," wrong on the Remove path; fixed (95783b4). Otherwise clean — faithful mirror of the bail path with the penalty removed.
**PR:** [#88](https://github.com/mobiustripper42/muster/pull/88)
**Points:** 3
**Branch:** walkthrough-pass2
**Opened at:** 2026-06-18T18:24:13Z

## Task 2: 5.4b — Xola live-API pull (Land adapter + hourly cron, DEC-036/DEC-040)

**Completed:**
- `src/import/xola-client.ts` — ported HTTP client (X-API-Key/X-API-Version auth, skip-pagination via `paging.next`, 3× retry w/ `Retry-After`) + pure `mapXolaOrders` (orders→records, one per item; phone from `order.phoneCanonical||phone`; status 700→cancelled; `arrivalDatetime` slice for vessel-local date/time).
- `src/import/xola-pull.ts` — pure orchestrator: `pullWindow`/`vesselLocalDate`/`addDays` + fetch→map→`importRecords`→`formShifts`.
- `app/lib/xola.ts` — only edge piece (reads `XOLA_*`, binds real `fetch`); `app/api/cron/xola-pull/route.ts` — hourly cron, fail-closed on `CRON_SECRET`, isolated from `tick`; `vercel.json` — 2nd cron `0 * * * *`.
- `src/import/import-reservations.ts` — `phone?` threaded through the seam (retires DEC-017 email-join), kept OUT of DEC-029 materiality.
- `docs/DECISIONS.md` DEC-040 (live-confirmed field mapping + poll/webhook/CSV sync strategy); `.env.example` XOLA_* contract.
- 41 unit tests (`src/import/`), incl. the real sandbox order as fixture. Core+app typecheck + `next build` green.
- Grounded on a live sandbox `GET /orders` (the user ran it via `!` — curl is hard-blocked for me, see memory). DEC-036's `expand` premise was wrong; corrected.

**Code review:** ship-able as-is; 3 findings applied — `||` phone fallback (empty canonical → phone), cron error echo narrowed to `XolaError` (no secret leak, full error logged), short-page pagination terminator documented. Retry/pagination both bounded; DST-safe window math; CRON guard matches `/api/cron/tick`.
**PR:** [#89](https://github.com/mobiustripper42/muster/pull/89)
**Points:** 5
**Branch:** task/5.4b-xola-api-pull
**Opened at:** 2026-06-19T00:30:00Z

## Task 3: Operator "Pull from Xola now" button on /admin/import (5.4b follow-on)

**Completed:**
- `app/(admin)/admin/import/actions.ts` — new admin-gated `pullFromXola` server action (mirrors `runImport`); calls the same `runXolaPull` the hourly cron fires; counts ride redirect params (codes only, DEC-026); distinct `x_not_configured` (env unset) vs `x_unavailable` (Xola down) errors.
- `app/(admin)/admin/import/page.tsx` — error copy, `xpull`/`fetched`/`xerr` params, result notice (clean zero-state), and the button form below the xlsx upload.
- A manual on-demand pull, independent of the cron — the "import now + watch counts" path for E2E and the pilot's first import. app typecheck + `next build` green.

**Code review:** clean bill — auth airtight, error handling leak-free, mirrors proven `runImport`. Two cleanups applied: contradictory zero-orders copy; dead `XolaError`/fallback ternary branch + its unused import.
**PR:** [#91](https://github.com/mobiustripper42/muster/pull/91)
**Points:** 2
**Branch:** task/xola-pull-button
**Opened at:** 2026-06-19T03:30:00Z

**Next Steps:**
- **Webhooks: abandoned, no 5.4c** (DEC-040) — they're an approved-App feature (App Store Console), production app approval is the unmet gate. Poll is the permanent ingest; cadence is the latency lever. Don't revisit unless a prod app lands.
- **Pre-production task list (before cutting/pointing the `production` branch):** (1) branch split — point Vercel's Production Branch at `production` (DEC-S022/DEPLOY.md step 4) so `main` stops auto-deploying live; (2) DB-isolation call — one Neon DB shared by preview+prod vs a separate staging DB (pilot-simple: test on local, treat Neon as prod-only); (3) set prod `XOLA_*` in Vercel (seller key w/ `orders` perm, base `https://xola.com/api`); (4) seed the real fleet/manning + crew roster + operator identity (the pull only fills reservations/events, not vessels/crew). Host is NOT open — DEC-033 resolved to Vercel+Neon (docs/DEPLOY.md). Current state per operator: `db:migrate` run against Neon; Vercel Production Branch still defaults to `main` (production branch not yet pointed).
- **E2E (walkthrough pass 2) not finished** — resume on local (mill-dev), continue the parts after 3.x.
- **Verify-at-pilot (DEC-040):** cancelled-*order* visibility (create a cancelled sandbox order); multi-guest party size on a 2+ order; sandbox product names not in `PRODUCT_MAP` (add them, or rely on prod's real names).
- **Stale Session 17** (`2026-06-17-1619-eric-its-alive-dxo3pr.md`) is still `status: open` — never `/its-dead`'d. Two open sessions confuse `/kill-this`'s `head -1`; close or abandon it.

**Context:**

**Context:**
