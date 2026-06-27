---
session: 29
dev: eric
slug: 160-outbox-relay-ergonomics
branch: task/160-outbox-relay-ergonomics
started: 2026-06-26T22:22:03Z
ended:
points:
pr_numbers: [165]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/654055f2-9b19-4465-b5fe-4f24785f87c6.jsonl
---

# Session 29 — 160-outbox-relay-ergonomics

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: The Smart Doorbell decider (6.4, #114)

**Completed:**
- The crown-jewel pure decider on `feature/messaging` (DEC-059): `src/messaging/doorbell-decider.ts` — `decideNotifications(input) → NotificationDecision[]` over injected `(pendingMessages, threadMembers, presence, readState, notifyState, rules, now)`, no I/O, injected `now` (DEC-048). All six artifact §7 rules: presence-suppression, in-app toast, first-only-until-read, batch/cancel window, priority jump, short-notice-as-text.
- **Architect-gated (DEC-068):** presence enters as a per-`(subject,thread)` **three-state** verdict (`present_here|present_elsewhere|absent`) classified **at the edge** — v1 emits only elsewhere|absent, so DEC-047's realtime swap stays a zero-decider-change adapter. Present-tense decisions only (DEC-049 — tick re-runs each sweep); rings on `threadMembers` never a readers set (DEC-058/052); never composes an SMS string. `makeDoorbellRules` enforces the DEC-060 `presence>batch` invariant `tenant.ts` handed to 6.4.
- **No migration** — read-state/priority storage is 6.6 wiring (inject-don't-persist); `priority` rides the `PendingMessage` DTO so 6.6's column flows in unchanged.
- `src/config/tenant.ts` `DOORBELL_SHORT_NOTICE_MAX_CHARS` (§7.5, env-tunable, default 160) + `envPositiveInt`; DEC-068; `.env.example` doorbell knob block (DEC-060 trio was undocumented on this branch); messaging barrel export.
- **Verification:** core typecheck (`noUncheckedIndexedAccess`) ✓, app typecheck ✓, `next build` ✓, 42 decider + 55 messaging tests ✓. No e2e/screenshot (pure fn, no UI).

**Code review:** `@code-review` — logic sound, **no blockers**. Real fold-in: `NaN` from a malformed timestamp was failing toward **silence**, contradicting the module's "fail toward ringing" invariant (and the outlier vs sibling `presence.ts`/`reliability-score.ts`) → `parseOrNull(NaN)→null`, `isReadBy`/`ageKey` treat unparseable stamps as unread/−∞-old → rings. Also: full positive/finite window validation in `makeDoorbellRules`; `notifiedSinceRead` `>=`→`>` (§7.3 tie re-arms). +11 tests.
**PR:** [#165](https://github.com/mobiustripper42/muster/pull/165)
**Points:** 8
**Branch:** task/114-doorbell-decider (base: feature/messaging)
**Opened at:** 2026-06-26T23:59:32Z

**Next Steps:**
- **6.5 (#115)** — the human-drivable doorbell harness — is the intended next stacked task on `feature/messaging` (branch off `task/114-doorbell-decider` or `feature/messaging` after #165 merges). It makes the decider observable.
- Fold the doorbell env knobs into `docs/DEPLOY.md` when `feature/messaging` reconciles with main's #157 env-docs (deferred to avoid a doc-merge tangle now).

**Context:**
- Phase 6 lives on `feature/messaging` (DEC-059), intentionally behind main (no S28 pilot-hardening) and behind on DEC numbers (max DEC-060 vs main's DEC-067) — DEC-068 numbered past 067 so the eventual merge carries no duplicate. `feature/messaging` already had 6.1 (msg store #134), 6.2 (presence #143), 6.3 (windows DEC-060 #144).
- The decider is built but **not wired** — delivery is 6.6, observability is 6.5. Read-state + a `messages.priority` source don't exist yet; the decider consumes them injected.
