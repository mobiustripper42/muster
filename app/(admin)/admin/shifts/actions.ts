"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { splitShift } from "@core/builder/split.js";
import { mergeShift } from "@core/builder/merge.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { forwardFormNotices, forwardNoticesToOutbox } from "../../../lib/channel";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { getRepo } from "../../../lib/repo";

/**
 * Builder Edit-mode split (SPEC §2.3, DEC-083) — auth + glue over `splitShift`;
 * the partition rules and the trust-boundary cut validation live in `@core`.
 *
 * Feedback rides the redirect as a CODE only, never prose (DEC-026 — the page
 * maps `split_ok` / `split_err` to copy, so a crafted URL can't inject text into
 * Spink's UI). `redirect()` throws by design and stays OUTSIDE the try; only the
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
  try {
    const form = await splitShift(getRepo(), asId<"ShiftId">(shiftId), cut);
    // A split's one-shot re-form CONSUMES any external Cancelled↔live transition
    // it's first to observe (the new state is written, so no later Xola pull
    // re-sees it) — relay it here or that crew member is never texted (#259).
    // Best-effort, like the merge relay: the split already committed.
    try {
      await forwardFormNotices(form);
    } catch {
      // relay is best-effort; the split stands regardless (DEC-084)
    }
    param = "split_ok=1";
  } catch {
    // Every failure (bad/duplicate cut, already-split, day vanished mid-edit)
    // collapses to one honest, reload-and-retry notice — the operator only ever
    // picks a valid trip-time cut, so a reachable failure is always a race.
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
  try {
    const { form, freedCrew } = await mergeShift(getRepo(), asId<"ShiftId">(shiftId));
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
    } catch {
      // Relay is best-effort; the merge stands regardless (DEC-084).
    }
    // INDEPENDENT relay (its own guard): any external Cancelled↔live transition
    // the merge's one-shot re-form observed (#259) — same consume-once reasoning
    // as split. Kept separate from the freedCrew relay so one relay's failure
    // can't suppress the other. A duplicate "removed" to a just-freed member is
    // fine (Twilio: an extra text beats a missed one; the outbox dedupes by slot).
    try {
      await forwardFormNotices(form);
    } catch {
      // best-effort; the merge stands regardless (DEC-084)
    }
    // Surface the count so the page can confirm who got told (button feedback, #202).
    param = `merge_ok=${toNotify.length}`;
  } catch {
    // A race (already merged, day vanished, non-split target) → one honest notice.
    param = "merge_err=failed";
  }
  revalidatePath("/admin/shifts");
  redirect(`/admin/shifts?${back}&${param}`);
}
