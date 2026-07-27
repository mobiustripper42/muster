# Shard E — Deploy / env / ops

**Subject:** how the app gets deployed and configured — the runbook and the local-dev guide.
**Audited tree:** `main` @ `5790ce2`. (`PILOT_RUNBOOK.md`, the third corpus doc, was deleted 2026-07-25.)

> **Which-tree check (lesson 4).** `DEPLOY.md` is byte-identical across trees. `RUNNING.md` differs by
> 24 lines, and that divergence is **deliberate** — `feature/reservations` retired `db:all` in favour
> of `db:reset:dev` (its DEC-137) and updated the quick-start accordingly. `db:all` is still real on
> `main` (`package.json`), so `main`'s copy is correct for `main`. Not a finding.

**Primary docs:** `docs/DEPLOY.md` (307), `docs/RUNNING.md` (205).
**Checked against:** every `process.env.*` read in `src/`, `app/`, `db/`; `package.json`; `app/lib/flags.ts`.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| E1 | `DEPLOY.md:24-40` (§Environment variables) | The runbook's env table — the list an operator configures a deploy from | **22 variables the code reads are absent from it.** Mechanically: the set of `process.env.*` reads across `src/`/`app/`/`db/` minus the documented set. The operationally load-bearing ones are listed below | CODE-CONTRADICTS | doc-wrong |
| E2 | `RUNNING.md:199` | "**Two** env vars are dev-defaulted locally but **must be set in production**:" | The list immediately under it has **three** bullets (`SESSION_SECRET`, `APP_BASE_URL`, `DATABASE_URL`) — and per E1 it is understated well beyond the off-by-one | MISMATCH | doc-wrong |

### E1 detail — what a deploy built from `DEPLOY.md` would be missing

| Variable(s) | Consequence if unset |
|---|---|
| `XOLA_API_KEY`, `XOLA_SELLER_ID` | **The import does not run.** `/admin/import` returns "Xola isn't configured on this server (XOLA_API_KEY / XOLA_SELLER_ID unset) — nothing was pulled." This is the primary data ingest (DEC-036/043) |
| `CREW_SELF_SERVE` | **Crew cannot sign in.** `flags.ts:11` gates the code-login front door on `=== "1"`, and it is OFF by default so `main` stays promotable — meaning prod must set it explicitly |
| `RESEND_API_KEY`, `EMAIL_FROM` | No email delivery — the 6-digit login code has no way out (DEC-081) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_MESSAGING_SERVICE_SID` | No SMS channel (DEC-MSG-1) |
| `TENANT_ID`, `TENANT_NAME` | Tenant identity/labelling falls to defaults |
| `PICKUP_LOCATION`, `PICKUP_MAP_URL` | The crew shift card's dock pin (SPEC §2.6.3, a binding constraint) |
| `MESSAGING` | The messaging flag — currently off by choice, but undocumented as a lever |
| `XOLA_API_BASE`, `XOLA_API_VERSION`, `PAY_PERIOD_ANCHOR`, `OUTBOX_TEST_PHONE`, `TEST_DATABASE_URL` | Lower-stakes; defaults exist |
| `NODE_ENV`, `VERCEL_ENV` | Platform-injected — correctly absent from an operator's checklist |

**Severity: this is the highest-consequence finding in the audit that is still live.** Every other
shard found documents that described the system wrongly. This one found a document that, followed
exactly, produces a deployment where **crew cannot log in and no reservations import.** The runbook's
whole job is to be followed literally by someone who doesn't hold the system in their head.

Mitigating: the current production deploy plainly works, so the real environment has these set — they
were configured as each feature landed and never backfilled into the runbook. The gap bites the *next*
deploy (a rebuild, a second environment, a disaster-recovery restore), not the running one.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | verified against |
|---|---|
| `DATABASE_URL_UNPOOLED` — "auto-injected — the **direct** endpoint … migrations/seeds only" | Correct. Read by no app code *by design* — it is an operator-facing shell var for DDL that breaks through PgBouncer. Looked like a phantom entry; it isn't |
| `STAFFING_HORIZON_LEAD_DAYS`, `XOLA_PULL_LEAD_DAYS`, `ASK_DRIP_INTERVAL_MINUTES`, `ASK_SILENT_TIMEOUT_MINUTES` | All genuinely read (`src/builder/derive.ts`, `src/asks/ask-loop.ts`, `src/builder/tick.ts`). A naive `process.env.X` grep misses them — they are accessed indirectly. **Checked before claiming; shard F's lesson 1 in practice** |
| `RUNNING.md` quick-start documents `db:all` | Real on `main` (`package.json`). Retired only on `feature/reservations` per its DEC-137 |
| `SESSION_SECRET` / `APP_BASE_URL` prod fail-fast rationale | Matches `app/lib/auth.ts:32` and the DEC-026 host-poisoning posture |

## Coverage

Read in full: `DEPLOY.md` §Environment variables, §Steps 0–7b headings, `RUNNING.md` §Quick start and
§Production notes. Structurally only: `DEPLOY.md` steps 3–6 shell blocks (smoke-check commands were
not executed — they need a live deploy), `RUNNING.md` §§ browser / crew app / at-risk / cockpit /
outbox walkthroughs. **The smoke-check commands in step 6 are UNVERIFIABLE from the repo** and are the
most likely remaining rot in this corpus.
