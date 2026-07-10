"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { addTimeOff, removeTimeOff } from "@core/crew/time-off.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

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
  if (!crewMemberId) redirect("/admin/time-off?err=no_crew");

  let code: string | null = null;
  try {
    const result = await addTimeOff(getRepo(), {
      id: asId<"PtoWindowId">(`pto-${randomUUID()}`),
      crewMemberId: asId<"CrewMemberId">(crewMemberId),
      start,
      end,
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath("/admin/time-off");
  redirect(code ? `/admin/time-off?err=${code}` : "/admin/time-off?added=1");
}

export async function adminRemoveTimeOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");
  const id = String(formData.get("id") ?? "");

  try {
    if (id) await removeTimeOff(getRepo(), asId<"PtoWindowId">(id));
  } catch {
    revalidatePath("/admin/time-off");
    redirect("/admin/time-off?err=error");
  }

  revalidatePath("/admin/time-off");
  redirect("/admin/time-off?removed=1");
}
