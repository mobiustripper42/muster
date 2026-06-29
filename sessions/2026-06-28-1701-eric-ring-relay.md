---
session: 31
dev: eric
slug: ring-relay
branch: task/ring-relay
started: 2026-06-28T17:01:24Z
ended:
points:
pr_numbers: [187]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/6949131b-eb90-45d0-b62e-967f65b289ef.jsonl
---

# Session 31 — ring-relay

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Version tag — lower-right build stamp on /admin + /crew menus

**Completed:**
- New `components/ui/version-tag.tsx` server component — fixed bottom-right, muted (`text-muted`), `pointer-events-none select-none aria-hidden`; renders `v{version}` (+ ` (sha)` on Vercel); null-guards a missing env.
- `next.config.ts` forwards `npm_package_version` → `NEXT_PUBLIC_APP_VERSION` (the load-bearing plumbing — without `NEXT_PUBLIC_` it never reaches the render).
- Mounted on the signed-in `/admin` hub + `/crew` menu only (before `</Shell>`) — **not** in shared `Shell`, which is what keeps it off every sub-page.
- `e2e/version-tag.spec.ts` (present on /admin & /crew, absent on /admin/outbox) + added to the 375px mobile testMatch.
- Verified: typecheck core+app ✓, build ✓, version-tag e2e 4/4 (desktop+mobile) ✓, auth-crew+admin-nav 11/11 (no regression) ✓, 375px screenshots eyeballed (muted corner, clears content).

**Code review:** `@code-review` — **clean bill of health**; env plumbing, null-guard, per-page mounting, brand token, e2e locator, and z-index vs the #176 drawer all verified. Nothing folded.
**PR:** [#187](https://github.com/mobiustripper42/muster/pull/187)
**Points:** 2
**Branch:** task/version-tag-corner
**Opened at:** 2026-06-29T16:24:26Z

**Next Steps:**
- **#186** (filed) — ring card "no phone but shareable" Web Share gap; low-priority fast-follow.
- **#173** DM-visibility disclosure — thin trust fast-follow; PM flagged pulling it into Phase 7 early slack before it rots.
- **#119** (6.9 Twilio) — deferred off-phase, 10DLC-gated (weeks out); resurfaces when the number clears.
- Phase 7 (Pass D) already has **5 open issues materialized** — `/start-phase 7` must mind them (don't double-create).

**Context:**
- **Headline: Phase 6 shipped to production this session.** `feature/messaging` → `main` via **PR #179** (7-conflict + 1-ripple reconciliation, fully verified), Phase 6 retro closed it (**v0.8.0** tagged on main), and `/promote-production` ff-merged `main` → `production` (ff6c149 → e525ae0).
- Prod readiness confirmed before promote: migrations **0008/0010/0011** applied (Method B, 6 rows); `OPERATOR_CREW_MEMBER_ID=crew-eric-stoffer` + `APP_BASE_URL` set.
- Messaging is live behind the **manual operator ring-relay** (Twilio 6.9 deferred). **Verify on prod:** v0.8.0 (+ commit hash) shows at /admin & /crew; the doorbell cron rings into /admin/outbox **without self-ringing the operator** (the DEC-072 exclusion test).
- Version tag reads `v0.8.0` locally (no hash); the commit hash only appears on Vercel.
