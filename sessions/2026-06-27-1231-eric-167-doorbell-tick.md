---
session: 30
dev: eric
slug: 167-doorbell-tick
branch: task/167-doorbell-tick
started: 2026-06-27T12:31:54Z
ended: 2026-06-28T14:21:04Z
points: 18
pr_numbers: [171, 172, 175, 176, 178]
status: closed
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

## Task 2: Operator messaging surface (6.8, #118)

**Completed:**
- `/admin/messages` — the operator reads **every** thread (DEC-052 cross-visibility, incl. crew DMs) and posts to the two broadcast doors (all-staff + today's cohort) as the office, optional priority. Stacked on 6.7 (PR base = task/117). No migration.
- **Reuse, not fork** (architect-gated): `buildThreadView` gains an **admin branch** (one DEC-052 auth site) + a shared `shapeMessages`; `mine` = the office's one voice (`senderKind==="admin"`). New `src/admin/operator-threads.ts` `buildOperatorThreads` (post-targets ∪ `listThreadsWithMessages`, dedup real-over-synth, recency). `threadTitle` gains a `viewerCrewId: null` (operator) branch → DM titles name both sides. `operatorPostTargets`/`operatorStandingTarget` in thread-list.
- **The `crew-eric-stoffer` correction's load-bearing fix:** the operator is a **seated** crew member (DEC-030 operator-as-crew), so they're a member of all-staff + their shifts — every broadcast would self-ring them. The doorbell tick now **excludes `OPERATOR_CREW_MEMBER_ID` from ring-membership** (passed from `app/lib/doorbell.ts`). DEC-072 pins the invariant. ⚠️ Ops: `OPERATOR_CREW_MEMBER_ID` env must = `crew-eric-stoffer` in prod (defaults to `crew-spink`).
- **DEC-072.** Verified: typecheck core+app ✓, **636 unit** ✓ (Postgres parity 47), build ✓, operator e2e 4/4 ✓ (desktop + 375px), screenshots eyeballed.

**Code review:** `@code-review` was **529-down** (overloaded, twice) → **self-reviewed**. Caught + fixed one real issue: the operator post action resolved *any* existing thread, so the office could inject into a private crew↔crew **DM**. Restricted to the two broadcast doors (#118 AC) via `ThreadView.canPost` (gates compose UI) + post-action rejection; every other thread is read-only. Re-run `@code-review` on merge if the API recovered.
**PR:** [#172](https://github.com/mobiustripper42/muster/pull/172)
**Points:** 3
**Branch:** task/118-operator-messaging (base: task/117-crew-messaging-ui)
**Opened at:** 2026-06-27T18:05:37Z

## Task 3: Real doorbell-ring relay — the promotion gate (DEC-073)

**Completed:**
- The deferred ring relay (the thing that must land before Phase 6 promotes, DEC-070): swapped `FakeNotificationChannel` → `OutboxNotificationChannel` (`src/adapters/outbox-notification-channel.ts`, swapped at `app/lib/doorbell.ts`) — each ring enqueues a `RingOutboxEntry` (thread deep-link) the operator texts from `/admin/outbox`'s new "New messages" section. DEC-030 web-link model, mirroring asks. Stacked on 6.8 (base task/118).
- **Own `ring_outbox` table** (`db/migrations/0011`, architect's call over a union — keeps the ask outbox's NOT NULL invariant). `RingOutboxEntry` + 4 port methods + both adapters + contract. **Drop-on-read** (`buildRingOutboxView`): a ring self-clears once `message_reads.last_read_at >= createdAt` (reuses DEC-069 — the architect's catch; without it the worklist rots). **Thread deep-link** in `/crew/auth` (`&thread=` → validated, server-built `/crew/threads/{id}` redirect; no open-redirect; leans on DEC-071 beacon-only read-marking). `RelaySend` generalized to an `onRecord` prop (asks/rings share the hardened island).
- **DEC-073.** Verified: typecheck core+app ✓, **643 unit** ✓ (Postgres parity 48), build ✓, ring-relay e2e 3/3 ✓ (priority-broadcast→tick→outbox, deep-link lands in thread, tampered-param→/crew), ask+messaging e2e regression 5/5 ✓, 375px screenshot. **Migration 0011 to run on dev/prod.**

**Code review:** `@code-review` — **no blockers**; deep-link security + drop-on-read traced clean. Folded the one finding with teeth: the cron's `linkBase` silently fell back to `localhost` when `APP_BASE_URL` unset → dead-linked rings; now **throws in prod**. + a ring-id delimiter note. Nits left (e2e `CRON_SECRET` dev-shell mismatch, an unused status index mirroring 0005) non-blocking.
**PR:** [#175](https://github.com/mobiustripper42/muster/pull/175)
**Points:** 5
**Branch:** task/ring-relay (base: task/118-operator-messaging)
**Opened at:** 2026-06-27T20:09:52Z

## Task 4: Persistent admin nav shell (#174)

**Completed:**
- A sticky admin nav above every `/admin/*` surface — wayfinding only (no restyle, no hub/data/color change). On `main`, **not** the messaging stack (PRs straight to main per the issue).
- `app/(admin)/admin/layout.tsx` — NEW route-group layout: renders `<AdminNav>` only for an admin subject (`readSubject`); per-page gates untouched. `components/admin/admin-nav.tsx` — the one client island: `usePathname` active highlight, `Muster` → hub + the four built surfaces, `aria-label="Admin"`, existing tokens, no hamburger.
- Verified: `npm run verify` ✓ (typecheck ×2, full suite, build), admin-nav e2e **6/6** ✓ (desktop + 375px: admin sees nav, highlight follows route, signed-out + crew see no chrome), 375px screenshot eyeballed (single row fits).
- **Follow-up commit (operator-revised AC):** the "no hamburger" call was wrong for the pilot — added a **responsive mobile hamburger → right slide-in drawer** (backdrop, closes on link/backdrop/Escape, `inert` while closed; desktop inline unchanged). Pushed to the **same #176**. e2e 7/7+1-skip (mobile drawer toggle via `aria-expanded`). **Verified in an isolated git worktree** — Eric's `npm run dev` on :3000 held Next 16's per-dir lock, so the main-dir e2e/`next build` couldn't run without clobbering his `.next`; the worktree ran it cleanly (his server untouched).

**Code review:** `@code-review` — **no blockers** (reviewed the pre-drawer commit); auth gating + highlight logic + island scoping all clean. Folded one nit: `aria-label="Admin"` on the landmark + scoped the e2e to it. Left the dev-only env-banner 4px overlap + the by-design dark cockpit highlight. (The drawer follow-up wasn't separately re-reviewed — standard component, e2e-covered.)
**PR:** [#176](https://github.com/mobiustripper42/muster/pull/176)
**Points:** 2
**Branch:** task/174-admin-nav (base: main)
**Opened at:** 2026-06-27T20:20:56Z

## Task 5: Outbox card fixes — Copy, mobile overflow, Dismiss|Send (#177)

**Completed:**
- Operator-reported bugs on the #160 outbox card (on `main`): (1) **Copy didn't work** — `navigator.clipboard` is undefined over `http://mill-dev` (Tailscale, insecure context) → added an `execCommand('copy')` fallback (`copy-button.tsx`). (2) **Copy button shoved off-card on mobile** — long magic-link URL forced the flex row wider → `min-w-0` on the message so it wraps. (3) **Dismiss → In/Out idiom**: pending card actions reworked to a 2-col **white/red Dismiss | green/white Send** bar matching the operator's-own-ask Out|In (`outbox-card.tsx`); sent card keeps its muted layout.
- Verified: core+app typecheck ✓, outbox e2e **4/4** ✓ (desktop + 375px: Copy→"Copied ✓", Send→compact "Sent ✓", Dismiss-clears-card), 375px screenshots eyeballed. **All checks ran in isolated git worktrees** — Eric's `npm run dev` on :3000 holds Next 16's per-dir lock, so the main-dir e2e/build can't run without disrupting his server.
- **Mid-task the DB (:5432) dropped** (blocked the e2e + Eric's :3000); resumed once he brought it back.

**Code review:** `@code-review` — **no blockers**. Folded both findings: (1) the optimistic Send flip rendered the full Resend bar in the **half-width** grid cell → cramped/overflowed at 375px; added a `compact` RelaySend mode (clean "Sent ✓"; Resend returns on reload). (2) clipboard textarea `removeChild` → `finally`. ⚠️ The `execCommand` fallback (the actual bug) is CI-untestable (localhost is secure) — eyeball over `http://mill-dev`.
**PR:** [#178](https://github.com/mobiustripper42/muster/pull/178) (closes #177)
**Points:** 3
**Branch:** task/outbox-card-fixes (base: main)
**Opened at:** 2026-06-28T03:33:06Z

**Next Steps:**
- **`db:seed:messages` — NOT YET BUILT (Eric wants it, approved-in-principle).** A new `db/seed-messages-dev.ts` that **respects `PILOT_GUIDES`** (reuse seed-pilot-crew's active-token logic) + `TENANT_ID` + `OPERATOR_CREW_MEMBER_ID`; seeds an **All-staff broadcast from the office + a crew reply + a DM between two active pilot crew**, idempotent, runs after `seed:crew:pilot`. So shifts AND messages share one pilot set. Build on a branch with the messaging UI (off the stack), or standalone on feature/messaging (needs only the 6.1 message store). Was waiting on Eric's go when we closed.
- **Messaging-test gotchas (hit live this session):** the doorbell tick is the `/api/cron/doorbell-tick` GET, **CRON_SECRET-gated** (set it in `.env.local` AND restart dev; curl with the LITERAL value, not `$CRON_SECRET` — the shell doesn't load .env.local). It also **shares the engine pause gate** (`{paused:true}` = no rings → unpause at `/admin`). Deep-links use **`APP_BASE_URL`** — must be reachable from the tester's phone (Tailscale/mill-dev isn't, so real-people tests need a public deploy). `muster_dev` was missing `0010` (message_reads) → "Can't reach messages" until `db:migrate`.
- **`PILOT_GUIDES` is the pilot-users env var** (comma-sep name/id tokens → crew `status: active/inactive`). The engine asks only active crew for shifts; the **doorbell already rings only active crew** (the `activeIds` filter), so messaging respects it where it counts. (all_staff `deriveMembers` returns the full roster, but the tick filters active at ring time.)
- **Native app is Eric's stated endgame for messaging** — and the architecture supports it: the doorbell **decider is transport-independent** (pure fn), delivery is a `NotificationPort` adapter. Arc: web relay (now) → Twilio SMS (6.9, removes manual relay) → native push + WebSocket (removes relay + unlocks full `present_here` suppression per DEC-047/068 + live chat), decider constant throughout. Native parked by DEC-MSG-2, not killed. **Offered to record as a DEC/FUTURE_IDEAS — Eric didn't answer before close; do it next session.**
- **6.9 (#119, Twilio/second number, 10DLC-gated)** closes the phase — the real SMS doorbell number replaces the operator-relay (the manual relay + the DEC-072 exclusion + the deep-link all stay).
- **The whole messaging stack (#171→#172→#175) is in review.** Eric **validated #171 + #172** this session (tested live); **#175 mid-test** at close. Merge order: #171 → #172 → #175 into feature/messaging, then feature/messaging → main.
- **#174 (admin nav shell + #178 outbox fixes) MERGED to main + PROMOTED to production** this session (production at ff6c149, untagged — `/retro` to patch-bump #176/#178 + tag). Working dir was left on a messaging branch after testing (started the promote on `production`).
- **⚠️ Merge reconciliation:** #175's `relay-send.tsx`/`outbox-card.tsx` are off `feature/messaging` (pre-#160); **`main` already has the #160 Web Share versions** of both. The `feature/messaging`→`main` merge must reconcile the `onRecord` generalization (rings) with main's Web Share send path — not a textual auto-merge.
- **Crew-side DM-visibility disclosure** (flagged in DEC-072) — a one-line "your DMs are visible to the office" on the crew DM surface; a real §6 trust gap, raise with the operator first. Thin fast-follow.
- The **live popping toast** (vs the v1 refresh-time badge) waits on the realtime socket (DEC-047) — deferred with instant chat (DEC-045).
- Fold the doorbell + messaging env knobs into `docs/DEPLOY.md` when `feature/messaging` reconciles with main's #157 env-docs (still deferred). ⚠️ Confirm `OPERATOR_CREW_MEMBER_ID=crew-eric-stoffer` in prod env (DEC-072 ring-exclusion targets it; defaults to `crew-spink`).

**Context:**
- Phase 6 lives on `feature/messaging` (DEC-059), behind main on pilot-hardening + DEC numbers (max here is now **DEC-072** vs main's DEC-067; DEC-068+ numbered past 067 so the eventual merge carries no dup). PRs #171/#172 target `feature/messaging`/`task/117` (stacked), NOT main — `closes #117/#118` won't fire until feature/messaging merges to main (same as #111–#116/#167, all still open).
- **6.7 (#171) + 6.8 (#172) are stacked**: #172's base is task/117. When #171 merges to feature/messaging, retarget/rebase #172 (GitHub offers the base change).
- **Crew-compose policy (DEC-071):** crew may post in any thread they're a member of, incl. all-staff. If that proves noisy at pilot, an operator thread-lock is the 6.8 refinement.
- `myThreads` (date-filtered) = the **list display**; `threadMembership` (date-agnostic, deriveMembers) = the **view/post authorization**. Don't re-merge them — the split is the rung-but-can't-read fix.
