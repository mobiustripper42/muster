"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Crew self-serve recurring weekday-off (#426, DEC-119). The write half of the
 * "Weekdays I never work" surface — replaces the whole set from the checkbox form,
 * so unchecking a day and saving clears it. Mon=0…Sun=6; the domain treats the set
 * as subtractive (DEC-009), never availability.
 *
 * Glue over the DEC-094-safe `updateCrewWeekdaysOff` (touches only that column).
 * Feedback rides a redirect param as a code (DEC-026); `redirect()` throws → it
 * lives OUTSIDE the try.
 */
export async function setMyDaysOff(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");

  // Only the CHECKED boxes submit a `days` value (0…6). Parse defensively — drop
  // anything not a whole weekday index rather than persist junk — then de-dupe+sort.
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
    revalidatePath("/crew/days-off");
    redirect("/crew/days-off?err=error");
  }

  revalidatePath("/crew/days-off");
  redirect("/crew/days-off?saved=1");
}
