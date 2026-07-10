"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { addTimeOff, ownsTimeOff, removeTimeOff } from "@core/crew/time-off.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Crew self-serve time off (#332, SPEC §2.1, DEC-009). Add/remove my own blackout
 * windows — the write half of the "Days I'm off" surface. Auth + glue over the
 * `addTimeOff` / `removeTimeOff` domain use-cases (validation lives there).
 *
 * DEC-009 line held: subtractive only ("I'm OFF these dates"), never availability.
 * Feedback rides redirect params as codes (DEC-026); `redirect()` throws → OUTSIDE
 * the try. Remove is ownership-gated (10.3): a forged id can't wipe someone else's.
 */
export async function addMyTimeOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");

  let code: string | null = null;
  try {
    const result = await addTimeOff(getRepo(), {
      id: asId<"PtoWindowId">(`pto-${randomUUID()}`),
      crewMemberId: asId<"CrewMemberId">(subject.id),
      start,
      end,
    });
    code = result.ok ? null : result.code;
  } catch {
    code = "error";
  }

  revalidatePath("/crew/time-off");
  redirect(code ? `/crew/time-off?err=${code}` : "/crew/time-off?added=1");
}

export async function removeMyTimeOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const id = String(formData.get("id") ?? "");

  try {
    const repo = getRepo();
    // Only your own — a crafted id naming someone else's window is a silent no-op.
    if (id && (await ownsTimeOff(repo, asId<"CrewMemberId">(subject.id), asId<"PtoWindowId">(id)))) {
      await removeTimeOff(repo, asId<"PtoWindowId">(id));
    }
  } catch {
    revalidatePath("/crew/time-off");
    redirect("/crew/time-off?err=error");
  }

  revalidatePath("/crew/time-off");
  redirect("/crew/time-off?removed=1");
}
