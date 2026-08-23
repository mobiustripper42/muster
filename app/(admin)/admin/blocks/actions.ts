"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  removeBlockAdmin,
  saveBlockAdmin,
  type BlockRemoveError,
  type BlockSaveError,
} from "@core/admin/block-admin.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a silent
 * fall through to "try again in a moment".
 */
export type BlockErr = BlockSaveError | BlockRemoveError | "error";

/**
 * Create a block (task 12.10). Auth + FormData glue over `saveBlockAdmin`, which owns
 * validation. Only the two SCOPED kinds are creatable here (`location` / `vessel`); a
 * `vesselHold` is made on the calendar (#464). Blank `id` = create → mint a fresh id.
 * `redirect()` throws, so it lives outside the try (house convention).
 */
export async function saveBlock(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId || `block-${randomUUID()}`;
  const kind = String(formData.get("kind") ?? "");
  const note = String(formData.get("note") ?? "");

  let code: BlockErr | null = null;
  try {
    const result = await saveBlockAdmin(getRepo(), {
      id,
      kind,
      locationId: String(formData.get("locationId") ?? ""),
      date: String(formData.get("date") ?? ""),
      startTime: String(formData.get("startTime") ?? ""),
      endTime: String(formData.get("endTime") ?? ""),
      vesselId: String(formData.get("vesselId") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      ...(note.trim() ? { note } : {}),
    });
    code = result.ok ? null : result.code;
  } catch (e) {
    // Never swallow the real cause — a common one is the catalog migration not being applied.
    console.error("saveBlock: saveBlockAdmin threw", e);
    code = "error";
  }

  revalidatePath("/admin/blocks");
  if (!code) {
    await clearFormDraft("/admin/blocks");
    // On success, select the saved block so it loads back into the edit panel; no success banner.
    redirect(`/admin/blocks?sel=${id}`);
  }

  // A refusal keeps both halves of what the operator had (#780): the typing, via the draft, and
  // the SELECTION, via `sel`.
  //
  // The selection is the half that bites. Redirecting to a bare `?err=` turned the edit panel
  // back into a create form, which empties the hidden `id` — so correcting the time and saving
  // again filed a SECOND block instead of fixing the first, silently, on a surface whose whole
  // job is subtracting availability.
  //
  // `rawId`, never `id`: on a create, `id` is a freshly minted uuid for a row that was never
  // written, and echoing it back as `sel` is #699's first defect exactly (a selection pointing
  // at nothing). Blank `rawId` means "still creating", which is what no `sel` already says.
  await stashFormDraft("/admin/blocks", formData);
  const params = new URLSearchParams({ err: code });
  if (rawId) params.set("sel", rawId);
  redirect(`/admin/blocks?${params.toString()}`);
}

/**
 * Lift a block (task 12.10) — a real delete; the subtracted slots come back (DEC-125,
 * reversible-in-spirit). The registry gates this behind a two-step `?lift=<id>` confirm (no-JS),
 * so this action just does the delete.
 */
export async function liftBlock(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const id = String(formData.get("id") ?? "").trim();
  let code: BlockErr | null = null;
  try {
    const result = await removeBlockAdmin(getRepo(), id);
    code = result.ok ? null : result.code;
  } catch (e) {
    console.error("liftBlock: removeBlockAdmin threw", e);
    code = "error";
  }

  revalidatePath("/admin/blocks");
  // Nothing typed to lose on a lift — but a draft from an earlier refused save would otherwise
  // sit here for the rest of its minute and repopulate the panel on the next `?err=`.
  await clearFormDraft("/admin/blocks");
  // Deselect after a lift (the block is gone); no success banner.
  redirect(code ? `/admin/blocks?err=${code}` : `/admin/blocks`);
}
