"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { addTimeOff, ownsTimeOff, removeTimeOff, type AddTimeOffCode } from "@core/crew/time-off.js";
import { readSubject } from "../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";

/**
 * Every code this surface can put in `?err=` (#654) — the domain's validation errors plus the
 * glue codes minted here. Declared beside the `redirect()` that mints them and consumed by the
 * page's copy table, so a code with nothing to say about it is a build error rather than a silent
 * fall through to "try again in a moment".
 */
export type CrewTimeOffErr = AddTimeOffCode | "error";

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

  let code: CrewTimeOffErr | null = null;
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
  // Two date pickers is not much typing, but a refusal made you choose both again (#780).
  if (code) await stashFormDraft("/crew/time-off", formData);
  else await clearFormDraft("/crew/time-off");
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
    await clearFormDraft("/crew/time-off");
    redirect("/crew/time-off?err=error");
  }

  revalidatePath("/crew/time-off");
  await clearFormDraft("/crew/time-off");
  redirect("/crew/time-off?removed=1");
}

/**
 * Crew self-serve recurring weekday-off (#426, DEC-119) — the write half of the
 * "Weekdays I never work" section. Replaces the whole set from the checkbox form,
 * so unchecking a day and saving clears it (Mon=0…Sun=6). Subtractive (DEC-009),
 * never availability. Glue over the DEC-094-safe `updateCrewWeekdaysOff` (touches
 * only that column); `redirect()` throws → OUTSIDE the try.
 */
export async function setMyDaysOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  // Only CHECKED boxes submit a `days` value (0…6). Parse defensively — drop
  // anything not a whole weekday index — then de-dupe + sort.
  const weekdaysOff = [
    ...new Set(
      formData
        .getAll("days")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    ),
  ].sort((a, b) => a - b);

  try {
    await getRepo().updateCrewWeekdaysOff(
      asId<"CrewMemberId">(subject.id),
      weekdaysOff,
    );
  } catch {
    revalidatePath("/crew/time-off");
    // Deliberately CLEARS rather than stashes (#780). The weekday checkboxes are their own
    // form, and one cookie cannot serve two forms on one page without a marker field to tell
    // their drafts apart — an all-unticked save posts no `days` at all, so "no days" and "no
    // draft" are the same bytes. This door's only refusal is an infra throw (there is no
    // validation to fail), so it cannot be exercised end-to-end either. Clearing keeps the
    // invariant that matters: whatever is in the cookie belongs to the last refused ADD, so
    // this `?err=` can never repopulate the add form with someone's minute-old dates.
    await clearFormDraft("/crew/time-off");
    redirect("/crew/time-off?err=error");
  }

  revalidatePath("/crew/time-off");
  await clearFormDraft("/crew/time-off");
  redirect("/crew/time-off?saved=1");
}
