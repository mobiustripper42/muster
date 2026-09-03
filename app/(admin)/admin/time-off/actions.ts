"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { addTimeOff, removeTimeOff, type AddTimeOffCode } from "@core/crew/time-off.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a silent
 * fall through to "try again in a moment".
 */
export type AdminTimeOffErr = AddTimeOffCode | "no_crew" | "error";

/**
 * Operator-set time off (#332). The office puts a crew member out — e.g. someone
 * on active duty out for months (a far-future end date reads as "indefinite").
 * Add for anyone, remove anyone's — operator authority, no ownership gate (unlike
 * the crew self-serve path). Auth + glue over the same `addTimeOff` domain door;
 * validation (ISO date, start ≤ end) lives there. `redirect()` throws → OUTSIDE try.
 */
export async function adminAddTimeOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");
  const crewMemberId = String(formData.get("crewMemberId") ?? "");
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  if (!crewMemberId) {
    await stashFormDraft("/admin/time-off", formData);
    redirect("/admin/time-off?err=no_crew");
  }

  let code: AdminTimeOffErr | null = null;
  try {
    const result = await addTimeOff(getRepo(), {
      id: asId<"PtoWindowId">(`pto-${randomUUID()}`),
      crewMemberId: asId<"CrewMemberId">(crewMemberId),
      start,
      end,
    });
    code = result.ok ? null : result.code;
  } catch (e) {
    logSwallowed("admin/time-off:adminAddTimeOff", e, "the time-off window was not saved");
    code = "error";
  }

  revalidatePath("/admin/time-off");
  if (code) await stashFormDraft("/admin/time-off", formData);
  else await clearFormDraft("/admin/time-off");
  redirect(code ? `/admin/time-off?err=${code}` : "/admin/time-off?added=1");
}

export async function adminRemoveTimeOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");
  const id = String(formData.get("id") ?? "");

  try {
    if (id) await removeTimeOff(getRepo(), asId<"PtoWindowId">(id));
  } catch (e) {
    logSwallowed("admin/time-off:adminRemoveTimeOff", e, "the time-off window was not removed");
    revalidatePath("/admin/time-off");
    await clearFormDraft("/admin/time-off");
    redirect("/admin/time-off?err=error");
  }

  revalidatePath("/admin/time-off");
  await clearFormDraft("/admin/time-off");
  redirect("/admin/time-off?removed=1");
}
