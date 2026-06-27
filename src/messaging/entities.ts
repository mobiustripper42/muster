/**
 * Messaging entities (#111, DEC-051 / DEC-045).
 *
 * The store behind full-mesh in-app group chat. Four thread kinds, one primitive
 * (a thread + a participant set):
 *   - **cohort**     — everyone crewing a given DAY, across every shift that day
 *   - **shift**      — the crew of one shift (its seats)
 *   - **all_staff**  — the whole roster
 *   - **dm**         — any two people, ad-hoc
 *
 * Membership is **derived at read** for the three standing kinds (`membership.ts`
 * over shifts/seats/roster) and **persisted only for DMs** (DEC-051) — a
 * snapshotted cohort/shift goes stale the instant the schedule moves, the same
 * Xola-trap calendar DEC-009 forbids. So the only membership rows are
 * `Participant`s, minted for DM threads alone.
 *
 * Framework-free core (DEC-020): pure shapes + deterministic id helpers; no I/O,
 * no clock. The edge stamps `createdAt` and persists through the Repository port.
 */

import type {
  CrewMemberId,
  MessageId,
  ParticipantId,
  TenantId,
  ThreadId,
} from "../domain/ids.js";
import { asId } from "../domain/ids.js";
import type { AuthSubjectKind } from "../domain/entities.js";

/**
 * The kind of thread. **Data, not a hardcoded enum branch** (DEC-051 — the
 * DEC-ROLE-1 discipline applied to threads): membership dispatch in `membership.ts`
 * is a registry keyed by this value, never a smeared if/switch. The union buys
 * compile-time exhaustiveness; it does not license branch-per-kind logic.
 */
export type ThreadKind = "cohort" | "shift" | "all_staff" | "dm";

export interface Thread {
  id: ThreadId;
  tenantId: TenantId;
  kind: ThreadKind;
  /**
   * The natural key membership derives from:
   *   - cohort    → the ISO-8601 date (the day)
   *   - shift     → the `ShiftId`
   *   - all_staff → null (the whole roster)
   *   - dm        → null (membership is the persisted `Participant` rows)
   */
  scopeRef: string | null;
  /** ISO-8601 UTC — when the thread was first materialized. */
  createdAt: string;
}

/** A message's sender kind = the canonical subject kind (DEC-058). `"admin"` is
 *  the operator/office, posting as `OPERATOR_CREW_MEMBER_ID` (DEC-030 §7) — there
 *  is no separate `"operator"` vocabulary. */
export type MessageSenderKind = AuthSubjectKind;

export interface Message {
  id: MessageId;
  threadId: ThreadId;
  /** Subject ref — a `CrewMemberId` (crew) or the operator/office id (`"admin"`,
   *  `OPERATOR_CREW_MEMBER_ID` in v1 — DEC-030 §7). Stored as a plain string
   *  because senders span identity spaces (DEC-052: operators post too, and DMs
   *  are operator-visible). `senderKind` (the canonical subject kind, DEC-058)
   *  tags which. */
  senderId: string;
  senderKind: MessageSenderKind;
  body: string;
  /** ISO-8601 UTC; the chronological order key (`listMessagesForThread`). */
  createdAt: string;
  /** §7.4 — operator-flagged / type-derived priority. The doorbell decider's
   *  `PendingMessage.priority` (DEC-068) flows from this; a priority message
   *  bypasses the batch window + first-only-until-read. Persisted in 6.6a; the
   *  operator flag that SETS it is later (6.7/6.8). */
  priority: boolean;
}

/**
 * A persisted thread member. Written for **DM threads only** (DEC-051); the
 * standing kinds compute membership at read and persist no rows here.
 */
export interface Participant {
  id: ParticipantId;
  threadId: ThreadId;
  crewMemberId: CrewMemberId;
}

/**
 * Deterministic id for a standing/derived thread → an idempotent find-or-create:
 * `getThread(standingThreadId(...)) ?? saveThread(...)`. Each (kind, scope) has
 * exactly one thread, so the id *is* the scope — no minting, no duplicate-day
 * threads. Uniform interpolation (no per-kind branch — formatting is not policy);
 * `scope` is the day (cohort), the shift id (shift), or null (all_staff → "all").
 */
export function standingThreadId(
  kind: Exclude<ThreadKind, "dm">,
  tenantId: TenantId,
  scope: string | null,
): ThreadId {
  return asId<"ThreadId">(`thread-${kind}-${tenantId}-${scope ?? "all"}`);
}

/**
 * Deterministic DM thread id from the **unordered** crew pair → tapping a crewmate
 * twice reuses the one thread (the §6 number-privacy property — open a DM without
 * sharing a number), never spawns a duplicate. Sorted so (a,b) and (b,a) collide.
 */
export function dmThreadId(
  tenantId: TenantId,
  a: CrewMemberId,
  b: CrewMemberId,
): ThreadId {
  const [lo, hi] = [String(a), String(b)].sort();
  return asId<"ThreadId">(`thread-dm-${tenantId}-${lo}-${hi}`);
}
