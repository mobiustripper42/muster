"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { splitShift } from "@core/builder/split.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
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
    await splitShift(getRepo(), asId<"ShiftId">(shiftId), cut);
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
