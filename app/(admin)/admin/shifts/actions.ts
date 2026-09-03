"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { splitShift } from "@core/builder/split.js";
import { mergeShift } from "@core/builder/merge.js";
import { asId } from "@core/domain/ids.js";
import { logCrewRemoved, logFormAudit } from "@core/oracle/audit-log.js";
import { readSubject } from "../../../lib/auth";
import { forwardFormNotices, forwardNoticesToOutbox } from "../../../lib/channel";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * Builder Edit-mode split (SPEC §2.3, DEC-083) — auth + glue over `splitShift`;
 * the partition rules and the trust-boundary cut validation live in `@core`.
 *
 * Feedback rides the redirect as a CODE only, never prose (DEC-026 — the page
 * maps `split_ok` / `split_err` to copy, so a crafted URL can't inject text into
 * Eric's UI). `redirect()` throws by design and stays OUTSIDE the try; only the
 * domain call is guarded, so a race (trips changed, already split, day cancelled)
 * becomes an honest notice rather than a 500. `back` carries the caller's Edit-mode
 * query (window + mode) so the operator lands where they were, now two rows deep.
 */
export async function splitAction(formData: FormData): Promise<void> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  const cut = String(formData.get("cut") ?? "");
  const back = String(formData.get("back") ?? "mode=edit");
  if (!subject || subject.kind !== "admin" || !shiftId) redirect("/admin/shifts");

  let param: string;
  // One clock for the whole action, passed INTO the engine (C2.3-8): the re-form
  // births side B, and birth is horizon-aware only when given a `now` (DEC-022).
  // Omit it and a side B spawned inside the staffing horizon persists `Pending`
  // instead of `Filling` — masked on screen by `resolveShiftStateOnRead` and
  // corrected by the next tick, but wrong on the row in the meantime.
  const now = new Date();
  try {
    const form = await splitShift(getRepo(), asId<"ShiftId">(shiftId), cut, now);
    // A split's one-shot re-form CONSUMES any external Cancelled↔live transition
    // it's first to observe (the new state is written, so no later Xola pull
    // re-sees it) — relay it here or that crew member is never texted (#259).
    // Best-effort, like the merge relay: the split already committed.
    try {
      await forwardFormNotices(form);
    } catch (e) {
      // relay is best-effort; the split stands regardless (DEC-084)
      // The comment above says it: a split CONSUMES the transition, so nothing
      // re-observes it later. This relay is the crew member's only notice, and if
      // it fails here they are never texted at all (#259).
      logSwallowed("admin/shifts:splitAction", e, "the form-transition notice was consumed and never relayed");
    }
    // Audit (DEC-118): a split re-partitions a day's trips, so its surviving crew's
    // committed day may move (`changedCrew` → `shift_changed`), actor `admin`. Same
    // best-effort, post-commit posture as the relay and the import audit.
    try {
      await logFormAudit(getRepo(), form, { kind: "admin", id: subject!.id }, now);
    } catch (e) {
      // audit is best-effort; the split stands regardless
      logSwallowed("admin/shifts:splitAction", e, "the split's shift_changed audit row was not written");
    }
    param = "split_ok=1";
  } catch (e) {
    // Every failure (bad/duplicate cut, already-split, day vanished mid-edit)
    // collapses to one honest, reload-and-retry notice — the operator only ever
    // picks a valid trip-time cut, so a reachable failure is always a race.
    // "Always a race" is a claim about the EXPECTED failures. This log is what
    // tells you when it was something else.
    logSwallowed("admin/shifts:splitAction", e, "the split did not complete");
    param = "split_err=failed";
  }
  revalidatePath("/admin/shifts");
  redirect(`/admin/shifts?${back}&${param}`);
}

/**
 * Builder Edit-mode merge (SPEC §2.3, DEC-083 inverse + DEC-084) — auth + glue over
 * `mergeShift`. The engine tears down the `…-b` side, clears the cut, re-forms to one
 * shift, and returns the dropped side-B crew (`freedCrew`); the edge relays each an
 * `action:"removed"` assignment notice so nobody is silently un-booked (DEC-084). The
 * operator-as-crew is excluded here (DEC-072/084) — the operator id is an edge value.
 *
 * Same DEC-026 posture as split: feedback rides the redirect as a CODE, `redirect()`
 * stays OUTSIDE the try, only the domain + relay are guarded (a race → an honest
 * notice, not a 500). The notice relay is best-effort by design (`forwardNotices`
 * swallows) — the merge already committed, so a channel hiccup can't fail it.
 */
export async function mergeAction(formData: FormData): Promise<void> {
  const subject = await readSubject();
  const shiftId = String(formData.get("shiftId") ?? "");
  const back = String(formData.get("back") ?? "mode=edit");
  if (!subject || subject.kind !== "admin" || !shiftId) redirect("/admin/shifts");

  let param: string;
  // Hoisted above the try and passed into the engine (C2.3-8) — same reasoning as
  // split: the merge's re-form re-births the surviving shift, and birth is
  // horizon-aware only with a clock (DEC-022). Also the audit's timestamp below,
  // so the state resolution and the audit row share one instant.
  const now = new Date();
  try {
    const { form, freedCrew } = await mergeShift(getRepo(), asId<"ShiftId">(shiftId), now);
    // Notify everyone dropped off the far side — except the operator about their own
    // action (DEC-072/084).
    const toNotify = freedCrew.filter(
      (id) => String(id) !== OPERATOR_CREW_MEMBER_ID,
    );
    // The merge is COMMITTED — the relay is best-effort and must never flip this to
    // merge_err (a channel-setup hiccup would otherwise report a false failure for a
    // merge that happened, and a retry then throws `not split`). Its own guard here
    // covers the channel construction too, not just forwardNotices' per-change swallow.
    try {
      await forwardNoticesToOutbox(
        toNotify.map((crewMemberId) => ({
          crewMemberId,
          action: "removed" as const,
          shiftId: asId<"ShiftId">(shiftId),
        })),
      );
    } catch (e) {
      // Relay is best-effort; the merge stands regardless (DEC-084).
      logSwallowed("admin/shifts:mergeAction", e, "the freed crew were not told they came off the shift");
    }
    // INDEPENDENT relay (its own guard): any external Cancelled↔live transition
    // the merge's one-shot re-form observed (#259) — same consume-once reasoning
    // as split. Kept separate from the freedCrew relay so one relay's failure
    // can't suppress the other. A duplicate "removed" to a just-freed member is
    // fine (Twilio: an extra text beats a missed one; the outbox dedupes by slot).
    try {
      await forwardFormNotices(form);
    } catch (e) {
      // best-effort; the merge stands regardless (DEC-084)
      logSwallowed("admin/shifts:mergeAction", e, "the form-transition notice was consumed and never relayed");
    }
    // Audit (DEC-118), mirroring the two relays above so no removal is unlogged:
    //  - `form` covers side A's "shift changed" (changedCrew → shift_changed);
    //  - `freedCrew` are the dropped side-B crew — they live in freedCrew, NOT
    //    form.cancelledCrew (side A survives the re-form), so they'd be missed by
    //    the form audit alone. Log each a `crew_removed`, actor `admin`. Unlike the
    //    notice, the operator is NOT excluded (audit records who-did-what-to-whom).
    const actor = { kind: "admin" as const, id: subject!.id };
    try {
      await logFormAudit(getRepo(), form, actor, now);
      for (const crewMemberId of freedCrew) {
        await logCrewRemoved(getRepo(), crewMemberId, actor, now, {
          shiftId: asId<"ShiftId">(shiftId),
        });
      }
    } catch (e) {
      // audit is best-effort; the merge stands regardless
      // The loop is not atomic: a throw partway leaves some freed crew logged as
      // removed and the rest not, so the trail is partially wrong rather than
      // wholly absent.
      logSwallowed("admin/shifts:mergeAction", e, "some or all of the merge's removal audit rows were not written");
    }
    // Surface the count so the page can confirm who got told (button feedback, #202).
    param = `merge_ok=${toNotify.length}`;
  } catch (e) {
    // A race (already merged, day vanished, non-split target) → one honest notice.
    logSwallowed("admin/shifts:mergeAction", e, "the merge did not complete");
    param = "merge_err=failed";
  }
  revalidatePath("/admin/shifts");
  redirect(`/admin/shifts?${back}&${param}`);
}
