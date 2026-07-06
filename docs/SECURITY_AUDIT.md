# Security Audit — Phase 10.3 (#284)

**Date:** 2026-07-06 · **Scope:** full pre-production review · **Status:** launch-gating review complete.

**Method.** Five dimensions reviewed in parallel (auth & session; crew data authorization; admin-gate
coverage; input handling & endpoints; secrets/PII/rate-limits), then each finding **adversarially verified**
against the code before landing here. Covers the whole app, with focus on the Phase-10 auth surface (DEC-092
admin entity, DEC-093 switcher, DEC-081 crew code login now live in prod).

## Executive summary — launch posture

**The load-bearing controls hold.** The authorization boundary the no-RLS model depends on is **intact**;
admin-gate coverage is **100%**; the switcher escalation seam is **correctly gated**; no production secret is
committed, logged, or shipped to the client; input handling is clean (no XSS, fully parameterized SQL).

**No confirmed launch-blocker in code.** The one CRITICAL an agent raised (dev-link → unauthenticated prod
admin session) was **verified false**: it assumed `main` deploys hit the prod Neon DB, but `vercel.json`
`git.deploymentEnabled.main:false` (#138) means `main` never deploys — there is no `main`-preview URL, so
dev-link (isolated-preview-only) can't reach prod. Downgraded to LOW.

**Three items need the operator's decision** (not code bugs — policy / accepted-risk calls): the login-code
attempt-cap concurrency race, and two privacy *disclosure* gaps (operator reads crew DMs; guest phones shown
to crew). See **Decisions** below.

## Decisions required before launch

1. **Login-code attempt cap is not concurrency-safe** *(HIGH — recommend fixing).* `verifyLoginCode`
   (`src/auth/login-code.ts:208-211`) checks a stale `attempts` then bumps in a separate UPDATE — so K
   concurrent guesses against one code all read `attempts=0` and bypass the 5-guess ceiling. Since admins now
   sign in via crew code login (DEC-093), a guessed crew-admin code → admin access. The project already
   documents the *sustained-rate* weakness as pilot-accepted (#189), but the **concurrency bypass is sharper**
   (thousands of guesses within one code's 10-min TTL). **Fix:** atomic `UPDATE … SET attempts=attempts+1
   WHERE attempts < 5 RETURNING …` (a new repo method). **Your call:** fix now (I'll do it) or fold into #189.
2. **Operator can read all crew↔crew DMs** *(HIGH — disclosure).* By design (DEC-052/070/072):
   `buildThreadView` (`src/crewapp/thread-view.ts:106-114`) resolves any thread for an admin with no
   membership check; the operator sees every DM word (cannot post). But crew see the label **"Direct
   message"**, which implies privacy, with no disclosure that the office reads it. **Your call:** confirm this
   is the intended model, and add crew-facing disclosure so the label isn't a false promise.
3. **Guest (customer) phone shown to all crew on a shift** *(MEDIUM — confirm intent).*
   `crew/shift/[shiftId]/page.tsx:270` renders the booking's `{g.phone}` + `tel:` to every seated crew member
   (shift-scoped). Customer PII from Xola. Likely intended (contact no-shows) but needs confirmation + coverage
   in the customer privacy disclosure.

## Findings

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| 1 | ~~CRIT~~→LOW | Auth | dev-link mints sessions on previews; **prod-DB chain is closed** (#138, verified). Residual: previews mint on isolated DBs; the 400 enumerates active admin handles. | Filed (Vercel Deployment Protection + stop handle-echo) |
| 2 | HIGH | Auth | Login-code attempt-cap concurrency race (see Decision 1). | **Decision** |
| 3 | HIGH | PII | Operator reads crew DMs; "Direct message" label undisclosed (Decision 2). | **Decision** |
| 4 | MED | PII | Guest phone shown to crew (Decision 3). | **Decision** |
| 5 | MED | DoS | `/api/health` ran ~12 full-table scans unauthenticated per hit (compute amplification). | **Fixed** — cheap `select 1` |
| 6 | MED | Abuse | `requestLoginCode` has no per-IP throttle → email-bombing a roster address once code-login is live (it is). | Filed (extends #189) |
| 7 | MED | Auth | No crew-session revocation + indefinite sliding expiry: a removed crew / stolen cookie keeps access until `SESSION_SECRET` rotation (nukes all). By design (DEC-092 scoped revoke to admins). | Filed (needs decision) |
| 8 | LOW | Secrets | `..env.local.swp` tracked; `.gitignore` had no `*.swp` rule (a populated swap would leak secrets). | **Fixed** — untracked + `*.sw[a-p]` rule |
| 9 | LOW | AuthZ | `?claimed=<shiftId>` note rendered without a membership check (existence oracle + spoofed "you're on"). | **Fixed** — gated on the viewer's own shifts |
| 10 | LOW | Endpoint | Cron `CRON_SECRET` compared with `!==` (non-constant-time). Fails closed if unset. | Filed (low) |
| 11 | LOW | Input | Message `body` has no length cap (bounded only by the 6 MB action limit). No XSS. | Filed (low) |
| 12 | LOW/INFO | Auth | Self-hosted deploy with `NODE_ENV` unset → dev signing secret + dev routes live. Vercel prod is safe (`VERCEL_ENV`). | Filed (info; matters only if self-hosted) |
| — | INFO | Config | `xola-pull` cron route claims `0 * * * *` but isn't in `vercel.json` crons — the hourly pull won't fire. **Functionality, not security.** | Filed (Phase 10) |

## Confirmed safe (verified, no exploit found)

- **Crew data isolation (no-RLS boundary holds).** Every id-taking crew action re-checks ownership against the
  signed-session `subject.id` before acting: `respondToAsk` (ask.crewMemberId), `bailFromSeat` (seat occupant
  + Confirmed), `claimSeat` (re-validates the predicate, writes the subject's id), messaging (all thread ops
  gate on `deriveMembers`/participant set — a guessed `threadId` returns null), shift drilldown (`buildShiftCard`
  null unless seated). Crew A cannot read or mutate crew B's data by manipulating an id.
- **Admin-gate coverage: 100%** — 9/9 admin pages and 23/23 admin server actions independently gate on
  `subject.kind === "admin"` (the layout gate is cosmetic; each surface self-gates; actions re-check).
- **Session HMAC** — signature checked before parse (no oracle), `timingSafeEqual` + length guard, expiry
  strictly enforced; forgery needs the secret. **Magic links** — 256-bit, hash-only, TTL, single-use CAS.
  **Switcher** — `switchToAdmin` gated on `getAdmin(active)`, `redirect()` halts before the mint.
  **No-enumeration** login (identical match/miss response; delivery deferred via `after()` to kill the timing oracle).
- **Secrets** — `SESSION_SECRET`/`CRON_SECRET` fail-fast/closed in prod; `APP_BASE_URL` fail-loud
  (host-poisoning); no secret logged or in `NEXT_PUBLIC_*`; login-code echo gated to non-prod. No committed credential.
- **Input** — no `dangerouslySetInnerHTML`; every redirect param is code→copy-mapped, id-resolved, or
  numeric-guarded (DEC-026 held); SQL fully parameterized; Xola input validated; open-redirect prevented.
- **Neon preview→prod backdoor** — closed (#138); verified via the Vercel API (zero `main` deploys).
- **Web Share / relay** — carries no recipient phone (verified). **sms_consent** — TCPA-clean, no over-collection.

## Fixed in this PR

`/api/health` → cheap `select 1` (was an unauth full-DB scan); `..env.local.swp` untracked + `.gitignore`
`*.sw[a-p]` rule; `?claimed` note gated on the viewer's own shifts.

## Filed issues

- **#297** — login-code attempt-cap concurrency race (HIGH; Decision 1).
- **#298** — operator-reads-crew-DMs disclosure (Decision 2).
- **#299** — guest phone shown to crew (Decision 3).
- **#300** — crew-session revocation gap (decision).
- **#301** — low-severity hardening bundle (cron timing-safe compare, message body clamp, dev-link handle-echo,
  relocate the integrity scan to an authenticated diagnostic, self-hosted `NODE_ENV`, Vercel Deployment Protection).
- **#302** — `xola-pull` cron not scheduled (functionality).
- **#189** — (pre-existing) per-target daily re-mint cap + per-IP throttle for code login (extends finding 6).
