---
session: 35
dev: eric
slug: dec084-followup-notices
branch: task/dec084-followup-notices
started: 2026-07-02T17:32:36Z
ended:
points:
pr_numbers: [228, 229]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/96d3b86b-4fd0-412f-a6a3-e27eaff45ed7.jsonl
---

# Session 35 — dec084-followup-notices

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Plan Phase 9 + Phase 10 (capture)

**Completed:**
- `docs/PROJECT_PLAN.md` — **Phase 9** "Finish the production build" (~42 pts, 9.0–9.10: MCP fast-fix loop, #215/#224/#225/#226 fast-follows, two-pane responsive builder, board/cockpit/a11y/low-polish bundles, civil send window, freshly-spawned cue) + **Phase 10** "Production Ops & Onboarding" (10.1–10.7: migration/Neon-backdoor safety, admin deprovision [required], **security audit** [required], rollout runbook, support, onboarding, end-user docs) + a post-launch reliability-loop callout.
- `docs/DECISIONS.md` — **DEC-085** (Shift Builder responsive dual-form-factor over one no-JS core; blesses day-grouping vs SPEC §2.3) + **DEC-086** (vessel/role identity palette — color encodes information, refines DEC-021).
- `docs/design/BUILDER-RECONCILIATION.md` (new) — the two-Fable-lens adopt/supersede punch-list + owner rulings + the production-need scan.
- `docs/FUTURE_IDEAS.md` — 3 verdicts repointed (civil-send → 9.9, admin-deprovision → 10.2, post-shift/reliability → post-launch #1).

**Code review:** Docs-only planning PR — no code, so no @code-review/build (a full verify would burn a cycle for zero code change). Self-checked: Phase 9 sums to 42; DEC-085/086 well-formed + before DEC-TBD; cross-refs valid.
**PR:** [#228](https://github.com/mobiustripper42/muster/pull/228)
**Points:** — (planning capture, unpointed)
**Branch:** task/plan-phase-9-10
**Opened at:** 2026-07-03T03:37:42Z

## Task 2: SMS consent block on public crew login (Twilio 10DLC) — #229

**Completed:**
- `app/(crew)/crew/page.tsx` — `SmsConsentBlock` in the login email step: unchecked-by-default checkbox + full verbatim disclosure + Privacy/Terms links → `brewcle.com/privacy-policy/`. **Never gates login.**
- `app/(crew)/crew/actions.ts` — best-effort consent write in `requestLoginCode` (via `after()`, roster-match only, fully swallowed — no enumeration leak DEC-081, never blocks login).
- `app/lib/sms-consent.ts` (new) — versioned disclosure copy (v1), the string stored on opt-in.
- `db/migrations/0017_sms_consent.sql` (new) + `SmsConsent`/`SmsConsentId` + `recordSmsConsent`/`listSmsConsentsForCrew` on the port + pg/in-memory adapters + contract test (append-only, order, null-phone). `sms_consent` added to the pg test truncation list.
- `npm run verify` green (typecheck ×2 + **820 tests** + build); pg contract runs against real Postgres.

**Deploy note:** the block renders only when **`CREW_SELF_SERVE=1`** (the self-serve login-form gate) — must be set in prod for the vetter to see it. 7.0b already wired the email delivery it gates on.
**Code review:** @code-review — clean bill of health. No-enumeration preserved, best-effort containment confirmed, storage parity clean, PII/security clean (parameterized, rel=noopener, static disclosure), requirements met. Intentional notes: one URL for Privacy+Terms (per handoff), disclosure = two synced copies (plain for storage / JSX for render).
**PR:** [#229](https://github.com/mobiustripper42/muster/pull/229)
**Points:** 3
**Branch:** task/sms-consent-login
**Opened at:** 2026-07-03T13:19:32Z

**Next Steps:**
- **SMS consent (#229) is the time-sensitive one — Twilio 10DLC.** Merge it into the promote. **Requires `CREW_SELF_SERVE=1` in prod** or the vetter won't see the block. After deploy, grab the public `/crew` URL for the Twilio opt-in field (replaces the Google Drive link).
- **Merge #228** (Phase 9/10 plan), then the boundary sequence: **`/start-phase` Phase 9** (relabel #215/#224/#225/#226 to `phase:9` + points; create issues for 9.0/9.5–9.10) → **`/retro` Phase 8** (close; patch+minor bump) → **`/promote-production`**.
- Then build Phase 9 from **9.0 (MCP fast-fix loop)**. @architect gates before 9.5 (two-pane) + on the 9.6 palette (DEC-086 vs DEC-021).
- Migrations **0014–0017** need out-of-band apply before the promote (operator) — 0017 = `sms_consent` (best-effort write, so an unapplied 0017 won't break login).

**Context:**
- **Design decisions locked (Eric, 2026-07-03):** responsive dual-form-factor — desktop-app + mobile-app both first-class, no squish (DEC-085); vessel/role hue = information, so allowed against the DEC-021 palette lock (DEC-086); no-JS kept (break only for a recorded reason). Saved to memory (`dual-form-factor-coequal`, `color-encodes-information`).
- **Production-need scan:** civil send window + admin deprovision are pre-launch **required**; per-vessel qualification + capacity-stomp stay **parked** (Xola is truth for now); reliability loop is **post-launch #1**.
- **Fable one-off:** the reconciliation ran on Fable per owner override; DEC-S029 (Fable disabled) stays in force.
- Orphan branch `claude/muster-next-phase-dfupeo` (4 commits, superseded Phase 6 planning) still awaiting delete — offered, not yet actioned.
