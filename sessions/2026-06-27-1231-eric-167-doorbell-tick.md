---
session: 30
dev: eric
slug: 167-doorbell-tick
branch: task/167-doorbell-tick
started: 2026-06-27T12:31:54Z
ended:
points:
pr_numbers: [171]
status: open
transcript: /home/eric/.claude/projects/-home-eric-muster/6ff44aec-cd6a-4598-9273-f798a6c7d340.jsonl
---

# Session 30 — 167-doorbell-tick

<!-- Task blocks appended by /kill-this, one per task. -->

## Task 1: Crew messaging UI (6.7, #117)

**Completed:**
- The crew chat surface (artifact §10) on `feature/messaging`: thread list (all-staff / today's cohort / your shifts / DMs), thread view + compose, **start-a-DM from a shift card**, in-app unread **badge** (§7.6 — calm accent, not an alarm color). Pure server components, refresh-to-see-new (no socket, DEC-045). **No migration** (0008+0010 already had everything).
- Core view-models `src/crewapp/thread-list.ts` (`buildThreadList` + the shared `myThreads` assembly + `threadMembership` auth + `countUnread`, unread rule mirrors the decider) + `thread-view.ts` (`buildThreadView`), both unit-tested. New port method `listDmThreadsForCrew` (participant→thread index, both adapters + contract); `participantId()` helper; `app/lib/tenant.ts` (`TENANT_ID`).
- **Architect's catch (the headline):** 6.7 is the first production call-site for **both** `recordRead` AND `recordActivity` — presence was uncalled, so the doorbell's present-suppress/toast branches were dead in the pilot. Both now recorded together on real human view via a **client-beacon island** (DEC-055 carve-out, `app/(crew)/crew/activity/route.ts` + `ActivityBeacon.tsx` mounted in `(crew)/layout.tsx`) — immune to the prefetch/unfurl/bfcache false-reads a server-GET write would suffer (each silences a real ring). **DEC-071.**
- **Verified:** core+app typecheck ✓, build ✓ (3 routes registered), 239 unit ✓ (incl. Postgres parity 47), e2e 4/4 ✓ on desktop + the 375px pass, 375px screenshots eyeballed.

**Code review:** `@code-review` — **no blockers**. Folded the one real finding: a **day-boundary membership divergence** (doorbell rings on `deriveMembers`, viewing gated on the date-filtered list → "rung-but-can't-read" at the vessel-day rollover). Viewing/posting now authorize a persisted thread via the **same date-agnostic `deriveMembers` the doorbell rings on** (`threadMembership`); the date filter stays in list *display* only. Bonus: `postMessage` preserves a standing thread's `createdAt`. +1 regression test (past-shift-still-opens).
**PR:** [#171](https://github.com/mobiustripper42/muster/pull/171)
**Points:** 5
**Branch:** task/117-crew-messaging-ui (base: feature/messaging)
**Opened at:** 2026-06-27T16:04:44Z

**Next Steps:**
- **6.8 (#118)** — operator messaging surface **+** the deferred operator-outbox relay of doorbell rings (the real `NotificationPort` adapter replacing the fake/log). **Must land before Phase 6 is promoted** (record-on-decide under fake delivery silently suppresses — DEC-070). 6.8 also wires the **operator branch of the DEC-052 auth predicate** (read any thread incl. DMs) — `threadMembership` is written so it ORs in without a rewrite. Operator-set **priority** + any all-staff broadcast lock also live here.
- Then **6.9 (#119, Twilio/second number, 10DLC-gated)** closes the phase.
- The **live popping toast** (vs the v1 refresh-time badge) waits on the realtime socket (DEC-047) — deferred with instant chat (DEC-045).
- Fold the doorbell + messaging env knobs into `docs/DEPLOY.md` when `feature/messaging` reconciles with main's #157 env-docs (still deferred).

**Context:**
- Phase 6 lives on `feature/messaging` (DEC-059), behind main on pilot-hardening + DEC numbers (max here is now DEC-071 vs main's DEC-067; DEC-068+ numbered past 067 so the eventual merge carries no dup). #117's PR targets `feature/messaging`, NOT main — `closes #117` won't fire until feature/messaging merges to main (same as #111–#116/#167, all still open).
- **Crew-compose policy (DEC-071):** crew may post in any thread they're a member of, incl. all-staff. If that proves noisy at pilot, an operator thread-lock is the 6.8 refinement.
- `myThreads` (date-filtered) = the **list display**; `threadMembership` (date-agnostic, deriveMembers) = the **view/post authorization**. Don't re-merge them — the split is the rung-but-can't-read fix.
