"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { lean } from "@core/asks/lean.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Lean on a specific person from a board row (SPEC §2.5, #43, DEC-026) — the
 * manual Tier-2 direct nudge. The domain rules (eligibility, double-ask guard,
 * bailer exclusion) live in `@core/asks/lean`; this is auth + glue. Feedback
 * rides redirect search params (`?leaned=` / `?lean_error=`) so the board stays
 * a pure server component — no client JS for one button (DEC-021 posture).
 */
export async function leanOn(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    redirect("/admin/at-risk"); // page renders its own signed-out state
  }

  const shiftId = String(formData.get("shiftId") ?? "");
  const crewMemberId = String(formData.get("crewMemberId") ?? "");
  if (!shiftId || !crewMemberId) redirect("/admin/at-risk");

  const repo = getRepo();
  const out = await lean(
    repo,
    asId<"ShiftId">(shiftId),
    asId<"CrewMemberId">(crewMemberId),
    new Date(),
  );
  revalidatePath("/admin/at-risk");

  if (out.error) {
    redirect(`/admin/at-risk?lean_error=${encodeURIComponent(out.error)}`);
  }
  const crew = await repo.getCrewMember(asId<"CrewMemberId">(crewMemberId));
  redirect(`/admin/at-risk?leaned=${encodeURIComponent(crew?.name ?? "them")}`);
}
