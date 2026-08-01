/**
 * The crew's own edit doors (#635, SPEC §2.9.8) — change, add and delete YOUR punches.
 *
 * The honor system (§2.9.3) says a crew member's hours are their own assertion; this is
 * where they correct one. It is deliberately NOT an approval workflow — an edit lands
 * immediately and is visible. What makes that survivable is the record, not a gate.
 *
 * **Two rules carry this module.**
 *
 * 1. **Ownership, answered as absence.** A punch that isn't yours comes back `gone` —
 *    the same answer a nonexistent id gets. Not `not_yours`, which would confirm the
 *    punch exists and turn a forged id into an oracle for whose punches are whose. The
 *    `ownsTimeOff` posture (10.3 audit), stated as a code rather than a comment.
 *
 * 2. **Every change appends a trail row** — who, when, from→to, and why. A reason is
 *    per-edit, so a single `edit_reason` column would keep only the most recent one:
 *    wrong the first time a paycheck is disputed over the *second* edit. Required and
 *    non-blank on all three doors.
 *
 * **`adminEditedAt` is deliberately untouched.** That flag exists so a crew member can
 * see that *someone else* moved their hours. Their own edit is not that, and setting it
 * would make the surface lie to them about who did it.
 *
 * Validation is 13.1/13.3's, reached through {@link editPunch} and {@link addPunch} —
 * `out_before_in`, `day_moved`, the one-open-punch index. This module adds ownership and
 * the reason; it re-implements nothing.
 */

import type { TimePunch, TimePunchEdit } from "../domain/entities.js";
import type { CrewMemberId, TimePunchEditId, TimePunchId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { addPunch, editPunch, type EditPunchCode } from "./time-clock.js";

/** Expected, surfaced-to-the-crew-member failures. `gone` covers "not yours" too. */
export type CrewEditCode = EditPunchCode | "reason_required";

export type CrewEditResult =
  | { ok: true; punch: TimePunch }
  | { ok: false; code: CrewEditCode };

export type CrewDeleteResult = { ok: true } | { ok: false; code: "gone" | "reason_required" };

/** Non-blank. Whitespace is not a reason. */
function reasonGiven(reason: string): boolean {
  return reason.trim().length > 0;
}

/**
 * Their punch, or null — where "someone else's" and "doesn't exist" deliberately
 * collapse into the same answer.
 */
async function ownPunch(
  repo: Repository,
  punchId: TimePunchId,
  crewMemberId: CrewMemberId,
): Promise<TimePunch | null> {
  const punch = await repo.getTimePunch(punchId);
  if (!punch || punch.crewMemberId !== crewMemberId) return null;
  return punch;
}

function trailRow(input: {
  editId: TimePunchEditId;
  punchId: TimePunchId;
  actorId: CrewMemberId;
  now: Date;
  action: TimePunchEdit["action"];
  before: TimePunch | null;
  after: TimePunch | null;
  reason: string;
}): TimePunchEdit {
  return {
    id: input.editId,
    timePunchId: input.punchId,
    actorKind: "crew",
    actorId: input.actorId,
    at: input.now.toISOString(),
    action: input.action,
    fromInAt: input.before?.inAt ?? null,
    fromOutAt: input.before?.outAt ?? null,
    toInAt: input.after?.inAt ?? null,
    toOutAt: input.after?.outAt ?? null,
    reason: input.reason.trim(),
  };
}

/**
 * Change one of your own punches' times. The trail row is written only after the punch
 * write succeeds — a refused edit leaves no history, because nothing happened.
 */
export async function editOwnPunch(
  repo: Repository,
  input: {
    editId: TimePunchEditId;
    punchId: TimePunchId;
    crewMemberId: CrewMemberId;
    inAt?: Date;
    outAt?: Date | null;
    reason: string;
    now: Date;
  },
): Promise<CrewEditResult> {
  const before = await ownPunch(repo, input.punchId, input.crewMemberId);
  if (!before) return { ok: false, code: "gone" };
  if (!reasonGiven(input.reason)) return { ok: false, code: "reason_required" };

  const result = await editPunch(repo, input.punchId, {
    ...(input.inAt !== undefined ? { inAt: input.inAt } : {}),
    ...(input.outAt !== undefined ? { outAt: input.outAt } : {}),
    now: input.now,
  });
  if (!result.ok) return result;

  // `editPunch` stamps `adminEditedAt` — correct for the office, wrong here. Put it
  // back to what it was, so the flag keeps meaning "someone ELSE moved your hours".
  const mine: TimePunch = { ...result.punch, adminEditedAt: before.adminEditedAt };
  await repo.saveTimePunch(mine);

  await repo.appendTimePunchEdit(
    trailRow({
      editId: input.editId,
      punchId: input.punchId,
      actorId: input.crewMemberId,
      now: input.now,
      action: "changed",
      before,
      after: mine,
      reason: input.reason,
    }),
  );
  return { ok: true, punch: mine };
}

/**
 * Enter a punch you never clocked — the honest version of "I worked and forgot".
 * `origin: "crew"`, because THEY entered it: distinct from `origin: "admin"`, which is
 * the office entering hours on their behalf (§2.9.8).
 */
export async function addOwnPunch(
  repo: Repository,
  input: {
    id: TimePunchId;
    editId: TimePunchEditId;
    crewMemberId: CrewMemberId;
    inAt: Date;
    outAt: Date | null;
    reason: string;
    now: Date;
  },
): Promise<CrewEditResult> {
  if (!reasonGiven(input.reason)) return { ok: false, code: "reason_required" };

  const result = await addPunch(repo, {
    id: input.id,
    crewMemberId: input.crewMemberId,
    inAt: input.inAt,
    outAt: input.outAt,
  });
  if (!result.ok) return result;

  // `addPunch` is the office's door and stamps `origin: "admin"`. This one is theirs.
  const mine: TimePunch = { ...result.punch, origin: "crew" };
  await repo.saveTimePunch(mine);

  await repo.appendTimePunchEdit(
    trailRow({
      editId: input.editId,
      punchId: input.id,
      actorId: input.crewMemberId,
      now: input.now,
      action: "created",
      before: null,
      after: mine,
      reason: input.reason,
    }),
  );
  return { ok: true, punch: mine };
}

/**
 * Delete one of your own punches. **The trail row outlives the punch** — after this the
 * `deleted` row is the only remaining evidence those hours ever existed, which is why
 * `time_punch_edits` carries no foreign key to `time_punches`.
 */
export async function deleteOwnPunch(
  repo: Repository,
  input: {
    editId: TimePunchEditId;
    punchId: TimePunchId;
    crewMemberId: CrewMemberId;
    reason: string;
    now: Date;
  },
): Promise<CrewDeleteResult> {
  const before = await ownPunch(repo, input.punchId, input.crewMemberId);
  if (!before) return { ok: false, code: "gone" };
  if (!reasonGiven(input.reason)) return { ok: false, code: "reason_required" };

  // Trail first: if the delete fails the row is a harmless record of an attempt, but if
  // the delete succeeded and the append failed we'd have erased hours with no account
  // of who did it. Between the two orders, only one loses the thing that matters.
  await repo.appendTimePunchEdit(
    trailRow({
      editId: input.editId,
      punchId: input.punchId,
      actorId: input.crewMemberId,
      now: input.now,
      action: "deleted",
      before,
      after: null,
      reason: input.reason,
    }),
  );
  await repo.removeTimePunch(input.punchId);
  return { ok: true };
}
