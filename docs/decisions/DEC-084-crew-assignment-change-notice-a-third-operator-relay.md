---
id: DEC-084
title: "Crew assignment-change notice — a third operator-relay sibling"
topic: "Outbound notifications & operator relay"
---

## DEC-084: Crew assignment-change notice — a third operator-relay sibling

**Status:** Decided 2026-07-02 (@architect, Phase 8.4, #207). Operator principle (Eric): when a crew member is put ON or taken OFF a shift, they **always get a message** — SMS in production, and in the pilot (no SMS yet) still a generated notice the operator relays. "No matter how it gets to them during what phase."

**Decision.** A crew "you're on / you're off" notice is a **third outbound primitive**, sibling to the ask outbox (DEC-030/050) and the ring outbox (DEC-073) — its own port + entity + table + adapter, never overloaded onto either. The codebase already made this exact call twice; a no-claim, non-thread outbound gets its own lane so neither hardened subsystem reopens.

- **New `NoticePort`** (`src/ports/notice.ts`): `send(AssignmentNotice)`. `AssignmentNotice = { to: Recipient; action: "added" | "removed"; shiftId }` — **no** `askId`/`seatId` (no ask, no claim) and **no** `threadId`. Reuses `Recipient`/`SendResult` from `channel.ts`.
- **New entity `NoticeOutboxEntry`** + table `notice_outbox` (migration 0015): `{ id; crewMemberId; action; body; link; status; createdAt; sentAt? }`. Mirrors `RingOutboxEntry`/`ring_outbox` **minus** `threadId`, minus drop-on-read. **Terminal-on-sent** (unlike ask = settle-on-answer, ring = drop-on-read): it doesn't auto-clear, leaving a standing "we told them" record — the durable audit, no separate table.
- **`OutboxNoticeChannel implements NoticePort`** mints a `/crew` (my-shifts) magic link + enqueues the entry (body + link, **no** accept/decline). `FakeNoticeChannel` recorder for tests. Renders as a **third `/admin/outbox` section** ("Assignment changes"), reusing the generic relay-send island + no-phone notice.

**Why not the existing lanes.** Overloading the ask `ChannelPort` breaks its NOT-NULL `askId`/`seatId` correlation invariant (DEC-073 already refused this). Riding `NotificationPort` forces a nullable `threadId` and breaks its drop-on-read terminal rule — a release notice has no thread and no read-state to drop on. A third port keeps both hardened subsystems closed; the eventual Twilio class simply implements all three interfaces (DEC-050 convergence note; DEC-MSG-1 swap, zero domain change).

**Emission locus.** Core returns the intent, the edge delivers — exactly the ask pattern (`fireAsk` → return → `forwardToOutbox`). `mergeShift` (8.4) returns the dropped side-B crew as facts; a new edge `forwardNotices(repo, noticeChannel, notices)` (mirror of `forward-asks.ts`) does the lookups, formats the body, mints the link, enqueues. Core stays clock-free + text-free (DEC-030 ruling holds).

**Idempotency.** `formShifts` is idempotent-by-re-derivation and runs on every pull, so notices are emitted **only from the explicit merge command**, once — **never** from the `formShifts` re-derive path. Belt-and-suspenders: deterministic entry id `notice-{shiftId}-{crewMemberId}-{action}`, upsert.

**Operator-as-crew guard.** The operator holds seats (DEC-030 §7), so a merge could "drop" the operator from side B and notify them of their own action. Exclude `OPERATOR_CREW_MEMBER_ID` in `forwardNotices` (mirrors the ring path's DEC-072 exclusion).

**Scope seam.** 8.4 wires **merge-release only** (`action:"removed"` for freed side-B confirmed crew). Fast-follow (NOT now): the other add/drop sites — `formShifts` cancel path (import-cancellation), `vacateSeat`/`bail` (removed person), `overrideSeat` (`action:"added"`), and the Twilio adapter. Those run inside `formShifts`-on-pull, where the re-pull dedup actually bites — solved in their own task, not here. This closes a pre-existing gap: today NOTHING notifies a confirmed crew member when their seat/shift disappears.

**Not the messaging/threads rail (DEC-051).** That's derived-membership broadcast chat; a transactional assignment notice is neither, and the office is barred from originating a DM anyway.

**Relationship:** implements the SPEC §2.3 Merge action's crew-facing half; reuses DEC-030/050 (operator-relay outbox pattern), DEC-073 (own-lane-per-outbound precedent), DEC-MSG-1 (SMS swap seam), DEC-083 (merge mechanics), DEC-072 (operator ring-exclusion). Supersedes nothing.
