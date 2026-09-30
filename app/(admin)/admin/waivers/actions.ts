"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  editWaiverVersion,
  postWaiverVersion,
  saveCheckInSettings,
  type CheckInSettingsError,
  type WaiverEditError,
} from "@core/checkin/waiver-admin.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

const SURFACE = "/admin/waivers";

/**
 * Every code the version form can put in `?err=` (#654) — the domain's refusals plus the glue
 * code minted here. The page's copy table is keyed to this, so a code with nothing to say about it
 * is a build error.
 */
export type WaiverErr = WaiverEditError | "error";
/** The settings form's codes. Disjoint from {@link WaiverErr}, so one `?err=` serves both forms
 *  and the page shows each beside the form it belongs to. */
export type SettingsErr = CheckInSettingsError | "settings_error";

/**
 * Post a new waiver version, or — with an `id` — edit one that has not taken effect yet
 * (Phase 18.2). Auth and glue over `@core/checkin/waiver-admin`, which owns every rule.
 * `redirect()` throws, so it lives outside the try (house convention).
 */
export async function saveWaiverVersion(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const editId = String(formData.get("id") ?? "").trim();
  const input = {
    version: String(formData.get("version") ?? ""),
    body: String(formData.get("body") ?? ""),
    effectiveDate: String(formData.get("effectiveDate") ?? ""),
  };
  const ctx = { now: new Date().toISOString(), by: String(subject.id) };

  let code: WaiverErr | null = null;
  try {
    const result = editId
      ? await editWaiverVersion(getRepo(), editId, input, ctx)
      : await postWaiverVersion(getRepo(), input, { ...ctx, id: `waiver-${randomUUID()}` });
    code = result.ok ? null : result.code;
  } catch (e) {
    logSwallowed("admin/waivers:saveWaiverVersion", e, "the waiver version was not saved");
    code = "error";
  }

  revalidatePath(SURFACE);
  if (code) {
    // A version that has locked or gone has nothing left to edit: back to the page, not the form.
    if (code === "locked" || code === "not_found") {
      await clearFormDraft(SURFACE);
      redirect(`${SURFACE}?err=${code}`);
    }
    await stashFormDraft(SURFACE, formData);
    redirect(`${SURFACE}?${editId ? `edit=${encodeURIComponent(editId)}&` : ""}err=${code}`);
  }
  await clearFormDraft(SURFACE);
  redirect(`${SURFACE}?saved=${editId ? "edited" : "posted"}`);
}

/** Save the age of majority and the reminder days. */
export async function saveSettings(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const rawAge = String(formData.get("ageOfMajority") ?? "").trim();
  let code: SettingsErr | null = null;
  try {
    const result = await saveCheckInSettings(
      getRepo(),
      {
        // Blank is not zero: `Number("")` is 0, which would read as a typed zero.
        ageOfMajority: rawAge === "" ? Number.NaN : Number(rawAge),
        reminderDays: String(formData.get("reminderDays") ?? ""),
      },
      new Date().toISOString(),
    );
    code = result.ok ? null : result.code;
  } catch (e) {
    logSwallowed("admin/waivers:saveSettings", e, "the check-in settings were not saved");
    code = "settings_error";
  }

  revalidatePath(SURFACE);
  if (code) {
    await stashFormDraft(SURFACE, formData);
    redirect(`${SURFACE}?err=${code}`);
  }
  await clearFormDraft(SURFACE);
  redirect(`${SURFACE}?saved=settings`);
}
