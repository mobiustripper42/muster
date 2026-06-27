---
session: 29
dev: eric
slug: 160-outbox-relay-ergonomics
branch: task/160-outbox-relay-ergonomics
started: 2026-06-26T22:22:03Z
ended: 2026-06-27T04:43:22Z
points: 23
pr_numbers: [165, 166, 168, 169]
status: closed
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

## Task 2: Human-drivable doorbell harness (6.5, #115)

**Completed:**
- `src/messaging/doorbell-harness.ts` — `DoorbellHarness`: a faithful mini edge+tick around the pure decider (#114) + a fake would-ring sink (sends nothing). World-building (crew, threads, per-`(crew,thread)` presence as the DEC-068 three-state verdict, posts, logical clock, reads), `decide()` (side-effect-free preview) vs `tick()` (fires + records notify-state and a would-ring log, DEC-049), a rendered board, and one `exec()` command surface the REPL/scenarios/tests share. Rules default from real DEC-060 config via `makeDoorbellRules`.
- `db/doorbell-dev.ts` — CLI glue (the `db/tick-dev.ts` analog): `npm run db:doorbell` (interactive REPL) + `-- saturday` (narrated artifact-§9 walkthrough). No DB, no real sends.
- `src/messaging/doorbell-harness.test.ts` — 9 tests; the Saturday walkthrough as the **executable observable spec** (suppress → toast → within-window hold → batched summary → cancel-on-read → first-only-until-read → priority content vs summary) + parser + `parseDuration`.
- `package.json` `db:doorbell` script. No DEC (consumes 6.4's), no migration, no UI.
- **Verified:** core+app typecheck ✓, build ✓, 64 messaging tests ✓; ran both the scenario and the REPL end-to-end (only the absent ever show would-SMS).

**Code review:** `@code-review` — clean, faithful edge+tick, real assertions, **no blockers**. The harness *is* the edge, so the board could mislead → documented (header + `help`) that presence is a **sticky manual verdict (no decay across `advance`)** — real v1 lapses `present_*`→`absent` after `presenceWindowMs` and SMS-rings — and that a same-tick read→post ties toward read. Fixed a foot-gun: `post … -p` was minting an empty-body ringing SMS (strip flag before the body guard; +1 test). Dropped unused `setNow`; clarified the declarative `#crew` roster.
**PR:** [#166](https://github.com/mobiustripper42/muster/pull/166)
**Points:** 5
**Branch:** task/115-doorbell-harness (base: feature/messaging — #165 merged mid-session, the stack collapsed)
**Opened at:** 2026-06-27T02:23:48Z

## Task 3: Doorbell storage + sendNotification port substrate (6.6a, #116)

**Completed:**
- **Re-estimated & split:** #116 (6.6) was a labelled 5 but really ~13. Split into **6.6a** (this — substrate) + **6.6b** (#167, the tick/cron/relay loop); operator-facing outbox relay of rings deferred to **6.8** (#118, commented). Board made honest via `gh issue edit/create`.
- **Architect-gated** (two calls): separate read/notify tables (domain-ownership, not contention); separate `NotificationPort` — which the architect found was **already decided by DEC-050** (sibling to the ask seam, rejecting the overload-the-ask-path route). Payload trimmed to ring-only.
- `db/migrations/0010_doorbell_state.sql` — `message_reads` + `doorbell_notifications` (two single-writer tables, DEC-069) + `messages.priority` (native boolean, the decider's `PendingMessage.priority` source).
- Repository port + Postgres + in-memory: `readStateForThread`/`notifyStateForThread` (thread-scoped, `subjectKey`-keyed, symmetric with `PresencePort.lastActiveFor`; absent → omitted → decider rings) + `recordRead`/`recordNotification` (upserts). `Message` gains `priority`, round-tripped both adapters.
- `src/ports/notification.ts` `NotificationPort` + `src/adapters/fake-notification-channel.ts` recorder (ask `ChannelPort`/outbox untouched). DEC-069 + DEC-050 amended.
- **Architect's key mitigation landed:** parity contract (read/notify + priority round-trip in `repository-contract.ts`, both adapters) + `store-decider-boundary.test.ts` (store maps → `decideNotifications` → first-only-until-read boundary) — because every 6.6a output is **unconsumed until 6.6b**, these pin the contract to the consumer now.
- **Verified:** typecheck core+app ✓, build ✓, in-memory contract 39 ✓, **Postgres contract 45 ✓ (byte-identical; 0010 applied to test DB by `migrate()`)**, fake channel 3 ✓, messaging 67 ✓. No cron/tick/live-flow change.

**Code review:** `@code-review` — house style + adapter parity + decider boundary all correctly pinned, **no blockers**. Folded two cleanups: corrected the stale `PendingMessage` docstring (the comment 6.6b reads to wire priority) + renamed the priority test to not over-claim a column-default assertion.
**PR:** [#168](https://github.com/mobiustripper42/muster/pull/168)
**Points:** 5
**Branch:** task/116-doorbell-substrate (base: feature/messaging)
**Opened at:** 2026-06-27T03:38:05Z

## Task 4: Doorbell tick + cron + relay — the loop (6.6b, #167)

**Completed:**
- `src/builder/doorbell-tick.ts` — the sweep (engine-tick analog): load shifts/seats/roster + `listThreadsWithMessages` once → per thread: `deriveMembers` (filtered to **active** crew) → assemble decider inputs (edge presence classification DEC-068: coarse → `present_elsewhere|absent`, never `present_here`; re-key store maps to `memberThreadKey`) → `decideNotifications` → `recordNotification` per ring (record-on-decide).
- **`listThreadsWithMessages`** (port + Postgres + in-memory + contract): the enumeration the 6.6a architect deferred — sweep **all** threads-with-messages, not a `createdAt` slice (a priority can be flipped on an old message). Resolved here because its shape needed the tick in hand.
- `src/adapters/forward-notifications.ts` — best-effort relay (mirrors `forward-asks.ts`): composes the body (content inlines the note, summary = "N new"), `NotificationPort.send`.
- `app/api/cron/doorbell-tick/route.ts` + `app/lib/doorbell.ts` + `vercel.json` `*/2`: a **separate** CRON_SECRET-guarded cron (DEC-040), pause-gated (DEC-054), fake/log delivery (operator outbox = 6.8, Twilio = 6.9). Crons run only on prod; Phase 6 isn't promoted until 6.8 — fake delivery never hits live traffic.
- **DEC-070** (the doorbell tick). No migration (uses 0010).
- **Verified:** typecheck core+app ✓, build ✓ (`/api/cron/doorbell-tick` registered), integration loop 6 ✓ (post→tick→ring→relay, first-only, presence-suppress, priority bypass, inactive-crew, empty-sweep), forward-notifications 5 ✓, in-memory contract 40 ✓, **Postgres parity 46 ✓**, builder+messaging 150 ✓ no regression.

**Code review:** `@code-review` — correct keying/presence, real round-trip tests, **no blockers**. Folded: (1) the sweep would ring **inactive crew** on all_staff → filtered to `status==="active"` (the engine's gate) +test; (2) `listParticipantsForThread` ran per-thread serially though only DM reads it → `kind==="dm"` only; (3) +throwing-channel test for the best-effort swallow. Record-on-decide-under-fake-delivery watch-item documented in DEC-070, accepted.
**PR:** [#169](https://github.com/mobiustripper42/muster/pull/169)
**Points:** 5
**Branch:** task/167-doorbell-tick (base: feature/messaging)
**Opened at:** 2026-06-27T04:29:33Z

**Next Steps:**
- **6.7 (#117)** — crew messaging UI (thread list, view + compose, in-app badge/toast, refresh-to-see-new). This is where `recordRead` gets its call-site (cancel-on-read) and the `in_app_toast` decisions become the actual in-app badge. ↑ the doorbell's read-state finally gets written by a real surface.
- **6.8 (#118)** — operator messaging surface **+** the deferred operator-outbox relay of doorbell rings (the real `NotificationPort` adapter replacing the fake/log). Must land before Phase 6 is promoted (record-on-decide under fake delivery would otherwise silently suppress — DEC-070).
- Then 6.9 (#119, Twilio/second number, 10DLC-gated) closes the phase.
- **Mid-session:** promoted `main`→`production` (#156→#164, the forgotten S28 pilot-hardening); untagged so prod `<VersionTag/>` reads v0.7.0 until a `/retro` patch-bump. Messaging stayed on `feature/messaging`, untouched.
- Fold the doorbell env knobs into `docs/DEPLOY.md` when `feature/messaging` reconciles with main's #157 env-docs (deferred to avoid a doc-merge tangle now).

**Context:**
- Phase 6 lives on `feature/messaging` (DEC-059), intentionally behind main (no S28 pilot-hardening) and behind on DEC numbers (max DEC-060 vs main's DEC-067) — DEC-068 numbered past 067 so the eventual merge carries no duplicate. `feature/messaging` already had 6.1 (msg store #134), 6.2 (presence #143), 6.3 (windows DEC-060 #144).
- The decider is built but **not wired** — delivery is 6.6, observability is 6.5. Read-state + a `messages.priority` source don't exist yet; the decider consumes them injected.
